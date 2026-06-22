/**
 * Workflow Executor interface
 */
import type {
  WorkflowDefinition, WorkflowRun, WorkflowContext, WorkflowRunStatus,
} from '../../../types';

export interface WorkflowExecutor {
  start(workflowId: string, input: unknown, opts?: StartOpts): Promise<WorkflowRun>;
  resume(runId: string): Promise<WorkflowRun>;
  cancel(runId: string, reason?: string): Promise<void>;
  retry(runId: string, fromNodeId?: string): Promise<WorkflowRun>;

  getStatus(runId: string): Promise<WorkflowRun>;
  getStepResults(runId: string): Promise<Record<string, unknown>>;
  getContext(runId: string): Promise<WorkflowContext>;

  listRuns(filter?: {
    workflowId?: string;
    status?: WorkflowRunStatus;
    limit?: number;
  }): Promise<WorkflowRun[]>;

  validateDefinition(def: WorkflowDefinition): ValidationResult;

  on(event: WorkflowExecutorEvent, cb: (e: unknown) => void): void;
}

export interface StartOpts {
  userId?: string;
  sessionId?: string;
  parentRunId?: string;
  initialVariables?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  nodeId?: string;
  edgeId?: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  nodeId?: string;
  message: string;
}

export type WorkflowExecutorEvent =
  | 'workflow.started'
  | 'workflow.step.started'
  | 'workflow.step.completed'
  | 'workflow.step.failed'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.cancelled';
