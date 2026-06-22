/**
 * Tavily Web Search Tool — AI-optimized search engine.
 * ─────────────────────────────────────────────────────────────────────────────
 * Tavily is purpose-built for AI agents: returns clean, summarized results
 * with full content, not just snippets. Free tier: 1000 searches/month.
 *
 * Requires TAVILY_API_KEY environment variable.
 *
 * Features:
 *   - Basic search (returns titles + URLs + content)
 *   - Advanced search (returns full answer + summaries)
 *   - Topic filter: general / news / finance
 *   - Time filter: day / week / month / year
 *   - Include raw content for follow-up processing
 *   - Max results configurable (1-10, default 5)
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';

export class TavilySearchTool implements ITool {
  readonly name = 'web_search';
  readonly description = 'Search the web using Tavily AI-optimized search. Returns titles, URLs, and full content snippets. Best for research, current events, factual lookups. Supports news and finance filters.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      max_results: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        default: 5,
        description: 'Maximum number of results (1-10)',
      },
      topic: {
        type: 'string',
        enum: ['general', 'news', 'finance'],
        default: 'general',
        description: 'Search topic filter',
      },
      time_filter: {
        type: 'string',
        enum: ['day', 'week', 'month', 'year'],
        description: 'Optional time filter (last day/week/month/year)',
      },
      include_answer: {
        type: 'boolean',
        default: true,
        description: 'Include an AI-generated summary answer',
      },
    },
    required: ['query'],
    additionalProperties: false,
  };

  validate(args: any) {
    if (!args?.query) return { valid: false, errors: ['query is required'] };
    if (typeof args.query !== 'string') return { valid: false, errors: ['query must be a string'] };
    if (args.query.length > 1000) return { valid: false, errors: ['query too long (max 1000 chars)'] };
    return { valid: true };
  }

  async execute(args: {
    query: string;
    max_results?: number;
    topic?: string;
    time_filter?: string;
    include_answer?: boolean;
  }, _ctx: ToolContext): Promise<ToolResult> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: { code: 'NO_API_KEY', message: 'TAVILY_API_KEY not set. Add it as an environment variable.' },
      };
    }

    try {
      const body: any = {
        query: args.query,
        max_results: Math.min(args.max_results || 5, 10),
        topic: args.topic || 'general',
        include_answer: args.include_answer !== false,
        include_raw_content: false,
        search_depth: 'basic',
      };
      if (args.time_filter) {
        body.days = args.time_filter === 'day' ? 1 : args.time_filter === 'week' ? 7 : args.time_filter === 'month' ? 30 : 365;
      }

      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          success: false,
          error: {
            code: 'TAVILY_ERROR',
            message: `Tavily API error: HTTP ${res.status}`,
            details: errText.substring(0, 500),
          },
        };
      }

      const data = await res.json() as any;

      // Format results
      const results = (data.results || []).map((r: any, i: number) => ({
        index: i + 1,
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        score: r.score,
        publishedDate: r.published_date,
      }));

      return {
        success: true,
        data: {
          answer: data.answer || null,
          results,
          count: results.length,
          query: args.query,
          topic: args.topic || 'general',
          responseTime: data.response_time,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'SEARCH_ERROR', message: err.message },
      };
    }
  }
}
