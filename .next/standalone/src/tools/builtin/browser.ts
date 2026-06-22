/**
 * Browser Tool — STATEFUL headless browser automation via Playwright.
 * ─────────────────────────────────────────────────────────────────────────────
 * Each session gets its own browser + page that persist across tool calls.
 * This means:
 *   - Login in step 1 → cookies/session persist → can click in step 2
 *   - Navigation history is maintained
 *   - Page state (scroll position, form inputs) persists
 *
 * The browser instance is cached in-memory keyed by sessionId.
 * It's closed when:
 *   - The session is deleted (via orchestrator.deleteSession)
 *   - The process shuts down
 *   - Explicit 'close' action is called
 *
 * Actions:
 *   navigate, screenshot, extract_text, click, fill, evaluate,
 *   get_title, scroll, go_back, go_forward, get_url, wait_for,
 *   press_key, hover, select_option, close
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Per-session browser state cache
// ─────────────────────────────────────────────────────────────────────────────
interface BrowserSession {
  browser: any;
  context: any;
  page: any;
  createdAt: number;
  lastUsedAt: number;
}

const browserSessions = new Map<string, BrowserSession>();

// Cleanup idle browser sessions older than 10 minutes
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();

async function cleanupIdleSessions(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return; // check every 1 min
  lastCleanup = now;
  for (const [sessionId, session] of browserSessions.entries()) {
    if (now - session.lastUsedAt > IDLE_TIMEOUT_MS) {
      try {
        await session.browser?.close();
      } catch {}
      browserSessions.delete(sessionId);
      console.log(`[browser] Cleaned up idle session ${sessionId}`);
    }
  }
}

async function getSessionBrowser(sessionId: string): Promise<BrowserSession> {
  // Check if we already have a browser for this session
  let session = browserSessions.get(sessionId);
  if (session) {
    session.lastUsedAt = Date.now();
    // Verify the browser is still alive
    try {
      // Quick health check — if the browser crashed, this will throw
      await session.page.evaluate(() => 1);
      return session;
    } catch {
      // Browser/page is dead — clean up and recreate
      try { await session.browser?.close(); } catch {}
      browserSessions.delete(sessionId);
    }
  }

  // Create new browser session
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // fix for low-memory containers
      '--disable-gpu',
      '--single-process',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  session = { browser, context, page, createdAt: Date.now(), lastUsedAt: Date.now() };
  browserSessions.set(sessionId, session);
  console.log(`[browser] New browser session for ${sessionId}`);
  return session;
}

export class BrowserTool implements ITool {
  readonly name = 'browser';
  readonly description = 'Automate a STATEFUL headless browser: navigate, screenshot, click, fill, extract text, scroll, evaluate JS, go back/forward. Browser session persists across calls (cookies, login state, page history all maintained within a session). Use for web scraping, form filling, multi-step interactions.';
  readonly category = 'builtin';
  readonly timeoutMs = 30_000;
  readonly schema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'screenshot', 'extract_text', 'click', 'fill', 'evaluate', 'get_title', 'scroll', 'go_back', 'go_forward', 'get_url', 'wait_for', 'press_key', 'hover', 'select_option', 'close'],
        description: 'Browser action to perform',
      },
      url: { type: 'string', description: 'URL to navigate to (for "navigate" action)' },
      selector: { type: 'string', description: 'CSS selector for click/fill/hover/extract/select actions' },
      value: { type: 'string', description: 'Value to fill or select (for "fill"/"select_option" actions)' },
      script: { type: 'string', description: 'JavaScript to evaluate (for "evaluate" action)' },
      key: { type: 'string', description: 'Key to press (for "press_key" action, e.g. "Enter", "Tab")' },
      wait: { type: 'integer', minimum: 0, maximum: 10000, default: 2000, description: 'Wait time in ms after action' },
      fullPage: { type: 'boolean', default: false, description: 'For screenshot: capture full page or just viewport' },
    },
    required: ['action'],
    additionalProperties: false,
  };

  validate(args: any) {
    if (!args?.action) return { valid: false, errors: ['action is required'] };
    const validActions = ['navigate', 'screenshot', 'extract_text', 'click', 'fill', 'evaluate', 'get_title', 'scroll', 'go_back', 'go_forward', 'get_url', 'wait_for', 'press_key', 'hover', 'select_option', 'close'];
    if (!validActions.includes(args.action)) {
      return { valid: false, errors: [`Invalid action: ${args.action}. Valid: ${validActions.join(', ')}`] };
    }
    if (args.action === 'navigate' && !args.url) {
      return { valid: false, errors: ['url is required for navigate action'] };
    }
    if (args.action === 'fill' && (!args.selector || args.value === undefined)) {
      return { valid: false, errors: ['selector and value are required for fill action'] };
    }
    if (args.action === 'click' && !args.selector) {
      return { valid: false, errors: ['selector is required for click action'] };
    }
    if (args.action === 'evaluate' && !args.script) {
      return { valid: false, errors: ['script is required for evaluate action'] };
    }
    return { valid: true };
  }

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    // Clean up idle browser sessions periodically
    await cleanupIdleSessions().catch(() => {});

    if (!ctx.sessionId) {
      return { success: false, error: { code: 'NO_SESSION', message: 'browser tool requires a session context' } };
    }

    try {
      // Handle 'close' action specially
      if (args.action === 'close') {
        const session = browserSessions.get(ctx.sessionId);
        if (session) {
          await session.browser?.close();
          browserSessions.delete(ctx.sessionId);
          return { success: true, data: { closed: true, sessionId: ctx.sessionId } };
        }
        return { success: true, data: { closed: false, message: 'No active browser session' } };
      }

      const session = await getSessionBrowser(ctx.sessionId);
      const page = session.page;

      switch (args.action) {
        case 'navigate': {
          await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          if (args.wait) await page.waitForTimeout(args.wait);
          const title = await page.title();
          return {
            success: true,
            data: { title, url: page.url(), action: 'navigate' },
          };
        }

        case 'screenshot': {
          const screenshot = await page.screenshot({
            fullPage: args.fullPage || false,
            type: 'png',
          });
          const base64 = screenshot.toString('base64');
          // Truncate for tool result (full base64 is too large for LLM context)
          // Return metadata + a truncated preview
          return {
            success: true,
            data: {
              screenshot_base64: base64,
              size: screenshot.length,
              fullPage: args.fullPage || false,
              url: page.url(),
              note: 'Screenshot captured. The image is available as base64 data.',
            },
          };
        }

        case 'extract_text': {
          if (args.selector) {
            const elements = await page.$$(args.selector);
            const texts = await Promise.all(elements.map(el => el.textContent()));
            return { success: true, data: { texts, count: texts.length, selector: args.selector } };
          }
          const text = await page.evaluate(() => document.body?.innerText?.substring(0, 8000) || '');
          return {
            success: true,
            data: {
              text,
              truncated: text.length >= 8000,
              url: page.url(),
            },
          };
        }

        case 'click': {
          await page.click(args.selector, { timeout: 5000 });
          if (args.wait) await page.waitForTimeout(args.wait);
          return { success: true, data: { clicked: args.selector, url: page.url() } };
        }

        case 'fill': {
          await page.fill(args.selector, args.value, { timeout: 5000 });
          return { success: true, data: { filled: args.selector, value: args.value } };
        }

        case 'evaluate': {
          const result = await page.evaluate(args.script);
          return { success: true, data: { result } };
        }

        case 'get_title': {
          const title = await page.title();
          return { success: true, data: { title, url: page.url() } };
        }

        case 'scroll': {
          const amount = args.value ? parseInt(args.value) : 500;
          await page.evaluate((a) => window.scrollBy(0, a), amount);
          if (args.wait) await page.waitForTimeout(args.wait);
          return { success: true, data: { scrolled: amount, url: page.url() } };
        }

        case 'go_back': {
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
          if (args.wait) await page.waitForTimeout(args.wait);
          return { success: true, data: { url: page.url(), title: await page.title() } };
        }

        case 'go_forward': {
          await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 });
          if (args.wait) await page.waitForTimeout(args.wait);
          return { success: true, data: { url: page.url(), title: await page.title() } };
        }

        case 'get_url': {
          return { success: true, data: { url: page.url(), title: await page.title() } };
        }

        case 'wait_for': {
          if (args.selector) {
            await page.waitForSelector(args.selector, { timeout: args.wait || 10000 });
            return { success: true, data: { waitedFor: args.selector, found: true } };
          }
          await page.waitForTimeout(args.wait || 2000);
          return { success: true, data: { waited: args.wait || 2000 } };
        }

        case 'press_key': {
          if (!args.key) return { success: false, error: { code: 'NO_KEY', message: 'key is required for press_key' } };
          await page.keyboard.press(args.key);
          if (args.wait) await page.waitForTimeout(args.wait);
          return { success: true, data: { pressed: args.key } };
        }

        case 'hover': {
          if (!args.selector) return { success: false, error: { code: 'NO_SELECTOR', message: 'selector is required for hover' } };
          await page.hover(args.selector, { timeout: 5000 });
          return { success: true, data: { hovered: args.selector } };
        }

        case 'select_option': {
          if (!args.selector || !args.value) return { success: false, error: { code: 'MISSING', message: 'selector and value required for select_option' } };
          await page.selectOption(args.selector, args.value, { timeout: 5000 });
          return { success: true, data: { selected: args.selector, value: args.value } };
        }

        default:
          return { success: false, error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${args.action}` } };
      }
    } catch (err: any) {
      // If the browser crashed, clean up the session
      if (err.message?.includes('Target closed') || err.message?.includes('Browser closed') || err.message?.includes('Connection closed')) {
        const session = browserSessions.get(ctx.sessionId);
        if (session) {
          try { await session.browser?.close(); } catch {}
          browserSessions.delete(ctx.sessionId);
        }
      }
      return { success: false, error: { code: 'BROWSER_ERROR', message: err.message } };
    }
  }
}

export function registerBrowserTool(): void {
  try {
    const { getToolRegistry } = require('../registry');
    const registry = getToolRegistry();
    registry.register(new BrowserTool());
    console.log('[tools] Registered browser tool (stateful)');
  } catch (err) {
    console.warn('[tools] Browser tool not registered:', err);
  }
}

/**
 * Close all browser sessions for a given session (called on session delete).
 */
export async function closeSessionBrowser(sessionId: string): Promise<void> {
  const session = browserSessions.get(sessionId);
  if (session) {
    try { await session.browser?.close(); } catch {}
    browserSessions.delete(sessionId);
    console.log(`[browser] Closed browser for session ${sessionId}`);
  }
}
