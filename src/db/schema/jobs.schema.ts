/**
 * Background Jobs Schema (synced with BullMQ)
 */
import { pgTable, uuid, text, timestamp, integer, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const jobStatus = pgEnum('job_status', ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']);

export const jobRecords = pgTable('job_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  queueName: text('queue_name').notNull(),
  jobId: text('job_id').notNull(),
  jobType: text('job_type').notNull(),
  payload: jsonb('payload'),
  status: jobStatus('status').default('waiting').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(3).notNull(),
  progress: integer('progress').default(0).notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const jobLogs = pgTable('job_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobRecordId: uuid('job_record_id').references(() => jobRecords.id, { onDelete: 'cascade' }),
  level: text('level').notNull(),
  message: text('message').notNull(),
  data: jsonb('data'),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
});
