/**
 * Request Optimizer
 *
 * Trims and optimizes incoming API requests before they're processed,
 * reducing token usage while preserving context quality.
 * Inspired by tools like RPK and CodeGraph's context compression.
 *
 * Strategies:
 * - KeepLastMessages: chỉ giữ N messages cuối
 * - TrimTools: giữ lại tools đã từng được dùng gần đây
 * - CompressSystem: rút gọn system prompt
 */

import { logger } from './utils/logger.js';
import { getSetting, setSetting } from './db/call-logger.js';

/** Default config */
const DEFAULTS = {
    enabled: false,
    maxMessages: 50,          // Keep last 50 messages
    maxToolResults: 20,       // Keep tool results short (0 = strip all)
    keepTools: true,          // Keep tool definitions
    maxSystemChars: 2000,     // Trim system prompt
    summarySystemPrefix: '[Optimized] ',
};

let config = { ...DEFAULTS };

/**
 * Configure the optimizer — also persists to DB
 */
export function configureOptimizer(opts = {}) {
    config = { ...DEFAULTS, ...opts };
    logger.info(`[Optimizer] Enabled=${config.enabled}, maxMessages=${config.maxMessages}, keepTools=${config.keepTools}`);
    // Persist to DB
    try {
        setSetting('optimizer_config', JSON.stringify(config));
    } catch (_) { /* DB may not be ready */ }
    return { ...config };
}

/**
 * Load optimizer config from persistent DB settings.
 * Call this during server startup instead of reading CLI flags.
 */
export function loadOptimizerFromDb() {
    try {
        const raw = getSetting('optimizer_config');
        if (raw) {
            const saved = JSON.parse(raw);
            config = { ...DEFAULTS, ...saved };
            logger.info(`[Optimizer] Loaded from DB: enabled=${config.enabled}, maxMessages=${config.maxMessages}`);
        } else {
            // First run — save defaults
            configureOptimizer({});
        }
    } catch (_) {
        logger.info('[Optimizer] No saved config, using defaults');
    }
    return { ...config };
}

/**
 * Get current config
 */
export function getOptimizerConfig() {
    return { ...config };
}

/**
 * OpenAI requires each tool response to immediately follow an assistant tool call.
 * Trimming arbitrary last-N messages can leave orphan tool responses at the front,
 * which Gemini rejects with: "function response turn comes immediately after a function call turn".
 */
function sanitizeOpenAIToolSequence(messages) {
    if (!Array.isArray(messages)) return messages;

    const sanitized = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (msg.role === 'tool') {
            // Orphan tool response at the beginning or after a non-tool message.
            continue;
        }

        if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
            const prev = sanitized[sanitized.length - 1];
            const canStartToolCall = prev?.role === 'user' || prev?.role === 'tool';
            const expected = new Set(msg.tool_calls.map(call => call.id).filter(Boolean));
            const toolResponses = [];
            let j = i + 1;

            while (j < messages.length && messages[j].role === 'tool') {
                const toolMsg = messages[j];
                if (toolMsg.tool_call_id && expected.has(toolMsg.tool_call_id)) {
                    toolResponses.push(toolMsg);
                    expected.delete(toolMsg.tool_call_id);
                }
                j++;
            }

            if (canStartToolCall && expected.size === 0) {
                sanitized.push(msg, ...toolResponses);
                i = j - 1;
                continue;
            }

            // Invalid/incomplete assistant tool-call block after trimming. Keep text content only, if any.
            if (msg.content) {
                const { tool_calls, ...withoutToolCalls } = msg;
                sanitized.push(withoutToolCalls);
            }
            i = j - 1;
            continue;
        }

        sanitized.push(msg);
    }

    return sanitized;
}

/** Remove Anthropic tool_result blocks that no longer have a preceding tool_use. */
function sanitizeAnthropicToolSequence(messages) {
    if (!Array.isArray(messages)) return messages;

    const seenToolUseIds = new Set();
    const sanitized = [];
    for (const msg of messages) {
        if (Array.isArray(msg.content)) {
            const prev = sanitized[sanitized.length - 1];
            const canStartToolUse = prev?.role === 'user'
                || (prev?.role === 'user' && Array.isArray(prev.content) && prev.content.some(part => part?.type === 'tool_result'));

            if (msg.role === 'assistant' && msg.content.some(part => part?.type === 'tool_use') && !canStartToolUse) {
                const content = msg.content.filter(part => part?.type !== 'tool_use');
                if (content.length > 0) sanitized.push({ ...msg, content });
                continue;
            }

            for (const part of msg.content) {
                if (part?.type === 'tool_use' && part.id) seenToolUseIds.add(part.id);
            }

            if (msg.role === 'user') {
                const content = msg.content.filter(part => {
                    if (part?.type !== 'tool_result') return true;
                    return part.tool_use_id && seenToolUseIds.has(part.tool_use_id);
                });
                if (content.length === 0) continue;
                sanitized.push({ ...msg, content });
                continue;
            }
        }
        sanitized.push(msg);
    }

    return sanitized;
}

/**
 * Optimize an Anthropic-format request (used by /v1/messages and /v1/chat/completions)
 * @param {Object} req - Anthropic format request { model, messages, system, tools, ... }
 * @returns {Object} Optimized request (mutates and returns same object)
 */
export function optimizeAnthropicRequest(req) {
    if (!config.enabled) return req;

    const beforeMsgs = req.messages?.length || 0;
    const beforeTools = req.tools?.length || 0;
    const beforeSysLen = typeof req.system === 'string' ? req.system.length : 0;
    const beforeTotalChars = JSON.stringify({ messages: req.messages, system: req.system, tools: req.tools }).length;

    // 1. Trim messages: keep last N
    if (Array.isArray(req.messages) && req.messages.length > config.maxMessages) {
        // Always keep the LAST user message (current question) and its preceding context
        const keepCount = config.maxMessages;
        req.messages = req.messages.slice(-keepCount);
        req.messages = sanitizeAnthropicToolSequence(req.messages);
    }

    // 2. Trim tool results (messages with role='user' that contain tool_result blocks)
    if (Array.isArray(req.messages) && config.maxToolResults >= 0) {
        let toolResultCount = 0;
        for (const msg of req.messages) {
            if (msg.role === 'user' && Array.isArray(msg.content)) {
                // Shorten tool_result blocks
                msg.content = msg.content.map(part => {
                    if (part.type === 'tool_result' && typeof part.content === 'string' && part.content.length > 500) {
                        toolResultCount++;
                        if (toolResultCount > config.maxToolResults) {
                            // Truncate long tool results
                            return { ...part, content: part.content.slice(0, 300) + '...[truncated]' };
                        }
                    }
                    return part;
                });
            }
        }
    }

    // 3. Keep tools (default: yes)
    if (!config.keepTools && req.tools) {
        delete req.tools;
    }

    // 4. Compress system prompt
    if (typeof req.system === 'string' && req.system.length > config.maxSystemChars) {
        req.system = config.summarySystemPrefix + req.system.slice(0, config.maxSystemChars) + '...[truncated]';
    }

    // Log stats
    const afterTotalChars = JSON.stringify({ messages: req.messages, system: req.system, tools: req.tools }).length;
    const savedChars = beforeTotalChars - afterTotalChars;
    const savedPct = beforeTotalChars > 0 ? Math.round((savedChars / beforeTotalChars) * 1000) / 10 : 0;

    if (savedChars > 0) {
        logger.info(`[Optimizer] ${savedPct}% saved: msgs ${beforeMsgs}→${req.messages?.length || 0}, tools ${beforeTools}→${req.tools?.length || 0}, sys ${beforeSysLen}→${(req.system||'').length}, chars ${(savedChars/1000).toFixed(1)}KB saved`);
    }

    return req;
}

/**
 * Optimize an OpenAI-format request (used by /v1/chat/completions)
 * @param {Object} req - OpenAI format request
 * @returns {Object} Optimized request
 */
export function optimizeOpenAIRequest(req) {
    if (!config.enabled) return req;

    const beforeMsgs = req.messages?.length || 0;
    const beforeTools = req.tools?.length || 0;
    const beforeTotalChars = JSON.stringify(req).length;

    // 1. Trim messages: keep last N
    if (Array.isArray(req.messages) && req.messages.length > config.maxMessages) {
        const keepCount = config.maxMessages;
        req.messages = req.messages.slice(-keepCount);
        req.messages = sanitizeOpenAIToolSequence(req.messages);
    }

    // 2. Trim tool results
    if (Array.isArray(req.messages) && config.maxToolResults >= 0) {
        let toolResultCount = 0;
        for (const msg of req.messages) {
            if (msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 500) {
                toolResultCount++;
                if (toolResultCount > config.maxToolResults) {
                    msg.content = msg.content.slice(0, 300) + '...[truncated]';
                }
            }
        }
    }

    // 3. Tools
    if (!config.keepTools && req.tools) {
        delete req.tools;
    }

    // 4. Compress system message
    if (Array.isArray(req.messages)) {
        for (const msg of req.messages) {
            if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.length > config.maxSystemChars) {
                msg.content = config.summarySystemPrefix + msg.content.slice(0, config.maxSystemChars) + '...[truncated]';
            }
        }
    }

    const afterTotalChars = JSON.stringify(req).length;
    const savedChars = beforeTotalChars - afterTotalChars;
    const savedPct = beforeTotalChars > 0 ? Math.round((savedChars / beforeTotalChars) * 1000) / 10 : 0;

    if (savedChars > 0) {
        logger.info(`[Optimizer] OpenAI ${savedPct}% saved: msgs ${beforeMsgs}→${req.messages?.length || 0}, tools ${beforeTools}→${req.tools?.length || 0}, chars ${(savedChars/1000).toFixed(1)}KB saved`);
    }

    return req;
}
