/**
 * Web Scrape Tool — fetch a URL and convert to clean Markdown using Jina Reader.
 * ─────────────────────────────────────────────────────────────────────────────
 * Jina Reader (https://r.jina.ai/) is a free service that fetches any URL
 * and returns clean, LLM-friendly Markdown. No API key required.
 *
 * Usage: pass any https:// URL → get back Markdown content of the page.
 * Great for: research articles, documentation pages, blog posts, GitHub READMEs.
 *
 * For sites that block scraping, the Jina Reader proxy usually still works
 * because it has its own IP reputation + handles JS rendering.
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';

export class WebScrapeTool implements ITool {
  readonly name = 'web_scrape';
  readonly description = 'Fetch any URL and convert it to clean Markdown using Jina Reader. Returns the page content (text, headings, links, code blocks) without ads/navigation. Great for reading articles, docs, GitHub READMEs.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch and convert to Markdown (https://...)',
      },
      timeout: {
        type: 'integer',
        minimum: 5,
        maximum: 60,
        default: 20,
        description: 'Timeout in seconds',
      },
    },
    required: ['url'],
    additionalProperties: false,
  };

  validate(args: any) {
    if (!args?.url) return { valid: false, errors: ['url is required'] };
    try {
      const parsed = new URL(args.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, errors: ['Only http(s):// URLs are allowed'] };
      }
    } catch {
      return { valid: false, errors: ['Invalid URL'] };
    }
    return { valid: true };
  }

  async execute(args: {
    url: string;
    timeout?: number;
  }, _ctx: ToolContext): Promise<ToolResult> {
    try {
      // Jina Reader: prefix URL with https://r.jina.ai/
      const jinaUrl = `https://r.jina.ai/${args.url}`;
      const timeoutSec = args.timeout || 20;

      const res = await fetch(jinaUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/markdown',
          'X-Return-Format': 'markdown',
        },
        signal: AbortSignal.timeout(timeoutSec * 1000),
      });

      if (!res.ok) {
        return {
          success: false,
          error: {
            code: 'SCRAPE_ERROR',
            message: `Jina Reader returned HTTP ${res.status}`,
            details: await res.text().catch(() => ''),
          },
        };
      }

      const content = await res.text();
      const titleMatch = content.match(/^Title:\s*(.+)$/im);
      const urlMatch = content.match(/^URL Source:\s*(.+)$/im);
      const markdownMatch = content.match(/^Markdown Content:\s*\n([\s\S]*)$/im);

      const title = titleMatch?.[1]?.trim() || '';
      const sourceUrl = urlMatch?.[1]?.trim() || args.url;
      const markdown = markdownMatch?.[1]?.trim() || content;

      // Truncate very long content
      const maxLen = 20000;
      const truncated = markdown.length > maxLen
        ? markdown.substring(0, maxLen) + `\n\n... [truncated, full length ${markdown.length}]`
        : markdown;

      return {
        success: true,
        data: {
          title,
          url: sourceUrl,
          content: truncated,
          length: markdown.length,
          truncated: markdown.length > maxLen,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'SCRAPE_ERROR', message: err.message },
      };
    }
  }
}
