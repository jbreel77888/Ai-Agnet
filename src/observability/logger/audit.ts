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
        // Sanitize IP address: take only the first IP from comma-separated list
        // (x-forwarded-for can contain "client-ip, proxy1-ip, proxy2-ip")
        let ip: string | null = null;
        if (entry.ipAddress) {
          const firstIp = entry.ipAddress.split(',')[0].trim();
          // Validate it looks like an IP address (IPv4 or IPv6)
          if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(firstIp) || /^[0-9a-fA-F:]+$/.test(firstIp)) {
            ip = firstIp;
          }
        }

        await db.insert(auditLogs).values({
          userId: entry.userId,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          before: entry.before as any,
          after: entry.after as any,
          ipAddress: ip as any,
          userAgent: entry.userAgent,
        });
      } catch (err) {
        // Don't fail the request if audit logging fails
        console.error('[audit] Failed to record entry:', err instanceof Error ? err.message : err);
      }
    },
  };
}
// Rebuild 1782002016
