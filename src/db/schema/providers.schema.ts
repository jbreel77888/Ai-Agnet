/**
 * Providers & Models Schema
 */
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, numeric, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';

export const providerType = pgEnum('provider_type', [
  'openai', 'anthropic', 'gemini', 'groq', 'ollama', 'openrouter',
  'openai_compatible', 'custom',
]);

export const entityStatus = pgEnum('entity_status', ['active', 'inactive', 'error']);
export const modelStatus = pgEnum('model_status', ['active', 'deprecated', 'inactive']);

export const providers = pgTable('providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  type: providerType('type').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyEncrypted: text('api_key_encrypted'),
  headers: jsonb('headers'),
  status: entityStatus('status').default('active').notNull(),
  timeoutMs: integer('timeout_ms').default(30000).notNull(),
  maxRetries: integer('max_retries').default(3).notNull(),
  metadata: jsonb('metadata'),
  healthCheckAt: timestamp('health_check_at', { withTimezone: true }),
  healthStatus: text('health_status').default('unknown').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const models = pgTable('models', {
  id: uuid('id').defaultRandom().primaryKey(),
  providerId: uuid('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  displayName: text('display_name'),
  inputPricePer1k: numeric('input_price_per_1k', { precision: 10, scale: 6 }).default('0').notNull(),
  outputPricePer1k: numeric('output_price_per_1k', { precision: 10, scale: 6 }).default('0').notNull(),
  contextWindow: integer('context_window').default(4096).notNull(),
  maxOutputTokens: integer('max_output_tokens').default(4096).notNull(),
  supportsTools: boolean('supports_tools').default(false).notNull(),
  supportsVision: boolean('supports_vision').default(false).notNull(),
  supportsStreaming: boolean('supports_streaming').default(false).notNull(),
  supportsThinking: boolean('supports_thinking').default(false).notNull(),
  supportsJsonMode: boolean('supports_json_mode').default(false).notNull(),
  priority: integer('priority').default(100).notNull(),
  status: modelStatus('status').default('active').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  providerNameIdx: uniqueIndex('models_provider_name_idx').on(t.providerId, t.name),
}));
