/**
 * OpenAI Strategy
 * Works for: OpenAI, Groq, OpenRouter, Ollama, OpenAI-compatible providers
 */
import type { ChatRequest } from '../../../types';
import {
  IProviderStrategy, ProviderErrorInfo,
  toOpenAIMessages, toOpenAITools,
  parseOpenAIResponse, parseOpenAIStreamChunk,
} from './base';

export class OpenAIStrategy implements IProviderStrategy {
  readonly type = 'openai';

  buildRequest(request: ChatRequest, baseUrl: string, apiKey: string, headers?: Record<string, string>) {
    const body: any = {
      model: request.modelId,
      messages: toOpenAIMessages(request),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      top_p: request.topP ?? 1,
      stream: request.stream ?? false,
    };

    if (request.stopSequences && request.stopSequences.length > 0) {
      body.stop = request.stopSequences;
    }

    const tools = toOpenAITools(request.tools);
    if (tools) {
      body.tools = tools;
      body.tool_choice = request.toolChoice === 'auto' ? 'auto'
        : request.toolChoice === 'none' ? 'none'
        : request.toolChoice === 'required' ? 'required'
        : request.toolChoice && typeof request.toolChoice === 'object'
          ? { type: 'function', function: { name: request.toolChoice.name } }
          : 'auto';
    }

    if (request.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    return {
      url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(headers || {}),
      },
      body,
    };
  }

  parseResponse = parseOpenAIResponse;
  parseStreamChunk = parseOpenAIStreamChunk;

  extractUsage(raw: any) {
    return {
      inputTokens: raw.usage?.prompt_tokens || 0,
      outputTokens: raw.usage?.completion_tokens || 0,
      totalTokens: raw.usage?.total_tokens || 0,
    };
  }

  classifyError(status: number, body: any): ProviderErrorInfo {
    const errorMsg = body?.error?.message || body?.message || `HTTP ${status}`;
    const errorCode = body?.error?.code || body?.error?.type || `HTTP_${status}`;

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
      name: m.id,
    }));
  }
}
