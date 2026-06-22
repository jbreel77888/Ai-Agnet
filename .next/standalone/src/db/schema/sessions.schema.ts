/**
 * Sessions, Messages, Artifacts, Tool Calls Schema
 */
import { pgTable, uuid, text, timestamp, integer, jsonb, numeric, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './auth.schema';
import { agents } from './agents.schema';
import { models } from './providers.schema';
import { tools } from './tools.schema';

export const sessionStatus = pgEnum('session_status', ['active', 'paused', 'completed', 'failed', 'archived']);
export const messageRole = pgEnum('msg_role', ['user', 'assistant', 'system', 'tool', 'error']);
export const artifactType = pgEnum('artifact_type', ['file', 'image', 'code', 'report', 'data']);
export const toolCallStatus = pgEnum('tool_call_status', ['pending', 'running', 'success', 'failed', 'timeout']);

export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  title: text('title'),
  status: sessionStatus('status').default('active').notNull(),
  parentSessionId: uuid('parent_session_id'),
  workflowRunId: uuid('workflow_run_id'),
  contextSummary: text('context_summary'),
  totalTokens: integer('total_tokens').default(0).notNull(),
  totalCost: numeric('total_cost', { precision: 10, scale: 4 }).default('0').notNull(),
  metadata: jsonb('metadata'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  role: messageRole('role').notNull(),
  content: text('content'),
  contentBlocks: jsonb('content_blocks'),
  modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
  parentMessageId: uuid('parent_message_id'),
  tokensInput: integer('tokens_input').default(0).notNull(),
  tokensOutput: integer('tokens_output').default(0).notNull(),
  cost: numeric('cost', { precision: 10, scale: 6 }).default('0').notNull(),
  latencyMs: integer('latency_ms').default(0).notNull(),
  toolCalls: jsonb('tool_calls'),
  finishReason: text('finish_reason'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  sessionCreatedIdx: index('messages_session_created_idx').on(t.sessionId, t.createdAt),
}));

export const artifacts = pgTable('artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  type: artifactType('type').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes').default(0).notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'set null' }),
  toolId: uuid('tool_id').references(() => tools.id, { onDelete: 'set null' }),
  toolName: text('tool_name').notNull(),
  arguments: jsonb('arguments'),
  result: jsonb('result'),
  status: toolCallStatus('status').default('pending').notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms').default(0).notNull(),
  cost: numeric('cost', { precision: 10, scale: 6 }).default('0').notNull(),
});
