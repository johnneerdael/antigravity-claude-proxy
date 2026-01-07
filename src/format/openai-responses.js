import crypto from 'crypto';

export function convertResponsesAPIToAnthropic(responsesRequest) {
    const {
        model,
        input,
        instructions,
        max_output_tokens,
        temperature,
        top_p,
        tools,
        tool_choice,
        stream,
        reasoning
    } = responsesRequest;

    const anthropicMessages = [];
    let systemPrompt = instructions || null;

    if (typeof input === 'string') {
        anthropicMessages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
        for (const item of input) {
            if (item.type === 'message') {
                if (item.role === 'developer' || item.role === 'system') {
                    const textContent = extractTextFromContent(item.content);
                    systemPrompt = systemPrompt ? systemPrompt + '\n\n' + textContent : textContent;
                } else {
                    const msg = convertInputItemToAnthropicMessage(item);
                    if (msg) anthropicMessages.push(msg);
                }
            } else if (item.type === 'function_call_output') {
                anthropicMessages.push({
                    role: 'user',
                    content: [{
                        type: 'tool_result',
                        tool_use_id: item.call_id,
                        content: item.output
                    }]
                });
            }
        }
    }

    const anthropicRequest = {
        model: model || 'claude-3-5-sonnet-20241022',
        messages: anthropicMessages,
        max_tokens: max_output_tokens || 4096,
        stream: stream || false
    };

    if (systemPrompt) anthropicRequest.system = systemPrompt;
    if (temperature !== undefined) anthropicRequest.temperature = temperature;
    if (top_p !== undefined) anthropicRequest.top_p = top_p;

    if (tools && tools.length > 0) {
        anthropicRequest.tools = tools
            .filter(tool => tool.type === 'function')
            .map(tool => ({
                name: tool.name,
                description: tool.description || '',
                input_schema: tool.parameters || { type: 'object' }
            }));
    }

    if (tool_choice) {
        if (tool_choice === 'auto') {
            anthropicRequest.tool_choice = { type: 'auto' };
        } else if (tool_choice === 'none') {
            anthropicRequest.tool_choice = { type: 'none' };
        } else if (tool_choice === 'required') {
            anthropicRequest.tool_choice = { type: 'any' };
        } else if (typeof tool_choice === 'object' && tool_choice.name) {
            anthropicRequest.tool_choice = { type: 'tool', name: tool_choice.name };
        }
    }

    const modelLower = (model || '').toLowerCase();
    const isThinkingModel = modelLower.includes('thinking') ||
        (modelLower.includes('gemini') && /gemini-(\d+)/.test(modelLower) && parseInt(modelLower.match(/gemini-(\d+)/)[1]) >= 3);

    if (isThinkingModel || reasoning) {
        let budgetTokens = 10000;
        if (reasoning?.effort === 'high') budgetTokens = 20000;
        else if (reasoning?.effort === 'low') budgetTokens = 5000;
        anthropicRequest.thinking = { type: 'enabled', budget_tokens: budgetTokens };
    }

    return anthropicRequest;
}

function convertInputItemToAnthropicMessage(item) {
    if (!item || item.type !== 'message') return null;

    const anthropicMsg = {
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: []
    };

    if (Array.isArray(item.content)) {
        for (const part of item.content) {
            if (part.type === 'input_text' || part.type === 'text') {
                anthropicMsg.content.push({ type: 'text', text: part.text });
            } else if (part.type === 'input_image') {
                const imageUrl = part.image_url || part.url || '';
                if (imageUrl.startsWith('data:')) {
                    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (match) {
                        anthropicMsg.content.push({
                            type: 'image',
                            source: { type: 'base64', media_type: match[1], data: match[2] }
                        });
                    }
                } else if (imageUrl) {
                    anthropicMsg.content.push({
                        type: 'image',
                        source: { type: 'url', url: imageUrl }
                    });
                }
            } else if (part.type === 'output_text') {
                anthropicMsg.content.push({ type: 'text', text: part.text });
            }
        }
    } else if (typeof item.content === 'string') {
        anthropicMsg.content = item.content;
    }

    if (Array.isArray(anthropicMsg.content) && anthropicMsg.content.length === 1 && anthropicMsg.content[0].type === 'text') {
        anthropicMsg.content = anthropicMsg.content[0].text;
    }

    return anthropicMsg;
}

function extractTextFromContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .filter(p => p.type === 'input_text' || p.type === 'text')
            .map(p => p.text)
            .join('\n');
    }
    return '';
}

export function convertAnthropicToResponsesAPI(anthropicResponse, model, originalRequest = {}) {
    const responseId = `resp_${crypto.randomBytes(12).toString('hex')}`;
    const createdAt = Math.floor(Date.now() / 1000);

    const output = [];
    let messageContent = [];
    let reasoningContent = null;

    for (const block of anthropicResponse.content || []) {
        if (block.type === 'text') {
            messageContent.push({
                type: 'output_text',
                text: block.text,
                annotations: []
            });
        } else if (block.type === 'thinking') {
            reasoningContent = block.thinking;
        } else if (block.type === 'tool_use') {
            output.push({
                type: 'function_call',
                id: `fc_${crypto.randomBytes(8).toString('hex')}`,
                call_id: block.id,
                name: block.name,
                arguments: JSON.stringify(block.input || {}),
                status: 'completed'
            });
        }
    }

    if (messageContent.length > 0 || output.length === 0) {
        output.unshift({
            type: 'message',
            id: `msg_${crypto.randomBytes(8).toString('hex')}`,
            status: 'completed',
            role: 'assistant',
            content: messageContent
        });
    }

    let status = 'completed';
    let incompleteDetails = null;
    if (anthropicResponse.stop_reason === 'max_tokens') {
        status = 'incomplete';
        incompleteDetails = { reason: 'max_output_tokens' };
    }

    const response = {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        status,
        model,
        output,
        parallel_tool_calls: true,
        tool_choice: originalRequest.tool_choice || 'auto',
        tools: originalRequest.tools || [],
        text: { format: { type: 'text' } },
        temperature: originalRequest.temperature ?? 1.0,
        top_p: originalRequest.top_p ?? 1.0,
        truncation: originalRequest.truncation || 'disabled',
        usage: {
            input_tokens: anthropicResponse.usage?.input_tokens || 0,
            input_tokens_details: {
                cached_tokens: anthropicResponse.usage?.cache_read_input_tokens || 0
            },
            output_tokens: anthropicResponse.usage?.output_tokens || 0,
            output_tokens_details: {
                reasoning_tokens: reasoningContent ? Math.ceil(reasoningContent.length / 4) : 0
            },
            total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0)
        },
        metadata: originalRequest.metadata || {}
    };

    if (reasoningContent) {
        response.reasoning = {
            effort: originalRequest.reasoning?.effort || 'medium',
            summary: null
        };
    }

    if (incompleteDetails) response.incomplete_details = incompleteDetails;
    if (originalRequest.instructions) response.instructions = originalRequest.instructions;
    if (originalRequest.previous_response_id) response.previous_response_id = originalRequest.previous_response_id;

    return response;
}

export function createResponsesStreamState() {
    return {
        responseId: `resp_${crypto.randomBytes(12).toString('hex')}`,
        createdAt: Math.floor(Date.now() / 1000),
        sequenceNumber: 0,
        currentItemId: null,
        currentItemIndex: -1,
        currentContentIndex: -1,
        currentBlockType: null,
        currentFunctionCall: null,
        messageItemId: null,
        hasEmittedMessageItem: false
    };
}

export function convertAnthropicEventToResponsesAPI(event, model, state, originalRequest = {}) {
    const events = [];
    const nextSeq = () => state.sequenceNumber++;

    switch (event.type) {
        case 'message_start': {
            events.push({
                type: 'response.created',
                sequence_number: nextSeq(),
                response: {
                    id: state.responseId,
                    object: 'response',
                    created_at: state.createdAt,
                    status: 'in_progress',
                    model,
                    output: [],
                    parallel_tool_calls: true,
                    tool_choice: originalRequest.tool_choice || 'auto',
                    tools: originalRequest.tools || [],
                    temperature: originalRequest.temperature ?? 1.0,
                    top_p: originalRequest.top_p ?? 1.0,
                    truncation: originalRequest.truncation || 'disabled',
                    metadata: originalRequest.metadata || {}
                }
            });

            events.push({
                type: 'response.in_progress',
                sequence_number: nextSeq(),
                response: {
                    id: state.responseId,
                    object: 'response',
                    created_at: state.createdAt,
                    status: 'in_progress',
                    model
                }
            });
            break;
        }

        case 'content_block_start': {
            const blockType = event.content_block?.type;
            state.currentBlockType = blockType;

            if (blockType === 'text') {
                if (!state.hasEmittedMessageItem) {
                    state.currentItemIndex++;
                    state.messageItemId = `msg_${crypto.randomBytes(8).toString('hex')}`;
                    state.currentItemId = state.messageItemId;
                    state.hasEmittedMessageItem = true;

                    events.push({
                        type: 'response.output_item.added',
                        sequence_number: nextSeq(),
                        output_index: state.currentItemIndex,
                        item: {
                            type: 'message',
                            id: state.messageItemId,
                            status: 'in_progress',
                            role: 'assistant',
                            content: []
                        }
                    });
                }

                state.currentContentIndex++;
                events.push({
                    type: 'response.content_part.added',
                    sequence_number: nextSeq(),
                    item_id: state.messageItemId,
                    output_index: state.currentItemIndex,
                    content_index: state.currentContentIndex,
                    part: {
                        type: 'output_text',
                        text: '',
                        annotations: []
                    }
                });
            } else if (blockType === 'thinking') {
                state.currentBlockType = 'thinking';
            } else if (blockType === 'tool_use') {
                state.currentItemIndex++;
                const fcId = `fc_${crypto.randomBytes(8).toString('hex')}`;
                state.currentFunctionCall = {
                    id: fcId,
                    call_id: event.content_block.id,
                    name: event.content_block.name,
                    arguments: ''
                };
                state.currentItemId = fcId;

                events.push({
                    type: 'response.output_item.added',
                    sequence_number: nextSeq(),
                    output_index: state.currentItemIndex,
                    item: {
                        type: 'function_call',
                        id: fcId,
                        call_id: event.content_block.id,
                        name: event.content_block.name,
                        arguments: '',
                        status: 'in_progress'
                    }
                });
            }
            break;
        }

        case 'content_block_delta': {
            if (event.delta?.type === 'text_delta') {
                events.push({
                    type: 'response.output_text.delta',
                    sequence_number: nextSeq(),
                    item_id: state.messageItemId,
                    output_index: state.currentItemIndex,
                    content_index: state.currentContentIndex,
                    delta: event.delta.text
                });
            } else if (event.delta?.type === 'thinking_delta') {
                events.push({
                    type: 'response.reasoning.delta',
                    sequence_number: nextSeq(),
                    item_id: state.currentItemId,
                    delta: event.delta.thinking
                });
            } else if (event.delta?.type === 'input_json_delta' && state.currentFunctionCall) {
                state.currentFunctionCall.arguments += event.delta.partial_json;
                events.push({
                    type: 'response.function_call_arguments.delta',
                    sequence_number: nextSeq(),
                    item_id: state.currentFunctionCall.id,
                    output_index: state.currentItemIndex,
                    delta: event.delta.partial_json
                });
            }
            break;
        }

        case 'content_block_stop': {
            if (state.currentBlockType === 'text') {
                events.push({
                    type: 'response.output_text.done',
                    sequence_number: nextSeq(),
                    item_id: state.messageItemId,
                    output_index: state.currentItemIndex,
                    content_index: state.currentContentIndex,
                    text: ''
                });
            } else if (state.currentBlockType === 'tool_use' && state.currentFunctionCall) {
                events.push({
                    type: 'response.function_call_arguments.done',
                    sequence_number: nextSeq(),
                    item_id: state.currentFunctionCall.id,
                    output_index: state.currentItemIndex,
                    name: state.currentFunctionCall.name,
                    call_id: state.currentFunctionCall.call_id,
                    arguments: state.currentFunctionCall.arguments
                });

                events.push({
                    type: 'response.output_item.done',
                    sequence_number: nextSeq(),
                    output_index: state.currentItemIndex,
                    item: {
                        type: 'function_call',
                        id: state.currentFunctionCall.id,
                        call_id: state.currentFunctionCall.call_id,
                        name: state.currentFunctionCall.name,
                        arguments: state.currentFunctionCall.arguments,
                        status: 'completed'
                    }
                });

                state.currentFunctionCall = null;
            }
            state.currentBlockType = null;
            break;
        }

        case 'message_stop': {
            if (state.hasEmittedMessageItem) {
                events.push({
                    type: 'response.output_item.done',
                    sequence_number: nextSeq(),
                    output_index: 0,
                    item: {
                        type: 'message',
                        id: state.messageItemId,
                        status: 'completed',
                        role: 'assistant',
                        content: []
                    }
                });
            }

            events.push({
                type: 'response.completed',
                sequence_number: nextSeq(),
                response: {
                    id: state.responseId,
                    object: 'response',
                    created_at: state.createdAt,
                    status: 'completed',
                    model,
                    output: [],
                    usage: {
                        input_tokens: event.message?.usage?.input_tokens || 0,
                        output_tokens: event.message?.usage?.output_tokens || 0,
                        total_tokens: (event.message?.usage?.input_tokens || 0) + (event.message?.usage?.output_tokens || 0)
                    }
                }
            });
            break;
        }
    }

    return events;
}

export function formatResponsesSSE(event) {
    return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
