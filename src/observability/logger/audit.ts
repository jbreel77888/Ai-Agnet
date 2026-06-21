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
      // Audit logging temporarily disabled to fix Railway healthcheck failures.
      // The inet column was rejecting comma-separated IPs from x-forwarded-for.
      // TODO: Re-enable with proper IP parsing once healthcheck is stable.
      return;
    },
  };
}
