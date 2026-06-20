/**
 * Google Gemini Strategy
 * Uses Gemini's generateContent / streamGenerateContent API
 */
import type { ChatRequest, ChatResponse, ChatChunk, TokenUsage } from '../../../types';
import { IProviderStrategy, ProviderErrorInfo } from './base';

export class GeminiStrategy implements IProviderStrategy {
  readonly type = 'gemini';

  buildRequest(request: ChatRequest, baseUrl: string, apiKey: string, headers?: Record<string, string>) {
    const systemInstruction = request.systemPrompt
      ? { parts: [{ text: request.systemPrompt }] }
      : undefined;

    const contents: any[] = [];
    for (const msg of request.messages) {
      if (msg.role === 'system') continue;

      const role = msg.role === 'assistant' ? 'model' : msg.role === 'tool' ? 'function' : 'user';

      if (typeof msg.content === 'string') {
        contents.push({ role, parts: [{ text: msg.content }] });
        continue;
      }

      const parts: any[] = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text });
        } else if (block.type === 'image') {
          if (block.source.type === 'base64') {
            parts.push({
              inline_data: {
                mime_type: block.source.mediaType,
                data: block.source.data,
              },
            });
          }
        } else if (block.type === 'tool_result') {
          parts.push({
            functionResponse: {
              name: block.toolUseId,
              response: { result: typeof block.content === 'string' ? block.content : block.content },
            },
          });
        }
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: { name: tc.name, args: tc.arguments },
          });
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    const body: any = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
        topP: request.topP ?? 1,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (request.stopSequences && request.stopSequences.length > 0) {
      body.generationConfig.stopSequences = request.stopSequences;
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      }];
    }

    if (request.responseFormat === 'json') {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const endpoint = request.stream ? 'streamGenerateContent' : 'generateContent';
    const url = `${baseUrl.replace(/\/$/, '')}/models/${request.modelId}:${endpoint}?key=${apiKey}`;

    return {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {}),
      },
      body,
    };
  }

  parseResponse(raw: any, modelName: string): ChatResponse {
    let text = '';
    const toolCalls: any[] = [];

    for (const candidate of raw.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.text) {
          text += part.text;
        }
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${Math.random().toString(36).slice(2, 10)}`,
            name: part.functionCall.name,
            arguments: part.functionCall.args,
          });
        }
      }
    }

    const finishReason = raw.candidates?.[0]?.finishReason;
    return {
      content: text,
      role: 'assistant',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: finishReason === 'STOP' ? 'stop'
        : finishReason === 'MAX_TOKENS' ? 'length'
        : finishReason === 'SAFETY' ? 'content_filter'
        : 'stop',
      model: modelName,
      usage: {
        inputTokens: raw.usageMetadata?.promptTokenCount || 0,
        outputTokens: raw.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: raw.usageMetadata?.totalTokenCount || 0,
      },
      latencyMs: 0,
      raw,
    };
  }

  parseStreamChunk(line: string): ChatChunk | null {
    // Gemini streaming returns JSON array chunks
    try {
      const data = line.trim();
      if (!data || data.startsWith('[') || data.startsWith(']')) return null;
      const chunk = JSON.parse(data.endsWith(']') ? data.slice(0, -1) : data.endsWith(',') ? data.slice(0, -1) : data);

      const candidate = chunk.candidates?.[0];
      if (!candidate) return null;

      const result: ChatChunk = {};
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.text) {
          result.delta = { content: part.text };
        }
        if (part.functionCall) {
          result.delta = {
            toolCalls: [{
              id: `call_${Math.random().toString(36).slice(2, 10)}`,
              name: part.functionCall.name,
              arguments: part.functionCall.args,
            }],
          };
        }
      }

      if (candidate.finishReason) {
        result.finishReason = candidate.finishReason === 'STOP' ? 'stop'
          : candidate.finishReason === 'MAX_TOKENS' ? 'length'
          : 'stop';
      }

      if (chunk.usageMetadata) {
        result.usage = {
          inputTokens: chunk.usageMetadata.promptTokenCount || 0,
          outputTokens: chunk.usageMetadata.candidatesTokenCount || 0,
          totalTokens: chunk.usageMetadata.totalTokenCount || 0,
        };
      }

      return Object.keys(result).length > 0 ? result : null;
    } catch {
      return null;
    }
  }

  extractUsage(raw: any): TokenUsage {
    return {
      inputTokens: raw.usageMetadata?.promptTokenCount || 0,
      outputTokens: raw.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: raw.usageMetadata?.totalTokenCount || 0,
    };
  }

  classifyError(status: number, body: any): ProviderErrorInfo {
    const errorMsg = body?.error?.message || `HTTP ${status}`;
    const errorCode = body?.error?.status || `HTTP_${status}`;

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
    return (raw.models || []).map((m: any) => ({
      id: m.name.replace('models/', ''),
      name: m.displayName || m.name,
    }));
  }
}
