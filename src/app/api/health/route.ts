/**
 * GET /api/health — System health check
 * Public endpoint (no auth required)
 */
import { NextResponse } from 'next/server';
import { getEnv } from '../../../config/env';

export async function GET() {
  const env = getEnv();
  const checks: Array<{ name: string; status: 'healthy' | 'degraded' | 'down'; details?: Record<string, unknown> }> = [];

  // Database
  let dbStatus: 'healthy' | 'degraded' | 'down' = 'down';
  try {
    if (process.env.DATABASE_URL) {
      const { db } = await import('../../../db/client');
      const { sql } = await import('drizzle-orm');
      await db.execute(sql`SELECT 1`);
      dbStatus = 'healthy';
    } else {
      dbStatus = 'degraded';
    }
  } catch (err) {
    dbStatus = 'down';
  }
  checks.push({ name: 'database', status: dbStatus, details: { configured: !!process.env.DATABASE_URL } });

  // Redis
  let redisStatus: 'healthy' | 'degraded' | 'down' = 'down';
  try {
    if (process.env.REDIS_URL) {
      const { getRedis } = await import('../../../db/redis');
      const redis = getRedis();
      const pong = await redis.ping();
      redisStatus = pong === 'PONG' ? 'healthy' : 'degraded';
    } else {
      redisStatus = 'degraded';
    }
  } catch {
    redisStatus = 'down';
  }
  checks.push({ name: 'redis', status: redisStatus, details: { configured: !!process.env.REDIS_URL } });

  // Encryption
  const encStatus = process.env.ENCRYPTION_KEY ? 'healthy' : 'degraded';
  checks.push({ name: 'encryption', status: encStatus, details: { configured: !!process.env.ENCRYPTION_KEY } });

  // JWT
  const jwtStatus = process.env.JWT_SECRET ? 'healthy' : 'degraded';
  checks.push({ name: 'jwt', status: jwtStatus, details: { configured: !!process.env.JWT_SECRET } });

  // Overall
  const overallStatus = checks.every(c => c.status === 'healthy')
    ? 'healthy'
    : checks.some(c => c.status === 'down')
    ? 'down'
    : 'degraded';

  const uptime = process.uptime();

  return NextResponse.json({
    success: true,
    data: {
      status: overallStatus,
      service: env.SERVICE_NAME,
      version: '0.1.0',
      phase: 1,
      uptime,
      timestamp: new Date().toISOString(),
      checks,
      modules: {
        total: 19,
        ready: 9,
        scaffold: 8,
        pending: 2,
      },
    },
  });
}
