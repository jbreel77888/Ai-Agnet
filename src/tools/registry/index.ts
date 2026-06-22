/**
 * Tool Registry — manages dynamic tools, executes them with SECURITY layer.
 * ─────────────────────────────────────────────────────────────────────────────
 * The registry enforces these security/performance guarantees on every tool
 * execution:
 *
 *   1. Validation        — args must pass tool.validate()
 *   2. Permissions       — ctx.permissions must include requiredPermissions
 *   3. Rate limiting     — per-user per-tool limit (default 60/min)
 *   4. Timeout           — per-tool timeout (default 30s, max 300s)
 *   5. Audit logging     — every execution logged to DB (audit_logs table)
 *   6. Cost tracking     — optional cost per execution (recorded in cost_records)
 *   7. Error handling    — catches and returns ToolResult errors
 *
 * The flow:
 *   validate → checkPermissions → rateLimit → timeout(execute) → audit → return
 */
import { db } from '../../db/client';
import { tools } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { ToolDefinition, ToolResult, ToolContext } from '../../types';

export interface ITool {
  readonly name: string;
  readonly description: string;
  readonly schema: any;
  readonly category: string;
  execute(args: any, ctx: ToolContext): Promise<ToolResult>;
  validate(args: any): { valid: boolean; errors?: string[] };
  /** Optional: permissions required to use this tool (e.g., 'admin', 'github:write'). Default: []. */
  readonly requiredPermissions?: string[];
  /** Optional: rate limit per user per minute. Default: 60. Set to 0 for unlimited. */
  readonly rateLimitPerMin?: number;
  /** Optional: timeout in milliseconds. Default: 30000 (30s). Max: 300000 (5min). */
  readonly timeoutMs?: number;
  /** Optional: estimated cost per execution in USD (for cost tracking). */
  readonly costEstimate?: number;
  /** Optional: capabilities declaration. */
  readonly capabilities?: {
    streaming?: boolean;
    longRunning?: boolean;
    requiresApproval?: boolean;
    sideEffects?: boolean;
  };
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

interface AuditEntry {
  userId: string;
  sessionId?: string;
  agentId?: string;
  toolName: string;
  args: any;
  result: any;
  success: boolean;
  durationMs: number;
  errorMessage?: string;
  timestamp: Date;
}

class ToolRegistryImpl {
  private builtinTools = new Map<string, ITool>();
  private dbToolsCache: any[] | null = null;
  private cacheLoadedAt = 0;

  // In-memory rate limit buckets: key = `${userId}:${toolName}`
  private rateLimitBuckets = new Map<string, RateLimitEntry>();
  // Cleanup rate limit buckets older than 5 minutes every minute
  private lastRateLimitCleanup = Date.now();

  // Audit log buffer — flushed to DB in batches for performance
  private auditBuffer: AuditEntry[] = [];
  private auditFlushTimer: NodeJS.Timeout | null = null;
  private readonly AUDIT_FLUSH_INTERVAL_MS = 5000; // flush every 5s
  private readonly AUDIT_BUFFER_MAX = 50;          // flush if buffer reaches this size

  register(tool: ITool): void {
    this.builtinTools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.builtinTools.delete(name);
  }

  get(name: string): ITool | undefined {
    return this.builtinTools.get(name);
  }

  list(): ITool[] {
    return Array.from(this.builtinTools.values());
  }

  toOpenAITools(allowedNames?: string[]): ToolDefinition[] {
    let toolList = this.list();
    if (allowedNames && allowedNames.length > 0 && !allowedNames.includes('*')) {
      toolList = toolList.filter(t => allowedNames.includes(t.name));
    }
    return toolList.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.schema,
    }));
  }

  /**
   * Execute a tool with full security layer:
   *   validate → permissions → rate limit → timeout → audit
   */
  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) {
      return {
        success: false,
        error: { code: 'TOOL_NOT_FOUND', message: `Tool "${name}" not found` },
        metadata: { durationMs: 0 },
      };
    }

    const start = Date.now();

    // ── 1. Validate args ──────────────────────────────────────────────────
    let validation: { valid: boolean; errors?: string[] };
    try {
      validation = tool.validate(args);
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'VALIDATE_ERROR', message: `Validation threw: ${err.message}` },
        metadata: { durationMs: Date.now() - start },
      };
    }
    if (!validation.valid) {
      return {
        success: false,
        error: { code: 'INVALID_ARGS', message: validation.errors?.join(', ') || 'Invalid arguments' },
        metadata: { durationMs: Date.now() - start },
      };
    }

    // ── 2. Permissions check ─────────────────────────────────────────────
    if (tool.requiredPermissions && tool.requiredPermissions.length > 0) {
      const userPerms = (ctx as any).permissions || [];
      const hasAll = tool.requiredPermissions.every(p => userPerms.includes(p) || userPerms.includes('*'));
      if (!hasAll) {
        return {
          success: false,
          error: {
            code: 'PERMISSION_DENIED',
            message: `Missing required permissions: ${tool.requiredPermissions.join(', ')}. Have: ${userPerms.join(', ') || 'none'}`,
          },
          metadata: { durationMs: Date.now() - start },
        };
      }
    }

    // ── 3. Rate limiting ─────────────────────────────────────────────────
    const rateLimitPerMin = tool.rateLimitPerMin ?? 60;
    if (rateLimitPerMin > 0 && ctx.userId) {
      const key = `${ctx.userId}:${name}`;
      const now = Date.now();
      let entry = this.rateLimitBuckets.get(key);
      if (!entry || now - entry.windowStart > 60_000) {
        entry = { count: 0, windowStart: now };
        this.rateLimitBuckets.set(key, entry);
      }
      entry.count++;
      if (entry.count > rateLimitPerMin) {
        return {
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: `Rate limit exceeded for "${name}": ${rateLimitPerMin}/min. Try again in ${Math.ceil((60_000 - (now - entry.windowStart)) / 1000)}s.`,
          },
          metadata: { durationMs: Date.now() - start, rateLimited: true },
        };
      }
    }

    // Cleanup old rate limit buckets periodically (every 1 min)
    if (Date.now() - this.lastRateLimitCleanup > 60_000) {
      this.cleanupRateLimitBuckets();
      this.lastRateLimitCleanup = Date.now();
    }

    // ── 4. Execute with timeout ──────────────────────────────────────────
    const timeoutMs = Math.min(tool.timeoutMs ?? 30_000, 300_000);
    let result: ToolResult;
    try {
      result = await this.executeWithTimeout(tool, args, ctx, timeoutMs);
    } catch (err: any) {
      result = {
        success: false,
        error: {
          code: err.code === 'TIMEOUT' ? 'TOOL_TIMEOUT' : 'TOOL_ERROR',
          message: err.code === 'TOOL_TIMEOUT'
            ? `Tool "${name}" timed out after ${timeoutMs}ms`
            : err.message,
        },
        metadata: { durationMs: Date.now() - start, timedOut: err.code === 'TIMEOUT' },
      };
    }

    // ── 5. Set durationMs ────────────────────────────────────────────────
    if (!result.metadata) result.metadata = { durationMs: Date.now() - start };
    else result.metadata.durationMs = Date.now() - start;

    // ── 6. Audit log (async, non-blocking) ───────────────────────────────
    this.queueAudit({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      toolName: name,
      args,
      result: result.success ? result.data : result.error,
      success: result.success,
      durationMs: result.metadata.durationMs,
      errorMessage: result.success ? undefined : result.error?.message,
      timestamp: new Date(),
    });

    // ── 7. Cost tracking (optional) ──────────────────────────────────────
    if (tool.costEstimate && tool.costEstimate > 0 && ctx.userId) {
      try {
        // Use the existing cost tracker if available
        const { createCostTracker } = await import('../../observability/cost');
        const costTracker = createCostTracker();
        await costTracker.record({
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          agentId: ctx.agentId,
          modelId: `tool:${name}`,
          providerId: 'tool-registry',
          tokensInput: 0,
          tokensOutput: 0,
        });
      } catch (err: any) {
        // Cost tracking failure should NOT fail the tool execution
        console.warn(`[tool-registry] Cost tracking failed for ${name}:`, err.message);
      }
    }

    return result;
  }

  /**
   * Execute a tool with timeout enforcement.
   */
  private async executeWithTimeout(tool: ITool, args: any, ctx: ToolContext, timeoutMs: number): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(Object.assign(new Error('Tool execution timed out'), { code: 'TIMEOUT' }));
      }, timeoutMs);

      tool.execute(args, ctx)
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  /**
   * Cleanup rate limit buckets older than 5 minutes (memory hygiene).
   */
  private cleanupRateLimitBuckets(): void {
    const now = Date.now();
    const cutoff = now - 5 * 60_000;
    for (const [key, entry] of this.rateLimitBuckets.entries()) {
      if (entry.windowStart < cutoff) {
        this.rateLimitBuckets.delete(key);
      }
    }
  }

  /**
   * Queue an audit entry for batched DB write.
   */
  private queueAudit(entry: AuditEntry): void {
    this.auditBuffer.push(entry);
    if (this.auditBuffer.length >= this.AUDIT_BUFFER_MAX) {
      this.flushAudit();
    } else if (!this.auditFlushTimer) {
      this.auditFlushTimer = setTimeout(() => this.flushAudit(), this.AUDIT_FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Flush the audit buffer to the database.
   * Writes to audit_logs table; silently skips on error.
   *
   * Schema columns: user_id, action, resource_type, resource_id,
   *                 before (jsonb), after (jsonb), ip_address, user_agent, created_at
   */
  private async flushAudit(): Promise<void> {
    if (this.auditFlushTimer) {
      clearTimeout(this.auditFlushTimer);
      this.auditFlushTimer = null;
    }
    if (this.auditBuffer.length === 0) return;

    const entries = this.auditBuffer.splice(0, this.auditBuffer.length);
    try {
      const { Pool } = require('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 3000,
      });
      try {
        // Multi-row INSERT using parameterized values
        // Columns: user_id, action, resource_type, resource_id, before, after, created_at
        const valuesClause = entries.map((_, i) =>
          `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}::jsonb, $${i * 6 + 6}::jsonb)`
        ).join(', ');
        const params: any[] = [];
        for (const e of entries) {
          params.push(
            e.userId,                                              // user_id
            'tool_execution',                                      // action
            'tool',                                                // resource_type
            e.toolName,                                            // resource_id
            JSON.stringify({                                       // before (args + context)
              args: e.args,
              sessionId: e.sessionId,
              agentId: e.agentId,
              timestamp: e.timestamp,
            }),
            JSON.stringify({                                       // after (result)
              success: e.success,
              result: e.result,
              durationMs: e.durationMs,
              error: e.errorMessage,
            })
          );
        }
        await pool.query(
          `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, before, after, created_at)
           VALUES ${valuesClause}
           ON CONFLICT DO NOTHING`,
          params
        );
      } finally {
        await pool.end();
      }
    } catch (err: any) {
      // Audit logging failure should NOT break anything — just log and move on.
      console.warn(`[tool-registry] Audit log flush failed (${entries.length} entries):`, err.message);
    }
  }

  /**
   * Force-flush audit buffer (called on shutdown).
   */
  async shutdown(): Promise<void> {
    if (this.auditFlushTimer) {
      clearTimeout(this.auditFlushTimer);
      this.auditFlushTimer = null;
    }
    await this.flushAudit();
  }
}

let instance: ToolRegistryImpl | null = null;
export function getToolRegistry(): ToolRegistryImpl {
  if (!instance) instance = new ToolRegistryImpl();
  return instance;
}
