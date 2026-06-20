/**
 * Graceful Shutdown Manager
 *
 * Registers cleanup handlers and ensures they all run on:
 * - SIGINT (Ctrl+C)
 * - SIGTERM (Railway/Docker stop)
 * - uncaughtException / unhandledRejection (best effort)
 *
 * Each handler has a timeout (default 10s) to avoid hanging.
 */

export interface ShutdownHandler {
  name: string;
  handler: () => Promise<void>;
  timeoutMs?: number;
}

export interface LifecycleManager {
  register(handler: ShutdownHandler): void;
  shutdown(reason?: string): Promise<void>;
  isShuttingDown(): boolean;
}

export function createLifecycleManager(): LifecycleManager {
  const handlers: ShutdownHandler[] = [];
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;

  const runHandlerWithTimeout = async (h: ShutdownHandler): Promise<void> => {
    const timeout = h.timeoutMs ?? 10000;
    try {
      await Promise.race([
        h.handler(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Handler "${h.name}" timed out after ${timeout}ms`)), timeout)
        ),
      ]);
    } catch (err) {
      console.error(`[lifecycle] Handler "${h.name}" failed:`, err);
    }
  };

  const shutdown = async (reason = 'unknown'): Promise<void> => {
    if (shuttingDown) {
      // Wait for existing shutdown
      while (shuttingDown && !shutdownPromise) await new Promise(r => setTimeout(r, 50));
      return shutdownPromise ?? Promise.resolve();
    }
    shuttingDown = true;

    console.log(`[lifecycle] Graceful shutdown started (reason: ${reason})`);

    shutdownPromise = (async () => {
      // Run handlers in reverse order of registration (LIFO)
      for (let i = handlers.length - 1; i >= 0; i--) {
        await runHandlerWithTimeout(handlers[i]);
      }
      console.log('[lifecycle] Graceful shutdown complete');
    })();

    return shutdownPromise;
  };

  // Wire signals
  process.on('SIGINT', () => void shutdown('SIGINT').then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown('SIGTERM').then(() => process.exit(0)));
  process.on('uncaughtException', (err) => {
    console.error('[lifecycle] Uncaught exception:', err);
    void shutdown('uncaughtException').finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[lifecycle] Unhandled rejection:', reason);
    // Don't exit immediately, just log — let the operation continue
  });

  return {
    register: (handler) => { handlers.push(handler); },
    shutdown,
    isShuttingDown: () => shuttingDown,
  };
}

// Singleton instance
let singleton: LifecycleManager | null = null;
export function getLifecycleManager(): LifecycleManager {
  if (!singleton) singleton = createLifecycleManager();
  return singleton;
}
