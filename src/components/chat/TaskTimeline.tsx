'use client';

/**
 * TaskTimeline — multi-step task progress visualization.
 *
 * Renders a vertical stepper with an overall progress bar at the top and one
 * row per task step. Each step may have nested sub-steps (typically tool
 * calls) rendered as indented rows.
 *
 * Used in:
 *   - The chat input area while a multi-step agent run is in progress
 *   - Standalone "session overview" widgets
 */
import {
  CheckCircle2, AlertCircle, Loader2, Circle, ChevronRight,
  Clock, ListChecks,
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface TaskSubStep {
  id: string;
  name: string;
  status: TaskStepStatus;
  durationMs?: number;
  detail?: string;
}

export interface TaskStep {
  id: string;
  name: string;
  status: TaskStepStatus;
  durationMs?: number;
  subSteps?: TaskSubStep[];
}

interface TaskTimelineProps {
  steps: TaskStep[];
  /** Optional title shown above the timeline. */
  title?: string;
  /** Whether to render the overall progress bar (default true). */
  showProgress?: boolean;
}

function StepStatusIcon({ status, size = 14 }: { status: TaskStepStatus; size?: number }) {
  const common = 'flex-shrink-0';
  const style = { width: size, height: size };
  switch (status) {
    case 'completed': return <CheckCircle2 className={`${common} text-emerald-500`} style={style} />;
    case 'failed':    return <AlertCircle   className={`${common} text-rose-500`} style={style} />;
    case 'running':   return <Loader2       className={`${common} text-amber-500 animate-spin`} style={style} />;
    case 'skipped':   return <Circle        className={`${common} text-muted-foreground/40`} style={style} />;
    default:          return <Circle        className={`${common} text-muted-foreground/40`} style={style} />;
  }
}

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const STEP_STATUS_TEXT: Record<TaskStepStatus, string> = {
  pending:   'Pending',
  running:   'Running',
  completed: 'Done',
  failed:    'Failed',
  skipped:   'Skipped',
};

export function TaskTimeline({ steps, title, showProgress = true }: TaskTimelineProps) {
  if (steps.length === 0) return null;

  const totalSteps = steps.length;
  const completed = steps.filter(s => s.status === 'completed').length;
  const failed = steps.filter(s => s.status === 'failed').length;
  const progressPct = totalSteps > 0 ? Math.round(((completed + failed) / totalSteps) * 100) : 0;

  const totalDuration = steps.reduce((sum, s) => sum + (s.durationMs || 0), 0);
  const isRunning = steps.some(s => s.status === 'running');

  return (
    <div className="rounded-lg border bg-card p-3 my-2">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <ListChecks className={`w-4 h-4 ${isRunning ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <span className="text-[13px] font-semibold">{title || 'Task Progress'}</span>
        <Badge variant="secondary" className="text-[10px] h-5 ml-1">
          {completed}/{totalSteps}
        </Badge>
        {failed > 0 && (
          <Badge variant="destructive" className="text-[10px] h-5">
            {failed} failed
          </Badge>
        )}
        {totalDuration > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground font-mono flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatDuration(totalDuration)}
          </span>
        )}
      </div>

      {/* Progress bar */}
      {showProgress && (
        <div className="mb-3">
          <Progress value={progressPct} className="h-1.5" />
        </div>
      )}

      {/* Steps */}
      <ol className="relative space-y-2.5">
        <span
          className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-700"
          aria-hidden
        />
        {steps.map((step) => (
          <li key={step.id} className="relative pl-7">
            <span className="absolute left-0 top-0.5 bg-card">
              <StepStatusIcon status={step.status} />
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[12.5px] font-medium ${
                step.status === 'pending' ? 'text-muted-foreground/70' : 'text-foreground'
              }`}>
                {step.name}
              </span>
              <Badge
                variant={
                  step.status === 'failed' ? 'destructive' :
                  step.status === 'completed' ? 'secondary' :
                  step.status === 'running' ? 'outline' :
                  'outline'
                }
                className="text-[9.5px] h-4 px-1.5"
              >
                {STEP_STATUS_TEXT[step.status]}
              </Badge>
              {step.durationMs !== undefined && step.status === 'completed' && (
                <span className="text-[10px] text-muted-foreground/70 font-mono">
                  {formatDuration(step.durationMs)}
                </span>
              )}
            </div>

            {/* Sub-steps (typically tool calls) */}
            {step.subSteps && step.subSteps.length > 0 && (
              <ul className="mt-1.5 space-y-1 pl-2">
                {step.subSteps.map(sub => (
                  <li key={sub.id} className="flex items-center gap-1.5 text-[11.5px]">
                    <ChevronRight className="w-2.5 h-2.5 text-muted-foreground/60" />
                    <StepStatusIcon status={sub.status} size={11} />
                    <span className={
                      sub.status === 'pending' ? 'text-muted-foreground/60' : 'text-muted-foreground'
                    }>
                      {sub.name}
                    </span>
                    {sub.detail && (
                      <span className="text-[10.5px] text-muted-foreground/60 font-mono truncate max-w-[50%]">
                        — {sub.detail}
                      </span>
                    )}
                    {sub.durationMs !== undefined && sub.status === 'completed' && (
                      <span className="text-[10px] text-muted-foreground/60 font-mono">
                        {formatDuration(sub.durationMs)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
