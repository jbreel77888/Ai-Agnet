/**
 * Integrations Schema
 */
import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const integrationType = pgEnum('integration_type', ['github', 'slack', 'notion', 'discord', 'email', 'custom']);

export const integrations = pgTable('integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  type: integrationType('type').notNull(),
  status: text('status').default('disconnected').notNull(),
  config: jsonb('config'),
  credentialsEncrypted: jsonb('credentials_encrypted'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
