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
        await db.insert(auditLogs).values({
          userId: entry.userId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          before: entry.before as any,
          after: entry.after as any,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
        });
      } catch (err) {
        console.error('[audit] Failed to record entry:', err);
      }
    },
  };
}
