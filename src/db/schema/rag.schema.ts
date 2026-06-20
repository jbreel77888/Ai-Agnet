/**
 * RAG Schema — Documents & Chunks with pgvector embeddings
 */
import { pgTable, uuid, text, timestamp, integer, jsonb, vector, index, pgEnum, bigint } from 'drizzle-orm/pg-core';
import { users } from './auth.schema';

export const docStatus = pgEnum('doc_status', ['pending', 'processing', 'ready', 'failed']);
export const docSource = pgEnum('doc_source', ['upload', 'url', 'api', 'integration']);

export const documents = pgTable('documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sourceType: docSource('source_type').default('upload').notNull(),
  sourceUrl: text('source_url'),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).default(0).notNull(),
  contentHash: text('content_hash'),
  status: docStatus('status').default('pending').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  tokens: integer('tokens').default(0).notNull(),
  embedding: vector('embedding', { dimensions: 1536 }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  docIdx: index('chunks_doc_idx').on(t.documentId),
  embeddingIdx: index('chunks_embedding_idx').using('ivfflat', t.embedding.op('vector_cosine_ops')),
}));
