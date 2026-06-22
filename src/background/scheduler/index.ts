/**
 * Scheduler — runs periodic background jobs
 *
 * Jobs:
 * - Memory decay: reduce importance of old memories
 * - Session cleanup: mark inactive sessions as archived
 * - Cost budget reset: reset spent amounts on period boundaries
 * - Summary generation: auto-summarize long sessions
 */
import { db } from '../../db/client';
import { agentSessions, memoryLong, costBudgets } from '../../db/schema';
import { eq, lt, sql } from 'drizzle-orm';

export interface ScheduledJob {
  name: string;
  intervalMs: number;
  lastRun: number;
  fn: () => Promise<void>;
}

class SchedulerImpl {
  private jobs: ScheduledJob[] = [];
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  register(name: string, intervalMs: number, fn: () => Promise<void>): void {
    this.jobs.push({ name, intervalMs, lastRun: 0, fn });
    console.log(`[scheduler] Registered job: ${name} (every ${intervalMs / 1000}s)`);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[scheduler] Started with ${this.jobs.length} jobs`);

    // Check every 30 seconds
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    console.log('[scheduler] Stopped');
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    for (const job of this.jobs) {
      if (now - job.lastRun >= job.intervalMs) {
        try {
          await job.fn();
          job.lastRun = now;
        } catch (err) {
          console.error(`[scheduler] Job "${job.name}" failed:`, err);
          job.lastRun = now; // Don't retry immediately
        }
      }
    }
  }

  async runNow(name: string): Promise<boolean> {
    const job = this.jobs.find(j => j.name === name);
    if (!job) return false;
    try {
      await job.fn();
      job.lastRun = Date.now();
      return true;
    } catch (err) {
      console.error(`[scheduler] Manual run of "${name}" failed:`, err);
      return false;
    }
  }

  listJobs(): Array<{ name: string; intervalMs: number; lastRun: Date | null }> {
    return this.jobs.map(j => ({
      name: j.name,
      intervalMs: j.intervalMs,
      lastRun: j.lastRun > 0 ? new Date(j.lastRun) : null,
    }));
  }
}

let instance: SchedulerImpl | null = null;
export function getScheduler(): SchedulerImpl {
  if (!instance) {
    instance = new SchedulerImpl();
    registerDefaultJobs(instance);
  }
  return instance;
}

function registerDefaultJobs(scheduler: SchedulerImpl): void {
  // Memory decay — every 24 hours
  scheduler.register('memory_decay', 24 * 60 * 60 * 1000, async () => {
    try {
      await db.update(memoryLong)
        .set({ importance: sql`${memoryLong.importance} * 0.95` })
        .where(sql`${memoryLong.lastAccessedAt} < NOW() - INTERVAL '7 days' AND ${memoryLong.importance} > 0.1`);
      console.log('[scheduler] ✓ Memory decay applied');
    } catch (err) {
      console.error('[scheduler] Memory decay failed:', err);
    }
  });

  // Session cleanup — every 1 hour
  scheduler.register('session_cleanup', 60 * 60 * 1000, async () => {
    try {
      await db.update(agentSessions)
        .set({ status: 'archived' })
        .where(sql`${agentSessions.lastActivityAt} < NOW() - INTERVAL '24 hours' AND ${agentSessions.status} = 'active'`);
      console.log('[scheduler] ✓ Session cleanup done');
    } catch (err) {
      console.error('[scheduler] Session cleanup failed:', err);
    }
  });

  // Cost budget reset — every 1 hour (check for expired budgets)
  scheduler.register('budget_reset', 60 * 60 * 1000, async () => {
    try {
      await db.update(costBudgets)
        .set({ spentUsd: '0' })
        .where(sql`${costBudgets.resetAt} IS NOT NULL AND ${costBudgets.resetAt} < NOW() AND ${costBudgets.enabled} = true`);
      console.log('[scheduler] ✓ Budget reset checked');
    } catch (err) {
      console.error('[scheduler] Budget reset failed:', err);
    }
  });
}
