/**
 * Built-in Tools — calculator, http_request, memory_search, memory_store, web_search
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';

export class CalculatorTool implements ITool {
  readonly name = 'calculator';
  readonly description = 'Perform mathematical calculations. Supports +, -, *, /, parentheses, Math functions.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: { expression: { type: 'string', description: 'Mathematical expression to evaluate' } },
    required: ['expression'], additionalProperties: false,
  };
  validate(args: any) {
    if (!args?.expression) return { valid: false, errors: ['expression is required'] };
    return { valid: true };
  }
  async execute(args: { expression: string }, _ctx: ToolContext): Promise<ToolResult> {
    try {
      const result = Function('Math', `"use strict"; return (${args.expression})`)(Math);
      if (typeof result !== 'number' || !isFinite(result)) return { success: false, error: { code: 'INVALID_RESULT', message: `Not a valid number: ${result}` } };
      return { success: true, data: { result } };
    } catch (err: any) { return { success: false, error: { code: 'EVAL_ERROR', message: err.message } }; }
  }
}

export class HttpRequestTool implements ITool {
  readonly name = 'http_request';
  readonly description = 'Make an HTTP request to any URL. Returns status, headers, and body.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to request' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
      headers: { type: 'object' },
      body: { type: 'string' },
    },
    required: ['url'], additionalProperties: false,
  };
  validate(args: any) {
    if (!args?.url) return { valid: false, errors: ['url is required'] };
    try { new URL(args.url); } catch { return { valid: false, errors: ['Invalid URL'] }; }
    return { valid: true };
  }
  async execute(args: any, _ctx: ToolContext): Promise<ToolResult> {
    try {
      const res = await fetch(args.url, { method: args.method || 'GET', headers: args.headers, body: args.body, signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      let data: any = text;
      try { data = JSON.parse(text); } catch {}
      return { success: true, data: { status: res.status, body: data } };
    } catch (err: any) { return { success: false, error: { code: 'HTTP_ERROR', message: err.message } }; }
  }
}

export class MemorySearchTool implements ITool {
  readonly name = 'memory_search';
  readonly description = 'Search long-term memory for relevant facts and context.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: { query: { type: 'string' }, topK: { type: 'integer', default: 5 } },
    required: ['query'], additionalProperties: false,
  };
  validate(args: any) { return args?.query ? { valid: true } : { valid: false, errors: ['query required'] }; }
  async execute(args: { query: string; topK?: number }, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { createLongTermMemory } = await import('../../memory/long-term');
      const memory = createLongTermMemory();
      const results = await memory.search({ text: args.query, userId: ctx.userId, topK: args.topK || 5, minScore: 0.3 });
      return { success: true, data: { results: results.map(r => ({ fact: r.record.fact, score: r.score })), count: results.length } };
    } catch (err: any) { return { success: false, error: { code: 'MEMORY_ERROR', message: err.message } }; }
  }
}

export class MemoryStoreTool implements ITool {
  readonly name = 'memory_store';
  readonly description = 'Store a fact in long-term memory for future reference.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: { fact: { type: 'string' }, type: { type: 'string', enum: ['preference', 'entity', 'event', 'summary', 'custom'], default: 'custom' }, importance: { type: 'number', default: 0.5 } },
    required: ['fact'], additionalProperties: false,
  };
  validate(args: any) { return args?.fact ? { valid: true } : { valid: false, errors: ['fact required'] }; }
  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { createLongTermMemory } = await import('../../memory/long-term');
      const memory = createLongTermMemory();
      const record = await memory.storeFact(args.fact, args.type || 'custom', { userId: ctx.userId, sessionId: ctx.sessionId, importance: args.importance ?? 0.5 });
      return { success: true, data: { id: record.id, fact: record.fact } };
    } catch (err: any) { return { success: false, error: { code: 'MEMORY_ERROR', message: err.message } }; }
  }
}

export class WebSearchTool implements ITool {
  readonly name = 'web_search';
  readonly description = 'Search the web for current information. Returns titles, URLs, and snippets.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: { query: { type: 'string' }, max_results: { type: 'integer', default: 5 } },
    required: ['query'], additionalProperties: false,
  };
  validate(args: any) { return args?.query ? { valid: true } : { valid: false, errors: ['query required'] }; }
  async execute(args: { query: string; max_results?: number }, _ctx: ToolContext): Promise<ToolResult> {
    const max = args.max_results || 5;
    // DuckDuckGo fallback (no API key needed)
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1`, { signal: AbortSignal.timeout(10000) });
      const data = await res.json() as any;
      const results: any[] = [];
      if (data.AbstractText) results.push({ title: data.Heading || args.query, url: data.AbstractURL || '', content: data.AbstractText });
      if (data.RelatedTopics) for (const t of data.RelatedTopics.slice(0, max - results.length)) if (t.Text && t.FirstURL) results.push({ title: t.Text.substring(0, 80), url: t.FirstURL, content: t.Text });
      return { success: true, data: { results, count: results.length } };
    } catch (err: any) { return { success: false, error: { code: 'SEARCH_ERROR', message: err.message } }; }
  }
}

export function registerBuiltinTools(): void {
  const { getToolRegistry } = require('../registry');
  const registry = getToolRegistry();
  registry.register(new CalculatorTool());
  registry.register(new HttpRequestTool());
  registry.register(new MemorySearchTool());
  registry.register(new MemoryStoreTool());
  registry.register(new WebSearchTool());
  console.log('[tools] Registered 5 built-in tools');
}
