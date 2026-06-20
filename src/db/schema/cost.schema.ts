/**
 * Cost Tracking Schema
 */
import { pgTable, uuid, text, timestamp, integer, numeric, boolean, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './auth.schema';
import { agents } from './agents.schema';
import { models, providers } from './providers.schema';

export const costScope = pgEnum('cost_scope', ['user', 'session', 'agent', 'global']);
export const costPeriod = pgEnum('cost_period', ['daily', 'weekly', 'monthly', 'total']);
export const costAction = pgEnum('cost_action', ['warn', 'block', 'notify']);

export const costRecords = pgTable('cost_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id'),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  modelId: uuid('model_id').references(() => models.id, { onDelete: 'set null' }),
  providerId: uuid('provider_id').references(() => providers.id, { onDelete: 'set null' }),
  tokensInput: integer('tokens_input').default(0).notNull(),
  tokensOutput: integer('tokens_output').default(0).notNull(),
  cost: numeric('cost', { precision: 10, scale: 6 }).notNull(),
  currency: text('currency').default('USD').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userRecordedIdx: index('cost_user_recorded_idx').on(t.userId, t.recordedAt),
  providerRecordedIdx: index('cost_provider_recorded_idx').on(t.providerId, t.recordedAt),
}));

export const costBudgets = pgTable('cost_budgets', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scope: costScope('scope').notNull(),
  scopeId: uuid('scope_id'),
  period: costPeriod('period').notNull(),
  limitUsd: numeric('limit_usd', { precision: 10, scale: 2 }).notNull(),
  spentUsd: numeric('spent_usd', { precision: 10, scale: 2 }).default('0').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }),
  action: costAction('action').default('warn').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
