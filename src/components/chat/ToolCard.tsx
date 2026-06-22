'use client';

/**
 * ToolCard — Manus-style tool call card.
 *
 * Unlike a raw JSON dump, this card presents each tool invocation in a clean,
 * human-readable way:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ 🔧  Web Search                       ✓  ·  234ms     │
 *   │     Query: what is Python                            │
 *   │     ─ 3 results · top: Python (programming language) │
 *   └──────────────────────────────────────────────────────┘
 *
 * Per-tool formatters (in `TOOL_FORMATTERS`) map a `toolName` to:
 *   - `icon`     — lucide-react icon component
 *   - `title`    — human-readable title (e.g. "Web Search")
 *   - `subtitle` — present-tense verb for the running state ("Searching…")
 *   - `formatArgs(args)`    — returns an array of {label, value} rows
 *   - `formatResult(result)` — returns a clean summary string or ReactNode
 *
 * Unknown tools fall back to a generic wrench card with a sensible
 * pretty-print of args/result, but still no raw JSON in the default view —
 * users can expand "Details" to see the raw payload.
 */
import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calculator, Globe, Terminal, Brain, Database, Code,
  Wrench, CheckCircle2, AlertCircle, Loader2, Clock,
  ChevronRight, FileText, Github, Sparkles,
  type LucideIcon,
} from 'lucide-react';

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';

export interface ToolCallData {
  /** Stable id (toolCallId from SSE). */
  id: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  durationMs?: number;
  status: ToolCallStatus;
}

interface ArgRow {
  label: string;
  value: string;
  /** If true, render value as monospace; else plain. */
  mono?: boolean;
  /** Truncate long values to one line (default true). */
  truncate?: boolean;
}

interface ToolFormatter {
  icon: LucideIcon;
  title: string;
  /** Verb shown while the tool is running ("Searching…"). */
  runningVerb: string;
  accent: string; // tailwind text color for icon
  formatArgs?: (args: any) => ArgRow[];
  formatResult?: (result: any, args: any) => ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tool formatters
// ─────────────────────────────────────────────────────────────────────────────
const TOOL_FORMATTERS: Record<string, ToolFormatter> = {
  calculator: {
    icon: Calculator,
    title: 'Calculator',
    runningVerb: 'Calculating',
    accent: 'text-emerald-500',
    formatArgs: (a) => {
      const expr = a?.expression;
      // prettify * → × and / → ÷ for display
      const pretty = typeof expr === 'string'
        ? expr.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/\s+/g, ' ').trim()
        : String(expr ?? '');
      return [{ label: 'Expression', value: pretty, mono: true, truncate: false }];
    },
    formatResult: (r) => {
      const val = r?.result;
      if (val === undefined || val === null) return null;
      const numStr = typeof val === 'number'
        ? (Number.isInteger(val) ? val.toString() : val.toLocaleString(undefined, { maximumFractionDigits: 10 }))
        : String(val);
      return (
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] text-muted-foreground">=</span>
          <span className="font-mono text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">{numStr}</span>
        </div>
      );
    },
  },

  web_search: {
    icon: Globe,
    title: 'Web Search',
    runningVerb: 'Searching the web',
    accent: 'text-sky-500',
    formatArgs: (a) => {
      const rows: ArgRow[] = [];
      if (a?.query) rows.push({ label: 'Query', value: String(a.query), truncate: false });
      if (a?.max_results) rows.push({ label: 'Max results', value: String(a.max_results), mono: true });
      return rows;
    },
    formatResult: (r) => {
      const results = Array.isArray(r?.results) ? r.results : [];
      const count = r?.count ?? results.length;
      if (!count) return <span className="text-[11.5px] text-muted-foreground">No results found</span>;
      const top = results[0];
      const topTitle = top?.title ? truncate(String(top.title), 80) : 'result';
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{count}</span> result{count === 1 ? '' : 's'}
          </span>
          {top && (
            <span className="text-[11.5px] text-muted-foreground truncate">
              top: <span className="text-foreground/80">{topTitle}</span>
            </span>
          )}
        </div>
      );
    },
  },

  http_request: {
    icon: Globe,
    title: 'HTTP Request',
    runningVerb: 'Fetching URL',
    accent: 'text-sky-500',
    formatArgs: (a) => {
      const rows: ArgRow[] = [];
      if (a?.method) rows.push({ label: 'Method', value: String(a.method).toUpperCase(), mono: true });
      if (a?.url) rows.push({ label: 'URL', value: String(a.url), mono: true, truncate: false });
      return rows;
    },
    formatResult: (r) => {
      const status = r?.status;
      if (status === undefined) return null;
      const ok = status >= 200 && status < 300;
      return (
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-mono font-semibold ${
            ok
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400'
          }`}>
            {String(status)}
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            {ok ? 'response received' : 'request failed'}
          </span>
        </div>
      );
    },
  },

  code_execution: {
    icon: Terminal,
    title: 'Code Execution',
    runningVerb: 'Running code',
    accent: 'text-amber-500',
    formatArgs: (a) => {
      const rows: ArgRow[] = [];
      if (a?.language) rows.push({ label: 'Language', value: String(a.language), mono: true });
      if (a?.code) {
        const code = String(a.code);
        // Show first line; full code in expandable details
        const firstLine = code.split('\n')[0];
        rows.push({ label: 'Code', value: truncate(firstLine, 60), mono: true });
      }
      return rows;
    },
    formatResult: (r) => {
      const stdout = r?.stdout ?? r?.output ?? r?.result;
      const stderr = r?.stderr;
      if (stderr) {
        return <span className="text-[11.5px] text-rose-600 dark:text-rose-400 font-mono">{truncate(String(stderr), 120)}</span>;
      }
      if (stdout !== undefined && stdout !== null) {
        return <span className="text-[11.5px] text-muted-foreground font-mono">{truncate(String(stdout), 120)}</span>;
      }
      return <span className="text-[11.5px] text-muted-foreground">executed</span>;
    },
  },

  browser: {
    icon: Globe,
    title: 'Browser',
    runningVerb: 'Driving browser',
    accent: 'text-cyan-500',
    formatArgs: (a) => {
      const rows: ArgRow[] = [];
      if (a?.action) rows.push({ label: 'Action', value: String(a.action), mono: true });
      if (a?.url) rows.push({ label: 'URL', value: String(a.url), mono: true, truncate: false });
      if (a?.selector) rows.push({ label: 'Selector', value: String(a.selector), mono: true });
      return rows;
    },
    formatResult: (r) => {
      if (r?.title) return <span className="text-[11.5px] text-muted-foreground truncate">page: <span className="text-foreground/80">{truncate(String(r.title), 60)}</span></span>;
      if (r?.count !== undefined) return <span className="text-[11.5px] text-muted-foreground">{r.count} elements</span>;
      if (r?.text) return <span className="text-[11.5px] text-muted-foreground font-mono">{truncate(String(r.text), 100)}</span>;
      return <span className="text-[11.5px] text-muted-foreground">done</span>;
    },
  },

  memory_search: {
    icon: Brain,
    title: 'Memory Search',
    runningVerb: 'Searching memory',
    accent: 'text-indigo-500',
    formatArgs: (a) => a?.query ? [{ label: 'Query', value: String(a.query), truncate: false }] : [],
    formatResult: (r) => {
      const count = r?.count ?? 0;
      const results = Array.isArray(r?.results) ? r.results : [];
      if (!count) return <span className="text-[11.5px] text-muted-foreground">No matching memories</span>;
      const top = results[0];
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-[11.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{count}</span> memor{count === 1 ? 'y' : 'ies'}
          </span>
          {top?.fact && <span className="text-[11.5px] text-muted-foreground truncate">{truncate(String(top.fact), 80)}</span>}
        </div>
      );
    },
  },

  memory_store: {
    icon: Database,
    title: 'Memory Store',
    runningVerb: 'Saving to memory',
    accent: 'text-indigo-500',
    formatArgs: (a) => {
      const rows: ArgRow[] = [];
      if (a?.fact) rows.push({ label: 'Fact', value: truncate(String(a.fact), 100), truncate: false });
      if (a?.type) rows.push({ label: 'Type', value: String(a.type), mono: true });
      return rows;
    },
    formatResult: () => <span className="text-[11.5px] text-emerald-600 dark:text-emerald-400">saved to memory</span>,
  },

  github: {
    icon: Github,
    title: 'GitHub',
    runningVerb: 'Querying GitHub',
    accent: 'text-slate-600 dark:text-slate-300',
    formatArgs: (a) => {
      const rows: ArgRow[] = [];
      if (a?.action) rows.push({ label: 'Action', value: String(a.action).replace(/_/g, ' '), mono: true });
      if (a?.repo) rows.push({ label: 'Repo', value: `${a.owner ?? ''}/${a.repo}`, mono: true });
      return rows;
    },
    formatResult: (r) => {
      const count = r?.count ?? (Array.isArray(r?.data) ? r.data.length : undefined);
      if (count !== undefined) return <span className="text-[11.5px] text-muted-foreground">{count} item{count === 1 ? '' : 's'}</span>;
      return <span className="text-[11.5px] text-muted-foreground">done</span>;
    },
  },
};

const DEFAULT_FORMATTER: ToolFormatter = {
  icon: Wrench,
  title: 'Tool',
  runningVerb: 'Running',
  accent: 'text-slate-500',
  formatArgs: (a) => {
    if (!a || typeof a !== 'object') return [];
    return Object.entries(a).slice(0, 3).map(([k, v]) => ({
      label: k.charAt(0).toUpperCase() + k.slice(1),
      value: truncate(typeof v === 'string' ? v : JSON.stringify(v), 80),
      mono: typeof v !== 'string',
    }));
  },
  formatResult: (r) => {
    if (r === undefined || r === null) return null;
    const s = typeof r === 'string' ? r : JSON.stringify(r);
    return <span className="text-[11.5px] text-muted-foreground font-mono">{truncate(s, 120)}</span>;
  },
};

function getFormatter(toolName: string): ToolFormatter {
  return TOOL_FORMATTERS[toolName] ?? DEFAULT_FORMATTER;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status indicator
// ─────────────────────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: ToolCallStatus }) {
  if (status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-amber-600 dark:text-amber-400">
        <Loader2 className="w-3 h-3 animate-spin" />
        running
      </span>
    );
  }
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="w-3 h-3" />
        done
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-rose-600 dark:text-rose-400">
        <AlertCircle className="w-3 h-3" />
        failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-muted-foreground">
      <Clock className="w-3 h-3" />
      pending
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export function ToolCard({ tool }: { tool: ToolCallData }) {
  const fmt = getFormatter(tool.toolName);
  const Icon = fmt.icon;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const argRows = tool.args ? (fmt.formatArgs?.(tool.args) ?? []) : [];
  const resultNode = tool.result !== undefined || tool.status === 'error'
    ? (fmt.formatResult?.(tool.result, tool.args) ?? null)
    : null;
  const hasDetails = !!tool.args || !!tool.result || !!tool.error;
  const argsJson = safeJson(tool.args);
  const resultJson = safeJson(tool.result);

  const isRunning = tool.status === 'running';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className={`my-2 rounded-lg border overflow-hidden text-[13px] backdrop-blur-[1px] ${
        tool.status === 'error'
          ? 'border-rose-200/80 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/15'
          : tool.status === 'running'
            ? 'border-amber-200/80 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/10'
            : 'border-slate-200/80 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/30'
      }`}
    >
      {/* Header — icon + title + status + duration */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center bg-white/70 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60`}>
          <Icon className={`w-3.5 h-3.5 ${fmt.accent}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12.5px] font-semibold text-foreground truncate">
              {fmt.title}
            </span>
            {isRunning && (
              <span className="text-[11px] text-muted-foreground italic">
                · {fmt.runningVerb}…
              </span>
            )}
          </div>
        </div>
        <StatusPill status={tool.status} />
        {!isRunning && tool.durationMs !== undefined && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 font-mono">
            <Clock className="w-2.5 h-2.5" />
            {formatDuration(tool.durationMs)}
          </span>
        )}
      </div>

      {/* Body — human-readable args + result (NO raw JSON in default view) */}
      {(argRows.length > 0 || resultNode || tool.error) && (
        <div className="px-3 pb-2.5 pt-0 space-y-1.5 border-t border-slate-200/60 dark:border-slate-800/60">
          {argRows.map((row, i) => (
            <div key={i} className="flex items-baseline gap-2 min-w-0">
              <span className="text-[11px] text-muted-foreground/80 flex-shrink-0 w-[88px]">
                {row.label}
              </span>
              <span className={`text-[12px] text-foreground/90 flex-1 min-w-0 ${row.mono ? 'font-mono' : ''} ${row.truncate === false ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                {row.value}
              </span>
            </div>
          ))}

          {tool.error && (
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-rose-500/80 flex-shrink-0 w-[88px]">Error</span>
              <span className="text-[12px] text-rose-600 dark:text-rose-400 font-mono break-all">
                {tool.error}
              </span>
            </div>
          )}

          {resultNode && (
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[11px] text-muted-foreground/80 flex-shrink-0 w-[88px]">
                {tool.status === 'error' ? 'Result' : 'Result'}
              </span>
              <div className="flex-1 min-w-0 text-foreground/80">
                {resultNode}
              </div>
            </div>
          )}

          {isRunning && !resultNode && (
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-muted-foreground/80 flex-shrink-0 w-[88px]">Result</span>
              <span className="text-[11.5px] text-amber-600 dark:text-amber-400 italic flex items-center gap-1.5">
                <span className="flex gap-0.5">
                  <span className="w-1 h-1 rounded-full bg-amber-500/70 animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1 h-1 rounded-full bg-amber-500/70 animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1 h-1 rounded-full bg-amber-500/70 animate-bounce" />
                </span>
                awaiting result
              </span>
            </div>
          )}
        </div>
      )}

      {/* Details — expandable raw JSON for power users */}
      {hasDetails && (
        <div className="border-t border-slate-200/60 dark:border-slate-800/60">
          <button
            onClick={() => setDetailsOpen(v => !v)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
            aria-expanded={detailsOpen}
          >
            <motion.span animate={{ rotate: detailsOpen ? 90 : 0 }} transition={{ duration: 0.18 }}>
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            </motion.span>
            <span className="text-[10.5px] font-medium text-muted-foreground/80">Details</span>
            <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">
              · raw payload
            </span>
          </button>
          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div
                key="details"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-2.5 space-y-2">
                  {argsJson && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1 flex items-center gap-1">
                        <Code className="w-2.5 h-2.5" /> Arguments
                      </div>
                      <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 bg-slate-100/70 dark:bg-slate-950/60 rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                        {argsJson}
                      </pre>
                    </div>
                  )}
                  {resultJson && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mb-1 flex items-center gap-1">
                        <FileText className="w-2.5 h-2.5" /> Result
                      </div>
                      <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 bg-slate-100/70 dark:bg-slate-950/60 rounded p-2 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
                        {resultJson}
                      </pre>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

export default ToolCard;

// Keep these exports to satisfy existing imports that may reference them.
export { Sparkles };
