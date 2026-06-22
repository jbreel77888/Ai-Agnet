/**
 * Workflows Schema
 */
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';

export const workflowStatus = pgEnum('workflow_status', ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled']);
export const stepType = pgEnum('step_type', ['agent', 'tool', 'condition', 'parallel', 'delay', 'code', 'handoff', 'webhook', 'human_approval', 'sub_workflow']);
export const stepStatus = pgEnum('step_status', ['pending', 'running', 'completed', 'failed', 'skipped']);
export const triggerType = pgEnum('trigger_type', ['manual', 'webhook', 'schedule', 'event']);

export const workflows = pgTable('workflows', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').unique().notNull(),
  description: text('description'),
  version: integer('version').default(1).notNull(),
  definition: jsonb('definition').notNull(),
  triggerType: triggerType('trigger_type').default('manual').notNull(),
  triggerConfig: jsonb('trigger_config'),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id'),
  status: workflowStatus('status').default('pending').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  context: jsonb('context'),
  currentStepId: text('current_step_id'),
  error: jsonb('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const workflowStepRuns = pgTable('workflow_step_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowRunId: uuid('workflow_run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  stepId: text('step_id').notNull(),
  stepType: stepType('step_type').notNull(),
  status: stepStatus('status').default('pending').notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  attempts: integer('attempts').default(0).notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  runStepIdx: index('wsr_run_step_idx').on(t.workflowRunId, t.stepId),
}));
