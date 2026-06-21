/**
 * Built-in Tools — calculator, http_request, memory_search, memory_store,
 * web_search (Tavily), web_scrape (Jina), code_execution (Tensorlake stateful),
 * file_manager, shell
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';

export class CalculatorTool implements ITool {
  readonly name = 'calculator';
  readonly description = 'Perform mathematical calculations. Supports +, -, *, /, parentheses, ^ (power), %, and common Math functions (sqrt, sin, cos, log, etc.).';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: { expression: { type: 'string', description: 'Mathematical expression to evaluate (e.g. "2 + 3 * 4", "sqrt(16) + log(100)", "Math.PI * 2")' } },
    required: ['expression'], additionalProperties: false,
  };
  validate(args: any) {
    if (!args?.expression) return { valid: false, errors: ['expression is required'] };
    if (typeof args.expression !== 'string') return { valid: false, errors: ['expression must be a string'] };
    if (args.expression.length > 500) return { valid: false, errors: ['expression too long (max 500 chars)'] };
    // Whitelist of allowed characters — block anything that could be code injection
    // Allowed: digits, operators, parentheses, decimal points, commas, spaces,
    // Math.* function names, common math constants, and the keywords themselves.
    const safe = /^[0-9+\-*/().,%\s]*(Math\.(PI|E|LN2|LN10|LOG2E|LOG10E|SQRT2|sqrt|cbrt|abs|sign|ceil|floor|round|trunc|exp|log|log2|log10|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|min|max|hypot|random|floor|cbrt|expm1|log1p|clz32|fround|imul))*[0-9+\-*/().,%\s]*$/i;
    if (!safe.test(args.expression)) {
      return { valid: false, errors: ['Expression contains disallowed characters or functions'] };
    }
    return { valid: true };
  }
  async execute(args: { expression: string }, _ctx: ToolContext): Promise<ToolResult> {
    try {
      // Safe evaluation: Function constructor with only Math in scope,
      // wrapped in strict mode, plus whitelist validation in validate().
      // The validator above blocks arbitrary identifiers and string literals.
      const result = Function('Math', `"use strict"; return (${args.expression})`)(Math);
      if (typeof result !== 'number' || !isFinite(result)) {
        return { success: false, error: { code: 'INVALID_RESULT', message: `Not a valid number: ${result}` } };
      }
      return { success: true, data: { result, expression: args.expression } };
    } catch (err: any) {
      return { success: false, error: { code: 'EVAL_ERROR', message: err.message } };
    }
  }
}

export class HttpRequestTool implements ITool {
  readonly name = 'http_request';
  readonly description = 'Make an HTTP request to any public URL. Returns status, headers, and body. Blocks private/internal IPs for security (SSRF protection).';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to request (must be http(s)://)' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
      headers: { type: 'object' },
      body: { type: 'string' },
      timeoutMs: { type: 'integer', default: 10000, description: 'Request timeout in milliseconds (max 30000)' },
    },
    required: ['url'], additionalProperties: false,
  };

  /**
   * SSRF protection — block requests to private/internal IP ranges and localhost.
   * - 127.0.0.0/8 (loopback)
   * - 10.0.0.0/8 (RFC1918 private)
   * - 172.16.0.0/12 (RFC1918 private)
   * - 192.168.0.0/16 (RFC1918 private)
   * - 169.254.0.0/16 (link-local, includes AWS metadata 169.254.169.254)
   * - 0.0.0.0/8
   * - ::1, fc00::/7, fe80::/10 (IPv6 equivalents)
   * - 'localhost' hostname
   * - *.internal, *.local, *.railway.internal (cloud-internal hostnames)
   */
  private isPrivateHost(hostname: string): boolean {
    const h = hostname.toLowerCase().trim();
    if (h === 'localhost' || h === '0.0.0.0' || h === '::1') return true;
    if (h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.railway.internal')) return true;
    // IPv4 numeric check
    const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [, a, b] = ipv4.map(Number) as any[];
      if (a === 0) return true;                              // 0.0.0.0/8
      if (a === 10) return true;                             // 10.0.0.0/8
      if (a === 127) return true;                            // 127.0.0.0/8 (loopback)
      if (a === 169 && b === 254) return true;               // 169.254.0.0/16 (link-local + AWS metadata!)
      if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
      if (a === 192 && b === 168) return true;               // 192.168.0.0/16
    }
    // IPv6 — block all non-global (loopback, link-local, unique-local)
    if (h === '::1' || h === '::' || h === '::ffff:127.0.0.1') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;  // fc00::/7 unique-local
    if (h.startsWith('fe80')) return true;                       // link-local
    if (h.startsWith('fe90') || h.startsWith('fea0') || h.startsWith('feb0') || h.startsWith('fec0')) return true;
    return false;
  }

  validate(args: any) {
    if (!args?.url) return { valid: false, errors: ['url is required'] };
    let parsed: URL;
    try { parsed = new URL(args.url); } catch { return { valid: false, errors: ['Invalid URL'] }; }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, errors: ['Only http(s):// URLs are allowed'] };
    }
    if (this.isPrivateHost(parsed.hostname)) {
      return { valid: false, errors: [`Blocked: '${parsed.hostname}' is a private/internal address (SSRF protection)`] };
    }
    if (args.timeoutMs && (args.timeoutMs < 1000 || args.timeoutMs > 30000)) {
      return { valid: false, errors: ['timeoutMs must be between 1000 and 30000'] };
    }
    return { valid: true };
  }
  async execute(args: any, _ctx: ToolContext): Promise<ToolResult> {
    try {
      // Double-check at execution time (in case validate was bypassed)
      const parsed = new URL(args.url);
      if (this.isPrivateHost(parsed.hostname)) {
        return { success: false, error: { code: 'SSRF_BLOCKED', message: `Blocked: '${parsed.hostname}' is a private/internal address` } };
      }
      const timeoutMs = Math.min(args.timeoutMs || 10000, 30000);
      const res = await fetch(args.url, {
        method: args.method || 'GET',
        headers: args.headers,
        body: args.body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let data: any = text;
      try { data = JSON.parse(text); } catch {}
      return {
        success: true,
        data: {
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
          body: data,
          bodyLength: text.length,
        },
      };
    } catch (err: any) {
      return { success: false, error: { code: 'HTTP_ERROR', message: err.message } };
    }
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

/**
 * @deprecated Use TavilySearchTool from ./tavily.ts instead.
 * The old DuckDuckGo web_search was unreliable and returned almost no results.
 * Kept here as a fallback only when TAVILY_API_KEY is not set.
 */
export class WebSearchTool implements ITool {
  readonly name = 'web_search';
  readonly description = 'Search the web (fallback DuckDuckGo — limited results). When TAVILY_API_KEY is set, the TavilySearchTool is registered instead.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: { query: { type: 'string' }, max_results: { type: 'integer', default: 5 } },
    required: ['query'], additionalProperties: false,
  };
  validate(args: any) { return args?.query ? { valid: true } : { valid: false, errors: ['query required'] }; }
  async execute(args: { query: string; max_results?: number }, _ctx: ToolContext): Promise<ToolResult> {
    const max = args.max_results || 5;
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

  // ── Core tools (always available) ──────────────────────────────────────
  registry.register(new CalculatorTool());
  registry.register(new HttpRequestTool());
  registry.register(new MemorySearchTool());
  registry.register(new MemoryStoreTool());

  // ── Web search: prefer Tavily, fall back to DuckDuckGo ────────────────
  if (process.env.TAVILY_API_KEY) {
    try {
      const { TavilySearchTool } = require('./tavily');
      registry.register(new TavilySearchTool());
      console.log('[tools] Registered Tavily web_search');
    } catch (err: any) {
      console.warn('[tools] Tavily load failed, using DuckDuckGo:', err.message);
      registry.register(new WebSearchTool());
    }
  } else {
    registry.register(new WebSearchTool());
  }

  // ── Web scrape (Jina Reader — no API key needed) ───────────────────────
  try {
    const { WebScrapeTool } = require('./web_scrape');
    registry.register(new WebScrapeTool());
    console.log('[tools] Registered web_scrape (Jina Reader)');
  } catch (err: any) {
    console.warn('[tools] web_scrape registration failed:', err.message);
  }

  // ── Stateful sandbox tools (Tensorlake) ───────────────────────────────
  if (process.env.TENSORLAKE_API_KEY) {
    try {
      const { TensorlakeSandboxTool } = require('./tensorlake');
      registry.register(new TensorlakeSandboxTool());
      console.log('[tools] Registered code_execution (Tensorlake stateful)');
    } catch (err: any) {
      console.warn('[tools] Tensorlake code_execution failed:', err.message);
    }
    try {
      const { FileManagerTool } = require('./file_manager');
      registry.register(new FileManagerTool());
      console.log('[tools] Registered file_manager');
    } catch (err: any) {
      console.warn('[tools] file_manager registration failed:', err.message);
    }
    try {
      const { ShellTool } = require('./shell');
      registry.register(new ShellTool());
      console.log('[tools] Registered shell');
    } catch (err: any) {
      console.warn('[tools] shell registration failed:', err.message);
    }
  } else {
    console.log('[tools] Sandbox tools skipped (no TENSORLAKE_API_KEY)');
  }

  // ── Browser tool (Playwright) ─────────────────────────────────────────
  try {
    const { BrowserTool } = require('./browser');
    registry.register(new BrowserTool());
  } catch (err: any) {
    console.warn('[tools] Browser tool not registered:', err.message);
  }

  // ── GitHub integration ────────────────────────────────────────────────
  try {
    const { GitHubIntegration } = require('../../integrations/github');
    const gh = new GitHubIntegration();
    const ghTool = {
      name: 'github',
      description: 'Interact with GitHub: list repos, issues, create issues, get files',
      category: 'integration',
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list_repos', 'list_issues', 'create_issue', 'get_file'] },
          owner: { type: 'string' }, repo: { type: 'string' },
          title: { type: 'string' }, body: { type: 'string' },
          path: { type: 'string' }, branch: { type: 'string' }, username: { type: 'string' },
        },
        required: ['action'],
      },
      validate: (args: any) => ({ valid: !!args?.action }),
      execute: async (args: any) => {
        switch (args.action) {
          case 'list_repos': return gh.listRepos(args.username);
          case 'list_issues': return gh.listIssues(args.owner, args.repo);
          case 'create_issue': return gh.createIssue(args.owner, args.repo, args.title, args.body || '');
          case 'get_file': return gh.getFile(args.owner, args.repo, args.path, args.branch);
          default: return { success: false, error: { code: 'UNKNOWN', message: `Unknown action: ${args.action}` } };
        }
      },
      initialize: async () => {}, shutdown: async () => {},
    };
    registry.register(ghTool);
  } catch {}

  const count = registry.list().length;
  console.log(`[tools] Registered ${count} tools`);
}
