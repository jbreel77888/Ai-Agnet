/**
 * Agents Schema
 */
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, numeric, pgEnum, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { models } from './providers.schema';
import { tools } from './tools.schema';

export const agentType = pgEnum('agent_type', [
  'planner', 'research', 'reasoning', 'coding', 'execution',
  'tool', 'memory', 'reflection', 'summarizer', 'custom',
]);

// Self-reference: agents can have parent_agent_id
export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  type: agentType('type').notNull(),
  systemPrompt: text('system_prompt'),
  description: text('description'),
  defaultModelId: uuid('default_model_id').references(() => models.id, { onDelete: 'set null' }),
  temperature: numeric('temperature', { precision: 3, scale: 2 }).default('0.7').notNull(),
  maxTokens: integer('max_tokens').default(4096).notNull(),
  topP: numeric('top_p', { precision: 3, scale: 2 }).default('1.0').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  canSpawnSubagents: boolean('can_spawn_subagents').default(false).notNull(),
  maxSubagents: integer('max_subagents').default(0).notNull(),
  parentId: uuid('parent_id'),
  handoffTargets: jsonb('handoff_targets'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentTools = pgTable('agent_tools', {
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  toolId: uuid('tool_id').notNull().references(() => tools.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.agentId, t.toolId] }),
}));

export const agentModels = pgTable('agent_models', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => models.id, { onDelete: 'cascade' }),
  priority: integer('priority').default(100).notNull(),
}, (t) => ({
  agentPriorityIdx: uniqueIndex('agent_models_agent_priority_idx').on(t.agentId, t.priority),
}));
