/**
 * MCP Schema
 */
import { pgTable, uuid, text, timestamp, integer, jsonb, pgEnum, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';

export const mcpTransport = pgEnum('mcp_transport', ['stdio', 'sse', 'websocket', 'http']);
export const mcpAuthType = pgEnum('mcp_auth_type', ['none', 'bearer', 'basic', 'api_key']);

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  transport: mcpTransport('transport').notNull(),
  command: text('command'),
  args: jsonb('args'),
  url: text('url'),
  authType: mcpAuthType('auth_type').default('none').notNull(),
  authCredentialsEncrypted: text('auth_credentials_encrypted'),
  envVarsEncrypted: jsonb('env_vars_encrypted'),
  status: text('status').default('inactive').notNull(),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  toolsCount: integer('tools_count').default(0).notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mcpTools = pgTable('mcp_tools', {
  id: uuid('id').defaultRandom().primaryKey(),
  mcpServerId: uuid('mcp_server_id').notNull().references(() => mcpServers.id, { onDelete: 'cascade' }),
  externalName: text('external_name').notNull(),
  displayName: text('display_name'),
  description: text('description'),
  schema: jsonb('schema'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  serverNameIdx: uniqueIndex('mcp_tools_server_name_idx').on(t.mcpServerId, t.externalName),
  pk: primaryKey({ columns: [t.id] }),
}));
