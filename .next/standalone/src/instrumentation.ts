/**
 * Next.js Instrumentation — runs once on server startup
 *
 * Starts embedded PostgreSQL before Next.js accepts requests.
 * Only runs in Node.js runtime (skipped in Edge).
 */

export async function register() {
  const runtime = process.env.NEXT_RUNTIME;
  console.log(`[instrumentation] Runtime: ${runtime || 'undefined'}`);

  // Skip in Edge runtime
  if (runtime !== 'nodejs') {
    console.log('[instrumentation] Skipping (not nodejs runtime)');
    return;
  }

  // Lazy-load node-only module. The bundler will inline this import for Node build.
  try {
    const mod = await import('./_instrumentation-node');
    if (mod && typeof mod.registerNode === 'function') {
      await mod.registerNode();
    }
  } catch (err) {
    console.error('[instrumentation] Error:', err);
  }
}
