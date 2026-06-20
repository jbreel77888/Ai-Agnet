/**
 * Observability Schema — Traces & Metrics
 */
import { pgTable, uuid, text, timestamp, integer, numeric, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';

export const spanKind = pgEnum('span_kind', ['internal', 'client', 'server', 'producer', 'consumer']);
export const spanStatus = pgEnum('span_status', ['ok', 'error', 'unset']);

export const traces = pgTable('traces', {
  id: uuid('id').defaultRandom().primaryKey(),
  traceId: text('trace_id').notNull(),
  spanId: text('span_id').notNull(),
  parentSpanId: text('parent_span_id'),
  name: text('name').notNull(),
  kind: spanKind('kind').default('internal').notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  durationMs: integer('duration_ms').default(0).notNull(),
  attributes: jsonb('attributes'),
  status: spanStatus('status').default('unset').notNull(),
  events: jsonb('events'),
  resource: jsonb('resource'),
}, (t) => ({
  traceIdx: index('traces_trace_idx').on(t.traceId),
  nameTimeIdx: index('traces_name_time_idx').on(t.name, t.startTime),
}));

export const metrics = pgTable('metrics', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  value: numeric('value').notNull(),
  unit: text('unit'),
  tags: jsonb('tags'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  nameTimeIdx: index('metrics_name_time_idx').on(t.name, t.recordedAt),
}));
