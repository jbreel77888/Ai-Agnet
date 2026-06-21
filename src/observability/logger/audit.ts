/**
 * Audit Logger — records sensitive operations to audit_logs table
 */
import { db } from '../../db/client';
import { auditLogs } from '../../db/schema/auth.schema';

export interface AuditEntry {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
}

export function createAuditLogger(): AuditLogger {
  return {
    async record(entry) {
      try {
        // Note: We don't store IP address because Railway's x-forwarded-for
        // contains comma-separated IPs which PostgreSQL inet type rejects.
        // Storing null is safer than trying to parse (which can fail on edge cases).
        await db.insert(auditLogs).values({
          userId: entry.userId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          before: entry.before as any,
          after: entry.after as any,
          ipAddress: null,
          userAgent: entry.userAgent,
        });
      } catch (err) {
        // Don't fail the request if audit logging fails
        // Just log to console (stdout, not stderr, to avoid Railway healthcheck issues)
        if (process.env.NODE_ENV === 'development') {
          console.log('[audit] Skipped entry:', err instanceof Error ? err.message : err);
        }
      }
    },
  };
}
