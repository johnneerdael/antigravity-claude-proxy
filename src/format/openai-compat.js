/**
 * OpenAI Compatibility Layer
 * Converts between OpenAI Chat Completions API and Anthropic Messages API formats
 */

import crypto from 'crypto';

/**
 * Convert OpenAI Chat Completions request to Anthropic Messages format
 * 
 * @param {Object} openaiRequest - OpenAI format request
 * @returns {Object} Anthropic format request
 */
export function convertOpenAIToAnthropic(openaiRequest) {
    const {
        model,
        messages,
        max_tokens,
        max_completion_tokens,
        temperature,
        top_p,
        stop,
        stream,
        tools,
        tool_choice,
        response_format,
        reasoning_effort
    } = openaiRequest;

    const anthropicMessages = [];
    let systemPrompt = null;

    for (const msg of messages) {
        if (msg.role === 'system') {
            if (systemPrompt === null) {
                systemPrompt = msg.content;
            } else {
                systemPrompt += '\n\n' + msg.content;
            }
            continue;
        }

        const anthropicMsg = {
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: []
        };

        if (typeof msg.content === 'string') {
            anthropicMsg.content = msg.content;
        } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
                if (part.type === 'text') {
                    anthropicMsg.content.push({ type: 'text', text: part.text });
                } else if (part.type === 'image_url') {
                    const imageUrl = part.image_url?.url || '';
                    if (imageUrl.startsWith('data:')) {
                        const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                        if (match) {
                            anthropicMsg.content.push({
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: match[1],
                                    data: match[2]
                                }
                            });
                        }
                    } else {
                        anthropicMsg.content.push({
                            type: 'image',
                            source: {
                                type: 'url',
                                url: imageUrl
                            }
                        });
                    }
                }
            }
        }

        if (msg.tool_calls && msg.tool_calls.length > 0) {
            if (typeof anthropicMsg.content === 'string') {
                anthropicMsg.content = anthropicMsg.content ? [{ type: 'text', text: anthropicMsg.content }] : [];
            }
            for (const toolCall of msg.tool_calls) {
                anthropicMsg.content.push({
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.function?.name,
                    input: safeJsonParse(toolCall.function?.arguments)
                });
            }
        }

        if (msg.role === 'tool') {
            anthropicMsg.role = 'user';
            anthropicMsg.content = [{
                type: 'tool_result',
                tool_use_id: msg.tool_call_id,
                content: msg.content
            }];
        }

        anthropicMessages.push(anthropicMsg);
    }

    const anthropicRequest = {
        model,
        messages: anthropicMessages,
        max_tokens: max_completion_tokens || max_tokens || 4096,
        stream: stream || false
    };

    if (systemPrompt) {
        anthropicRequest.system = systemPrompt;
    }

    if (temperature !== undefined) {
        anthropicRequest.temperature = temperature;
    }

    if (top_p !== undefined) {
        anthropicRequest.top_p = top_p;
    }

    if (stop) {
        anthropicRequest.stop_sequences = Array.isArray(stop) ? stop : [stop];
    }

    if (tools && tools.length > 0) {
        anthropicRequest.tools = tools.map(tool => ({
            name: tool.function?.name || tool.name,
            description: tool.function?.description || tool.description || '',
            input_schema: tool.function?.parameters || tool.parameters || { type: 'object' }
        }));
    }

    if (tool_choice) {
        if (tool_choice === 'auto') {
            anthropicRequest.tool_choice = { type: 'auto' };
        } else if (tool_choice === 'none') {
            anthropicRequest.tool_choice = { type: 'none' };
        } else if (tool_choice === 'required') {
            anthropicRequest.tool_choice = { type: 'any' };
        } else if (typeof tool_choice === 'object' && tool_choice.function?.name) {
            anthropicRequest.tool_choice = { type: 'tool', name: tool_choice.function.name };
        }
    }

    const modelLower = (model || '').toLowerCase();
    const isThinkingModel = modelLower.includes('thinking') || 
        (modelLower.includes('gemini') && /gemini-(\d+)/.test(modelLower) && parseInt(modelLower.match(/gemini-(\d+)/)[1]) >= 3);
    
    if (isThinkingModel) {
        let budgetTokens = 10000;
        if (reasoning_effort === 'high') {
            budgetTokens = 20000;
        } else if (reasoning_effort === 'low') {
            budgetTokens = 5000;
        }
        anthropicRequest.thinking = { type: 'enabled', budget_tokens: budgetTokens };
    }

    return anthropicRequest;
}

/**
 * Convert Anthropic Messages response to OpenAI Chat Completions format
 * 
 * @param {Object} anthropicResponse - Anthropic format response
 * @param {string} model - Model name
 * @returns {Object} OpenAI format response
 */
export function convertAnthropicToOpenAI(anthropicResponse, model) {
    const id = `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;
    const created = Math.floor(Date.now() / 1000);

    let textContent = '';
    let thinkingContent = '';
    const toolCalls = [];
    let toolCallIndex = 0;

    for (const block of anthropicResponse.content || []) {
        if (block.type === 'text') {
            textContent += block.text;
        } else if (block.type === 'thinking') {
            thinkingContent += block.thinking;
        } else if (block.type === 'tool_use') {
            toolCalls.push({
                index: toolCallIndex++,
                id: block.id,
                type: 'function',
                function: {
                    name: block.name,
                    arguments: JSON.stringify(block.input || {})
                }
            });
        }
    }

    let finishReason = 'stop';
    if (anthropicResponse.stop_reason === 'tool_use') {
        finishReason = 'tool_calls';
    } else if (anthropicResponse.stop_reason === 'max_tokens') {
        finishReason = 'length';
    } else if (anthropicResponse.stop_reason === 'stop_sequence') {
        finishReason = 'stop';
    }

    const message = {
        role: 'assistant',
        content: textContent || null
    };

    if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
        if (!textContent) {
            message.content = null;
        }
    }

    const response = {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [{
            index: 0,
            message,
            finish_reason: finishReason
        }],
        usage: {
            prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
            completion_tokens: anthropicResponse.usage?.output_tokens || 0,
            total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0)
        }
    };

    if (thinkingContent) {
        response.choices[0].message.reasoning_content = thinkingContent;
    }

    return response;
}

/**
 * Convert Anthropic SSE event to OpenAI streaming chunk format
 * 
 * @param {Object} event - Anthropic SSE event
 * @param {string} model - Model name
 * @param {Object} state - Streaming state object
 * @returns {Object|null} OpenAI format chunk or null if not applicable
 */
export function convertAnthropicEventToOpenAI(event, model, state) {
    if (!state.id) {
        state.id = `chatcmpl-${crypto.randomBytes(12).toString('hex')}`;
        state.created = Math.floor(Date.now() / 1000);
        state.currentToolCall = null;
        state.toolCallIndex = 0;
    }

    const baseChunk = {
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model
    };

    switch (event.type) {
        case 'message_start':
            state.inputTokens = event.message?.usage?.input_tokens || 0;
            return {
                ...baseChunk,
                choices: [{
                    index: 0,
                    delta: { role: 'assistant', content: '' },
                    finish_reason: null
                }],
                usage: {
                    prompt_tokens: state.inputTokens,
                    completion_tokens: 0,
                    total_tokens: state.inputTokens
                }
            };

        case 'content_block_start':
            if (event.content_block?.type === 'tool_use') {
                state.currentToolCall = {
                    index: state.toolCallIndex++,
                    id: event.content_block.id,
                    type: 'function',
                    function: {
                        name: event.content_block.name,
                        arguments: ''
                    }
                };
                return {
                    ...baseChunk,
                    choices: [{
                        index: 0,
                        delta: {
                            tool_calls: [{ ...state.currentToolCall }]
                        },
                        finish_reason: null
                    }]
                };
            }
            return null;

        case 'content_block_delta':
            if (event.delta?.type === 'text_delta') {
                return {
                    ...baseChunk,
                    choices: [{
                        index: 0,
                        delta: { content: event.delta.text },
                        finish_reason: null
                    }]
                };
            } else if (event.delta?.type === 'thinking_delta') {
                return {
                    ...baseChunk,
                    choices: [{
                        index: 0,
                        delta: { reasoning_content: event.delta.thinking },
                        finish_reason: null
                    }]
                };
            } else if (event.delta?.type === 'input_json_delta' && state.currentToolCall) {
                state.currentToolCall.function.arguments += event.delta.partial_json;
                return {
                    ...baseChunk,
                    choices: [{
                        index: 0,
                        delta: {
                            tool_calls: [{
                                index: state.currentToolCall.index,
                                function: { arguments: event.delta.partial_json }
                            }]
                        },
                        finish_reason: null
                    }]
                };
            }
            return null;

        case 'content_block_stop':
            state.currentToolCall = null;
            return null;

        case 'message_delta':
            let finishReason = 'stop';
            if (event.delta?.stop_reason === 'tool_use') {
                finishReason = 'tool_calls';
            } else if (event.delta?.stop_reason === 'max_tokens') {
                finishReason = 'length';
            }
            return {
                ...baseChunk,
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: finishReason
                }]
            };

        case 'message_stop':
            if (event.message?.usage) {
                state.outputTokens = event.message.usage.output_tokens || 0;
                return {
                    ...baseChunk,
                    choices: [],
                    usage: {
                        prompt_tokens: state.inputTokens || 0,
                        completion_tokens: state.outputTokens,
                        total_tokens: (state.inputTokens || 0) + state.outputTokens
                    }
                };
            }
            return null;

        default:
            return null;
    }
}

function safeJsonParse(str) {
    if (!str) return {};
    try {
        return JSON.parse(str);
    } catch {
        return {};
    }
}
