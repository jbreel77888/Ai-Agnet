/**
 * Storage Schema
 */
import { pgTable, uuid, text, timestamp, bigint, boolean, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const storageBackend = pgEnum('storage_backend', ['local', 's3', 'r2', 'gcs']);

export const storageObjects = pgTable('storage_objects', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id'),
  key: text('key').unique().notNull(),
  bucket: text('bucket').default('default').notNull(),
  backend: storageBackend('backend').default('local').notNull(),
  contentType: text('content_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).default(0).notNull(),
  checksum: text('checksum'),
  metadata: jsonb('metadata'),
  isPublic: boolean('is_public').default(false).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
