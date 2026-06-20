/**
 * Memory Schema — uses pgvector for embeddings
 *
 * NOTE: Requires `CREATE EXTENSION IF NOT EXISTS vector;` on the database.
 */
import { pgTable, uuid, text, timestamp, integer, jsonb, numeric, vector, index, pgEnum } from 'drizzle-orm/pg-core';

export const factType = pgEnum('fact_type', ['preference', 'entity', 'event', 'summary', 'custom']);
export const messageRole = pgEnum('message_role', ['user', 'assistant', 'system', 'tool', 'error']);

// Short-term memory (backup of Redis)
export const memoryShort = pgTable('memory_short', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull(),
  role: messageRole('role').notNull(),
  content: text('content').notNull(),
  tokens: integer('tokens').default(0).notNull(),
  metadata: jsonb('metadata'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Long-term memory with embedding
export const memoryLong = pgTable('memory_long', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id'),
  agentId: uuid('agent_id'),
  sessionId: uuid('session_id'),
  fact: text('fact').notNull(),
  factType: factType('fact_type').default('custom').notNull(),
  importance: numeric('importance', { precision: 3, scale: 2 }).default('0.5').notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  metadata: jsonb('metadata'),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  accessCount: integer('access_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // ivfflat index will be added via SQL migration
  embeddingIdx: index('memory_long_embedding_idx').using('ivfflat', t.embedding.op('vector_cosine_ops')),
  userAccessedIdx: index('memory_long_user_accessed_idx').on(t.userId, t.lastAccessedAt),
}));

// Extracted entities
export const memoryEntities = pgTable('memory_entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id'),
  entityType: text('entity_type').notNull(),
  entityValue: text('entity_value').notNull(),
  canonical: text('canonical').notNull(),
  aliases: text('aliases').array(),
  embedding: vector('embedding', { dimensions: 1536 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Session summaries
export const memorySummaries = pgTable('memory_summaries', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').notNull(),
  agentId: uuid('agent_id'),
  summary: text('summary').notNull(),
  tokensSaved: integer('tokens_saved').default(0).notNull(),
  coveredMessageIds: uuid('covered_message_ids').array(),
  embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
