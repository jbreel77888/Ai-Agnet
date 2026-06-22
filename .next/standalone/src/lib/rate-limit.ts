/**
 * Rate Limiter — simple in-memory rate limiter for API routes.
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses a sliding window per identifier (typically user ID or IP).
 *
 * Usage:
 *   import { checkRateLimit } from '@/lib/rate-limit';
 *
 *   const limit = await checkRateLimit(`chat:${userId}`, 30, 60_000); // 30 req / 60s
 *   if (!limit.allowed) {
 *     return NextResponse.json({ error: 'Rate limited' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
 *   }
 *
 * For multi-instance deployments, swap this for a Redis-backed limiter.
 */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, RateLimitEntry>();

// Periodically clean up old buckets (every 5 minutes)
let lastCleanup = Date.now();
function cleanupOldBuckets(): void {
  const now = Date.now();
  if (now - lastCleanup < 5 * 60_000) return;
  const cutoff = now - 10 * 60_000; // keep last 10 min of history
  for (const [key, entry] of buckets.entries()) {
    if (entry.windowStart < cutoff) {
      buckets.delete(key);
    }
  }
  lastCleanup = now;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  resetAtMs: number;
}

/**
 * Check if a request is allowed under the rate limit.
 *
 * @param key Unique identifier (e.g., `chat:${userId}`, `api:${ip}`)
 * @param maxRequests Maximum requests allowed in the window
 * @param windowMs Window size in milliseconds
 * @returns RateLimitResult
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number = 60_000
): RateLimitResult {
  cleanupOldBuckets();
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { count: 0, windowStart: now };
    buckets.set(key, entry);
  }
  entry.count++;
  if (entry.count > maxRequests) {
    const retryAfterSec = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec,
      resetAtMs: entry.windowStart + windowMs,
    };
  }
  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - entry.count),
    retryAfterSec: 0,
    resetAtMs: entry.windowStart + windowMs,
  };
}

/**
 * Convenience: rate limit for chat endpoints — 30 messages per minute per user.
 */
export function checkChatRateLimit(userId: string): RateLimitResult {
  return checkRateLimit(`chat:${userId}`, 30, 60_000);
}

/**
 * Convenience: rate limit for general API — 100 requests per minute per user.
 */
export function checkApiRateLimit(userId: string): RateLimitResult {
  return checkRateLimit(`api:${userId}`, 100, 60_000);
}

/**
 * Convenience: rate limit for auth endpoints — 5 attempts per minute per IP
 * (prevents brute force).
 */
export function checkAuthRateLimit(ip: string): RateLimitResult {
  return checkRateLimit(`auth:${ip}`, 5, 60_000);
}
