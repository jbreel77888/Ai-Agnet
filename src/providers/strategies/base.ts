/**
 * Base Provider Strategy — interface that all provider strategies must implement
 *
 * Each strategy knows how to:
 * 1. Normalize a ChatRequest into the provider's API format
 * 2. Parse the provider's response back into our ChatResponse
 * 3. Handle streaming chunks
 * 4. Extract token usage
 * 5. Classify errors
 */
import type {
  ChatRequest, ChatResponse, ChatChunk, TokenUsage, ToolDefinition,
} from '../../../types';

export interface IProviderStrategy {
  readonly type: string;

  /**
   * Build the HTTP request for the provider's chat completion endpoint
   */
  buildRequest(request: ChatRequest, baseUrl: string, apiKey: string, headers?: Record<string, string>): {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  };

  /**
   * Parse a non-streaming response
   */
  parseResponse(raw: any, modelName: string): ChatResponse;

  /**
   * Parse a single SSE line into a ChatChunk (or null if line is comment/keepalive)
   */
  parseStreamChunk(line: string): ChatChunk | null;

  /**
   * Extract token usage from the raw response
   */
  extractUsage(raw: any): TokenUsage;

  /**
   * Classify an error from the provider
   */
  classifyError(status: number, body: any): ProviderErrorInfo;

  /**
   * Get the models endpoint URL (if supported)
   */
  getModelsEndpoint?(baseUrl: string): string;

  /**
   * Parse the models list response
   */
  parseModelsResponse?(raw: any): { id: string; name: string }[];
}

export interface ProviderErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
  statusCode: number;
  rateLimited?: boolean;
  details?: unknown;
}

/**
 * Helper: convert our ChatRequest messages to OpenAI-compatible format
 */
export function toOpenAIMessages(request: ChatRequest): any[] {
  const messages: any[] = [];

  if (request.systemPrompt) {
    messages.push({ role: 'system', content: request.systemPrompt });
  }

  for (const msg of request.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content });
    } else {
      const parts: any[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push({ type: 'text', text: block.text });
        } else if (block.type === 'image') {
          if (block.source.type === 'base64') {
            parts.push({
              type: 'image_url',
              image_url: { url: `data:${block.source.mediaType};base64,${block.source.data}` },
            });
          } else {
            parts.push({
              type: 'image_url',
              image_url: { url: block.source.data },
            });
          }
        } else if (block.type === 'tool_result') {
          messages.push({
            role: 'tool',
            tool_call_id: block.toolUseId,
            content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          });
        }
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: parts.find(p => p.type === 'text')?.text || null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
      } else if (parts.length > 0) {
        messages.push({ role: msg.role, content: parts });
      }
    }
  }

  return messages;
}

/**
 * Helper: convert our ToolDefinition[] to OpenAI tools format
 */
export function toOpenAITools(tools?: ToolDefinition[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/**
 * Helper: parse OpenAI-format response
 */
export function parseOpenAIResponse(raw: any, modelName: string): ChatResponse {
  const choice = raw.choices?.[0];
  if (!choice) {
    throw new Error('No choices in response');
  }

  const message = choice.message || {};
  const toolCalls = message.tool_calls?.map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: typeof tc.function.arguments === 'string'
      ? JSON.parse(tc.function.arguments)
      : tc.function.arguments,
  }));

  return {
    content: message.content || '',
    role: 'assistant',
    toolCalls: toolCalls?.length > 0 ? toolCalls : undefined,
    finishReason: choice.finish_reason || 'stop',
    model: raw.model || modelName,
    usage: {
      inputTokens: raw.usage?.prompt_tokens || 0,
      outputTokens: raw.usage?.completion_tokens || 0,
      totalTokens: raw.usage?.total_tokens || 0,
    },
    latencyMs: 0,
    raw,
  };
}

/**
 * Helper: parse OpenAI streaming chunk
 */
export function parseOpenAIStreamChunk(line: string): ChatChunk | null {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return { finishReason: 'stop' };
  try {
    const chunk = JSON.parse(data);
    const choice = chunk.choices?.[0];
    if (!choice) return null;

    const delta = choice.delta || {};
    const result: ChatChunk = {};

    if (delta.content) {
      result.delta = { content: delta.content };
    }
    if (delta.tool_calls) {
      result.delta = {
        toolCalls: delta.tool_calls.map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name,
          arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : undefined,
        })),
      };
    }
    if (choice.finish_reason) {
      result.finishReason = choice.finish_reason;
    }
    if (chunk.usage) {
      result.usage = {
        inputTokens: chunk.usage.prompt_tokens || 0,
        outputTokens: chunk.usage.completion_tokens || 0,
        totalTokens: chunk.usage.total_tokens || 0,
      };
    }
    if (chunk.model) {
      result.model = chunk.model;
    }

    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}
