/**
 * Anthropic Strategy
 * Uses Anthropic's Messages API (different from OpenAI's chat completions)
 */
import type { ChatRequest, ChatResponse, ChatChunk, TokenUsage } from '../../../types';
import { IProviderStrategy, ProviderErrorInfo } from './base';

export class AnthropicStrategy implements IProviderStrategy {
  readonly type = 'anthropic';

  buildRequest(request: ChatRequest, baseUrl: string, apiKey: string, headers?: Record<string, string>) {
    // Anthropic uses separate system + messages
    const systemPrompt = request.systemPrompt || '';
    const messages: any[] = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // Skip — system goes in top-level field
        continue;
      }

      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role === 'tool' ? 'user' : msg.role, content: msg.content });
        continue;
      }

      // Array of content blocks
      const blocks: any[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          blocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'image') {
          if (block.source.type === 'base64') {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: block.source.mediaType,
                data: block.source.data,
              },
            });
          }
        } else if (block.type === 'tool_use') {
          blocks.push({
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          });
        } else if (block.type === 'tool_result') {
          blocks.push({
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            is_error: block.isError,
          });
        }
      }

      // Handle tool_calls (assistant message with tool use)
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
      }

      if (blocks.length > 0) {
        messages.push({
          role: msg.role === 'tool' ? 'user' : msg.role,
          content: blocks,
        });
      }
    }

    const body: any = {
      model: request.modelId,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
      top_p: request.topP ?? 1,
      stream: request.stream ?? false,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (request.stopSequences && request.stopSequences.length > 0) {
      body.stop_sequences = request.stopSequences;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));

      if (request.toolChoice === 'auto') body.tool_choice = { type: 'auto' };
      else if (request.toolChoice === 'none') body.tool_choice = { type: 'none' };
      else if (request.toolChoice === 'required') body.tool_choice = { type: 'any' };
      else if (request.toolChoice && typeof request.toolChoice === 'object') {
        body.tool_choice = { type: 'tool', name: request.toolChoice.name };
      }
    }

    return {
      url: `${baseUrl.replace(/\/$/, '')}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...(headers || {}),
      },
      body,
    };
  }

  parseResponse(raw: any, modelName: string): ChatResponse {
    let text = '';
    const toolCalls: any[] = [];

    for (const block of raw.content || []) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input,
        });
      }
    }

    return {
      content: text,
      role: 'assistant',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: raw.stop_reason === 'end_turn' ? 'stop'
        : raw.stop_reason === 'max_tokens' ? 'length'
        : raw.stop_reason === 'tool_use' ? 'tool_calls'
        : 'stop',
      model: raw.model || modelName,
      usage: {
        inputTokens: raw.usage?.input_tokens || 0,
        outputTokens: raw.usage?.output_tokens || 0,
        totalTokens: (raw.usage?.input_tokens || 0) + (raw.usage?.output_tokens || 0),
      },
      latencyMs: 0,
      raw,
    };
  }

  parseStreamChunk(line: string): ChatChunk | null {
    if (!line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();
    try {
      const event = JSON.parse(data);

      switch (event.type) {
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            return { delta: { content: event.delta.text } };
          }
          if (event.delta?.type === 'input_json_delta') {
            return { delta: { toolCalls: [{ arguments: JSON.parse(event.delta.partial_json) }] } };
          }
          return null;
        case 'message_start':
          if (event.message?.model) {
            return { model: event.message.model };
          }
          return null;
        case 'message_delta':
          if (event.delta?.stop_reason) {
            return {
              finishReason: event.delta.stop_reason === 'end_turn' ? 'stop'
                : event.delta.stop_reason === 'max_tokens' ? 'length'
                : event.delta.stop_reason === 'tool_use' ? 'tool_calls'
                : 'stop',
              usage: event.usage ? {
                inputTokens: event.usage.input_tokens || 0,
                outputTokens: event.usage.output_tokens || 0,
                totalTokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0),
              } : undefined,
            };
          }
          return null;
        case 'message_stop':
          return { finishReason: 'stop' };
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  extractUsage(raw: any): TokenUsage {
    return {
      inputTokens: raw.usage?.input_tokens || 0,
      outputTokens: raw.usage?.output_tokens || 0,
      totalTokens: (raw.usage?.input_tokens || 0) + (raw.usage?.output_tokens || 0),
    };
  }

  classifyError(status: number, body: any): ProviderErrorInfo {
    const errorMsg = body?.error?.message || body?.message || `HTTP ${status}`;
    const errorCode = body?.error?.type || body?.type || `HTTP_${status}`;

    return {
      code: errorCode,
      message: errorMsg,
      statusCode: status,
      retryable: status === 429 || status >= 500,
      rateLimited: status === 429,
      details: body,
    };
  }

  getModelsEndpoint(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, '')}/models`;
  }

  parseModelsResponse(raw: any): { id: string; name: string }[] {
    return (raw.data || []).map((m: any) => ({
      id: m.id,
      name: m.display_name || m.id,
    }));
  }
}
