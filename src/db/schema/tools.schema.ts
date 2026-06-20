/**
 * Tools Schema
 */
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, pgEnum, primaryKey } from 'drizzle-orm/pg-core';
import { mcpServers } from './mcp.schema';
import { roles } from './auth.schema';

export const toolCategory = pgEnum('tool_category', ['builtin', 'integration', 'mcp', 'custom']);
export const toolSource = pgEnum('tool_source', ['internal', 'mcp']);

export const tools = pgTable('tools', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').unique().notNull(),
  displayName: text('display_name'),
  description: text('description').notNull(),
  category: toolCategory('category').default('builtin').notNull(),
  source: toolSource('source').default('internal').notNull(),
  mcpServerId: uuid('mcp_server_id').references(() => mcpServers.id, { onDelete: 'set null' }),
  schema: jsonb('schema').notNull(),
  handlerPath: text('handler_path'),
  requiredPermissions: text('required_permissions').array(),
  enabled: boolean('enabled').default(true).notNull(),
  rateLimitPerMin: integer('rate_limit_per_min').default(60).notNull(),
  timeoutMs: integer('timeout_ms').default(30000).notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const toolPermissions = pgTable('tool_permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  toolId: uuid('tool_id').notNull().references(() => tools.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  allowed: boolean('allowed').default(true).notNull(),
  constraints: jsonb('constraints'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  toolRoleIdx: primaryKey({ columns: [t.toolId, t.roleId] }),
}));
