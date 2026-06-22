/**
 * SandboxManager — per-session stateful Tensorlake sandbox lifecycle.
 * ─────────────────────────────────────────────────────────────────────────────
 * Each chat session gets ONE persistent Tensorlake sandbox. The sandboxId is
 * stored in `agent_sessions.metadata.sandboxId` so subsequent tool calls in
 * the same session reuse the same filesystem + installed packages + running
 * processes.
 *
 * Lifecycle:
 *   1. getSessionSandbox(sessionId) → check DB metadata
 *      ├─ sandboxId exists → Sandbox.connect({ sandboxId }) → return
 *      └─ no sandboxId    → Sandbox.create({ name: sessionId }) → save id → return
 *   2. Tool calls use the sandbox (readFile, writeFile, run, listDirectory)
 *   3. On session delete → terminateSandbox(sessionId) → sandbox.terminate()
 *
 * The manager caches sandbox handles in-memory for the lifetime of the
 * process (one handle per session). If the session is gone from DB, the
 * cache entry is evicted.
 */
import { db } from '../db/client';
import { agentSessions } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export interface SandboxHandle {
  sandboxId: string;
  sandbox: any; // Tensorlake Sandbox instance
  createdAt: Date;
  lastUsedAt: Date;
}

class SandboxManagerImpl {
  private cache = new Map<string, SandboxHandle>();
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.TENSORLAKE_API_KEY;
  }

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  /**
   * Get (or create) the persistent sandbox for a given session.
   * Returns null if Tensorlake is not configured.
   */
  async getSessionSandbox(sessionId: string): Promise<SandboxHandle | null> {
    if (!this.apiKey) {
      console.warn('[sandbox] TENSORLAKE_API_KEY not set — sandbox disabled');
      return null;
    }

    // Check cache first
    const cached = this.cache.get(sessionId);
    if (cached) {
      cached.lastUsedAt = new Date();
      return cached;
    }

    try {
      // Dynamic import — the SDK requires a native binding (Rust napi-rs)
      const { Sandbox } = await import('tensorlake');

      // Check DB for existing sandboxId
      const sandboxId = await this.readSandboxId(sessionId);

      let sandbox: any;
      if (sandboxId) {
        // Try to connect to existing sandbox
        try {
          console.log(`[sandbox] Connecting to existing sandbox ${sandboxId} for session ${sessionId}`);
          sandbox = await Sandbox.connect({
            sandboxId,
            apiKey: this.apiKey,
          });
          // Verify it's alive
          try {
            await sandbox.status();
            console.log(`[sandbox] ✓ Reconnected to ${sandboxId}`);
          } catch (statusErr: any) {
            console.warn(`[sandbox] Existing sandbox ${sandboxId} not alive (${statusErr.message}) — creating new one`);
            sandbox = await Sandbox.create({
              apiKey: this.apiKey,
              name: `session-${sessionId.slice(0, 8)}`,
              memoryMb: 1024,
              diskMb: 10000,
              vcpus: 1.0,
            });
            await this.saveSandboxId(sessionId, sandbox.sandboxId);
          }
        } catch (connectErr: any) {
          console.warn(`[sandbox] Connect failed (${connectErr.message}) — creating new sandbox`);
          sandbox = await Sandbox.create({
            apiKey: this.apiKey,
            name: `session-${sessionId.slice(0, 8)}`,
            memoryMb: 1024,
            diskMb: 10000,
            vcpus: 1.0,
          });
          await this.saveSandboxId(sessionId, sandbox.sandboxId);
        }
      } else {
        // No existing sandbox — create new
        console.log(`[sandbox] Creating new sandbox for session ${sessionId}`);
        sandbox = await Sandbox.create({
          apiKey: this.apiKey,
          name: `session-${sessionId.slice(0, 8)}`,
          memoryMb: 1024,
          diskMb: 10000,
          vcpus: 1.0,
        });
        await this.saveSandboxId(sessionId, sandbox.sandboxId);
        console.log(`[sandbox] ✓ Created sandbox ${sandbox.sandboxId}`);
      }

      const handle: SandboxHandle = {
        sandboxId: sandbox.sandboxId,
        sandbox,
        createdAt: new Date(),
        lastUsedAt: new Date(),
      };
      this.cache.set(sessionId, handle);
      return handle;
    } catch (err: any) {
      console.error(`[sandbox] Failed to get/create sandbox for session ${sessionId}:`, err.message);
      return null;
    }
  }

  /**
   * Terminate the sandbox for a session (called on session delete).
   */
  async terminateSessionSandbox(sessionId: string): Promise<void> {
    const cached = this.cache.get(sessionId);
    if (cached) {
      try {
        await cached.sandbox.terminate();
        console.log(`[sandbox] ✓ Terminated ${cached.sandboxId}`);
      } catch (err: any) {
        console.warn(`[sandbox] Terminate failed for ${cached.sandboxId}: ${err.message}`);
      }
      this.cache.delete(sessionId);
    }

    // Also clear the DB metadata even if not in cache
    try {
      await db.update(agentSessions)
        .set({
          metadata: sql`metadata - 'sandboxId'`,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, sessionId));
    } catch (err: any) {
      console.warn(`[sandbox] Failed to clear sandboxId metadata:`, err.message);
    }
  }

  /**
   * Read sandboxId from agent_sessions.metadata
   */
  private async readSandboxId(sessionId: string): Promise<string | null> {
    try {
      const result = await db.execute(sql`
        SELECT metadata->>'sandboxId' AS sid
        FROM agent_sessions
        WHERE id = ${sessionId}
        LIMIT 1
      `);
      const rows = (result as any).rows || (result as any);
      const row = Array.isArray(rows) ? rows[0] : rows[0];
      return row?.sid || null;
    } catch (err: any) {
      console.warn(`[sandbox] Failed to read sandboxId:`, err.message);
      return null;
    }
  }

  /**
   * Save sandboxId to agent_sessions.metadata (JSONB merge)
   */
  private async saveSandboxId(sessionId: string, sandboxId: string): Promise<void> {
    try {
      await db.update(agentSessions)
        .set({
          metadata: sql`COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('sandboxId', ${sandboxId}::text, 'sandboxCreatedAt', NOW()::text)`,
          updatedAt: new Date(),
        })
        .where(eq(agentSessions.id, sessionId));
    } catch (err: any) {
      console.warn(`[sandbox] Failed to save sandboxId:`, err.message);
    }
  }

  /**
   * List all active sandboxes in cache (for monitoring/debugging)
   */
  listActive(): Array<{ sessionId: string; sandboxId: string; lastUsedAt: Date }> {
    return Array.from(this.cache.entries()).map(([sessionId, handle]) => ({
      sessionId,
      sandboxId: handle.sandboxId,
      lastUsedAt: handle.lastUsedAt,
    }));
  }
}

let instance: SandboxManagerImpl | null = null;
export function getSandboxManager(): SandboxManagerImpl {
  if (!instance) instance = new SandboxManagerImpl();
  return instance;
}
