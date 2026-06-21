'use client';

/**
 * ToolCallCard — shows a single tool invocation with collapsible args/result.
 *
 * States:
 *   - running  → amber accent, spinner, "Running…" placeholder for result
 *   - success  → emerald accent, check icon, duration badge
 *   - error    → rose accent, alert icon, error message in result
 *   - pending  → slate accent, dimmed
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │ 🔧 tool_name           ⏱ 234ms   ✓        │  ← always visible
 *   ├────────────────────────────────────────────┤
 *   │ ▸ Arguments (collapsed by default)         │
 *   │ ▸ Result     (expanded by default if run)  │
 *   └────────────────────────────────────────────┘
 */
import { useState } from 'react';
import {
  ChevronRight, Wrench, CheckCircle2, AlertCircle, Loader2, Clock,
} from 'lucide-react';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error';

export interface ToolCallData {
  /** Stable id (toolCallId from SSE) */
  id: string;
  toolName: string;
  /** Raw arguments object from the SSE `tool_call` event */
  args?: unknown;
  /** Raw result object from the SSE `tool_result` event */
  result?: unknown;
  /** Optional error message if the tool failed */
  error?: string;
  durationMs?: number;
  status: ToolCallStatus;
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function safeJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    // Try to pretty-print if it's already a JSON string
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

function renderResultPreview(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result.length > 120 ? result.slice(0, 120) + '…' : result;
  try {
    const s = JSON.stringify(result);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch {
    return String(result);
  }
}

const STATUS_STYLES: Record<ToolCallStatus, {
  border: string; bg: string; icon: typeof Wrench; iconColor: string; label: string;
}> = {
  pending:  { border: 'border-slate-200 dark:border-slate-800', bg: 'bg-slate-50/60 dark:bg-slate-900/30', icon: Wrench, iconColor: 'text-slate-400', label: 'Pending' },
  running:  { border: 'border-amber-300 dark:border-amber-700/60', bg: 'bg-amber-50/70 dark:bg-amber-950/20', icon: Loader2, iconColor: 'text-amber-500 animate-spin', label: 'Running' },
  success:  { border: 'border-emerald-300 dark:border-emerald-700/60', bg: 'bg-emerald-50/70 dark:bg-emerald-950/20', icon: CheckCircle2, iconColor: 'text-emerald-500', label: 'Success' },
  error:    { border: 'border-rose-300 dark:border-rose-700/60', bg: 'bg-rose-50/70 dark:bg-rose-950/20', icon: AlertCircle, iconColor: 'text-rose-500', label: 'Error' },
};

export function ToolCallCard({ tool }: { tool: ToolCallData }) {
  const style = STATUS_STYLES[tool.status];
  const StatusIcon = style.icon;
  const [argsOpen, setArgsOpen] = useState(false);
  // Result section open by default when we have a result
  const [resultOpen, setResultOpen] = useState(tool.status === 'success' || tool.status === 'error');

  const argsJson = safeJson(tool.args);
  const resultJson = safeJson(tool.result);
  const preview = renderResultPreview(tool.result);

  return (
    <div className={`rounded-lg border ${style.border} ${style.bg} overflow-hidden my-2 text-[13px]`}>
      {/* Header — always visible */}
      <div className="flex items-center gap-2 px-3 py-2">
        <StatusIcon className={`w-4 h-4 flex-shrink-0 ${style.iconColor}`} />
        <Wrench className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="font-mono font-medium text-[12.5px] truncate flex-1">
          {tool.toolName}
        </span>
        {tool.durationMs !== undefined && tool.status !== 'running' && (
          <Badge variant="outline" className="text-[10px] h-5 gap-1 font-mono">
            <Clock className="w-2.5 h-2.5" />
            {formatDuration(tool.durationMs)}
          </Badge>
        )}
        <Badge
          variant={tool.status === 'error' ? 'destructive' : 'secondary'}
          className="text-[10px] h-5"
        >
          {style.label}
        </Badge>
      </div>

      {/* Arguments (collapsible) */}
      {argsJson && (
        <div className="border-t border-slate-200/60 dark:border-slate-800/60">
          <Collapsible open={argsOpen} onOpenChange={setArgsOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors">
                <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${argsOpen ? 'rotate-90' : ''}`} />
                <span className="text-[11px] font-medium text-muted-foreground">Arguments</span>
                <span className="text-[11px] text-muted-foreground/60 font-mono ml-1 truncate hidden sm:inline">
                  {argsJson.split('\n')[0].slice(0, 80)}
                  {argsJson.split('\n')[0].length > 80 ? '…' : ''}
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="px-3 pb-3 pt-1 text-[11.5px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto max-h-64">
                {argsJson}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Result (collapsible) */}
      {(tool.status === 'running' || resultJson || tool.error) && (
        <div className="border-t border-slate-200/60 dark:border-slate-800/60">
          <Collapsible open={resultOpen} onOpenChange={setResultOpen}>
            <CollapsibleTrigger asChild>
              <button className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors">
                <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${resultOpen ? 'rotate-90' : ''}`} />
                <span className="text-[11px] font-medium text-muted-foreground">
                  {tool.status === 'error' ? 'Error' : 'Result'}
                </span>
                {preview && tool.status !== 'running' && (
                  <span className="text-[11px] text-muted-foreground/70 font-mono ml-1 truncate hidden sm:inline">
                    {preview}
                  </span>
                )}
                {tool.status === 'running' && (
                  <span className="text-[11px] text-amber-600 ml-1">Running…</span>
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {tool.status === 'error' && tool.error ? (
                <div className="px-3 pb-3 pt-1 text-[12px] text-rose-600 dark:text-rose-400 font-mono">
                  {tool.error}
                </div>
              ) : resultJson ? (
                <pre className="px-3 pb-3 pt-1 text-[11.5px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto max-h-80 whitespace-pre-wrap break-all">
                  {resultJson}
                </pre>
              ) : (
                <div className="px-3 pb-3 pt-1 text-[12px] text-muted-foreground italic">
                  Waiting for result…
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </div>
  );
}
