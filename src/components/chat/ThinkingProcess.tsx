'use client';

/**
 * ThinkingProcess — collapsible "reasoning timeline" panel shown above an
 * assistant message. Mirrors the Manus AI "Thinking" section.
 *
 * Each step is a small row in a vertical timeline:
 *   • icon (animated when running, check when done, x when failed)
 *   • label
 *   • optional detail (e.g. tool name, query, duration)
 *   • subtle gray background that collapses into a single line when closed
 *
 * Steps are derived from the streaming events array passed in. The parent
 * (ChatPage) builds the steps as SSE events arrive.
 */
import { useEffect, useState, useRef } from 'react';
import {
  ChevronRight, Brain, Search, Wrench, Sparkles, AlertCircle,
  CheckCircle2, Loader2, MessageSquare,
} from 'lucide-react';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';

export type ThinkingStepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ThinkingStepKind = 'analyzing' | 'searching' | 'tool' | 'synthesizing' | 'responding' | 'info';

export interface ThinkingStep {
  id: string;
  kind: ThinkingStepKind;
  label: string;
  detail?: string;
  durationMs?: number;
  status: ThinkingStepStatus;
  /** ISO timestamp for ordering */
  ts: number;
}

interface ThinkingProcessProps {
  steps: ThinkingStep[];
  /** Auto-expand while new steps stream in, collapse when complete. */
  autoCollapseOnDone?: boolean;
  /** Default open state on first mount. */
  defaultOpen?: boolean;
}

const KIND_ICON: Record<ThinkingStepKind, typeof Brain> = {
  analyzing: Brain,
  searching: Search,
  tool: Wrench,
  synthesizing: Sparkles,
  responding: MessageSquare,
  info: Brain,
};

const KIND_COLOR: Record<ThinkingStepKind, string> = {
  analyzing: 'text-purple-500',
  searching: 'text-sky-500',
  tool: 'text-cyan-500',
  synthesizing: 'text-emerald-500',
  responding: 'text-slate-500',
  info: 'text-slate-500',
};

function StepIcon({ step }: { step: ThinkingStep }) {
  const Icon = KIND_ICON[step.kind];
  const color = KIND_COLOR[step.kind];

  if (step.status === 'completed') {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />;
  }
  if (step.status === 'failed') {
    return <AlertCircle className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />;
  }
  if (step.status === 'running') {
    return <Loader2 className={`w-3.5 h-3.5 ${color} animate-spin flex-shrink-0`} />;
  }
  return <Icon className={`w-3.5 h-3.5 ${color} opacity-50 flex-shrink-0`} />;
}

function formatDuration(ms?: number): string {
  if (!ms && ms !== 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ThinkingProcess({
  steps,
  autoCollapseOnDone = true,
  defaultOpen = true,
}: ThinkingProcessProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Auto-manage open state: open while any step is running; close when all done.
  const anyRunning = steps.some(s => s.status === 'running');
  const allDone = steps.length > 0 && !anyRunning;

  // Use a ref to detect transitions and avoid redundant setState calls.
  const prevRunningRef = useRef<boolean | null>(null);
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = anyRunning;

    // Just started running → expand the panel (deferred to avoid sync setState).
    if (anyRunning && !wasRunning) {
      const t = setTimeout(() => setOpen(true), 0);
      return () => clearTimeout(t);
    }
    // Just finished → auto-collapse after a brief delay (if enabled).
    if (!anyRunning && wasRunning && autoCollapseOnDone && allDone) {
      const t = setTimeout(() => setOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [anyRunning, allDone, autoCollapseOnDone]);

  if (steps.length === 0) return null;

  const completedCount = steps.filter(s => s.status === 'completed').length;
  const failedCount = steps.filter(s => s.status === 'failed').length;
  const totalDuration = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);

  const lastStep = steps[steps.length - 1];

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mb-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 overflow-hidden"
    >
      <CollapsibleTrigger asChild>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition-colors"
          aria-expanded={open}
        >
          <ChevronRight
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <Brain className={`w-3.5 h-3.5 ${anyRunning ? 'text-purple-500 animate-pulse' : 'text-muted-foreground'}`} />
          <span className="text-xs font-medium text-muted-foreground">
            Thinking Process
          </span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-1">
            {completedCount}/{steps.length}
          </Badge>
          {failedCount > 0 && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1.5">
              {failedCount} failed
            </Badge>
          )}
          {totalDuration > 0 && (
            <span className="text-[10px] text-muted-foreground/70 ml-auto font-mono">
              {formatDuration(totalDuration)}
            </span>
          )}
          {/* Inline preview when collapsed */}
          {!open && lastStep && (
            <span className="text-[11px] text-muted-foreground/80 truncate max-w-[40%] hidden sm:inline">
              · {lastStep.label}{lastStep.detail ? ` — ${lastStep.detail}` : ''}
            </span>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-4 pb-3 pt-1">
          <ol className="relative space-y-2.5">
            {/* vertical timeline line */}
            <span
              className="absolute left-[5px] top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-700"
              aria-hidden
            />
            {steps.map((step) => (
              <li key={step.id} className="relative pl-6 flex items-start gap-2">
                <span className="absolute left-0 top-1 bg-slate-50 dark:bg-slate-900/40">
                  <StepIcon step={step} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[12px] font-medium ${
                      step.status === 'pending' ? 'text-muted-foreground/70' : 'text-foreground'
                    }`}>
                      {step.label}
                    </span>
                    {step.detail && (
                      <span className="text-[11px] text-muted-foreground font-mono truncate max-w-full">
                        {step.detail}
                      </span>
                    )}
                    {step.durationMs !== undefined && step.status === 'completed' && (
                      <span className="text-[10px] text-muted-foreground/70 font-mono">
                        {formatDuration(step.durationMs)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
