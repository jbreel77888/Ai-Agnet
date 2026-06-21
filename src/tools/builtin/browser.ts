/**
 * Browser Agent Tool — headless browser automation via Playwright
 *
 * Supports: navigation, screenshots, text extraction, clicking, form filling
 * Uses Playwright (chromium) in headless mode
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';

export class BrowserTool implements ITool {
  readonly name = 'browser';
  readonly description = 'Automate browser actions: navigate to URLs, take screenshots, extract text, click elements, fill forms. Use for web scraping and interaction.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'screenshot', 'extract_text', 'click', 'fill', 'evaluate', 'get_title', 'scroll'],
        description: 'Browser action to perform',
      },
      url: { type: 'string', description: 'URL to navigate to (for "navigate" action)' },
      selector: { type: 'string', description: 'CSS selector for click/fill/extract actions' },
      value: { type: 'string', description: 'Value to fill (for "fill" action)' },
      script: { type: 'string', description: 'JavaScript to evaluate (for "evaluate" action)' },
      wait: { type: 'integer', minimum: 0, maximum: 10000, default: 2000, description: 'Wait time in ms after action' },
    },
    required: ['action'],
    additionalProperties: false,
  };

  private browser: any = null;

  validate(args: any) {
    if (!args?.action) return { valid: false, errors: ['action is required'] };
    return { valid: true };
  }

  private async getBrowser() {
    if (this.browser) return this.browser;
    try {
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      return this.browser;
    } catch {
      throw new Error('Playwright not installed or chromium not available. Install with: npx playwright install chromium');
    }
  }

  async execute(args: any, _ctx: ToolContext): Promise<ToolResult> {
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      switch (args.action) {
        case 'navigate': {
          if (!args.url) return { success: false, error: { code: 'NO_URL', message: 'url is required for navigate' } };
          await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (args.wait) await page.waitForTimeout(args.wait);
          const title = await page.title();
          return { success: true, data: { title, url: page.url() } };
        }

        case 'screenshot': {
          const screenshot = await page.screenshot({ fullPage: false, type: 'png' });
          // Return as base64 (can be saved to storage)
          return { success: true, data: { screenshot_base64: screenshot.toString('base64'), size: screenshot.length } };
        }

        case 'extract_text': {
          if (args.selector) {
            const elements = await page.$$(args.selector);
            const texts = await Promise.all(elements.map(el => el.textContent()));
            return { success: true, data: { texts, count: texts.length } };
          }
          const text = await page.evaluate(() => document.body?.innerText?.substring(0, 5000) || '');
          return { success: true, data: { text, truncated: text.length >= 5000 } };
        }

        case 'click': {
          if (!args.selector) return { success: false, error: { code: 'NO_SELECTOR', message: 'selector is required for click' } };
          await page.click(args.selector, { timeout: 5000 });
          if (args.wait) await page.waitForTimeout(args.wait);
          return { success: true, data: { clicked: args.selector } };
        }

        case 'fill': {
          if (!args.selector || args.value === undefined) return { success: false, error: { code: 'MISSING', message: 'selector and value are required for fill' } };
          await page.fill(args.selector, args.value, { timeout: 5000 });
          return { success: true, data: { filled: args.selector, value: args.value } };
        }

        case 'evaluate': {
          if (!args.script) return { success: false, error: { code: 'NO_SCRIPT', message: 'script is required for evaluate' } };
          const result = await page.evaluate(args.script);
          return { success: true, data: { result } };
        }

        case 'get_title': {
          const title = await page.title();
          return { success: true, data: { title } };
        }

        case 'scroll': {
          await page.evaluate((amount) => window.scrollBy(0, amount || 500), args.value ? parseInt(args.value) : 500);
          if (args.wait) await page.waitForTimeout(args.wait);
          return { success: true, data: { scrolled: args.value || '500' } };
        }

        default:
          return { success: false, error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${args.action}` } };
      }
    } catch (err: any) {
      return { success: false, error: { code: 'BROWSER_ERROR', message: err.message } };
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

export function registerBrowserTool(): void {
  try {
    const { getToolRegistry } = require('../registry');
    const registry = getToolRegistry();
    registry.register(new BrowserTool());
    console.log('[tools] Registered browser tool');
  } catch (err) {
    console.warn('[tools] Browser tool not registered:', err);
  }
}
