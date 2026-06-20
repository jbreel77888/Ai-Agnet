/**
 * GET /api/health — System health check
 * Public endpoint (no auth required)
 */
import { NextResponse } from 'next/server';
import { getEnv } from '../../../config/env';

export async function GET() {
  const env = getEnv();
  const checks: Array<{ name: string; status: 'healthy' | 'degraded' | 'down'; details?: Record<string, unknown> }> = [];

  // Database — test direct connection
  let dbStatus: 'healthy' | 'degraded' | 'down' = 'down';
  try {
    if (process.env.DATABASE_URL) {
      const pg = require('pg');
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
      await client.connect();
      const r = await client.query('SELECT count(*) FROM pg_tables WHERE schemaname = $1', ['public']);
      const tableCount = parseInt(r.rows[0].count, 10);
      await client.end();
      dbStatus = 'healthy';
      checks.push({ name: 'database', status: dbStatus, details: { configured: true, tables: tableCount } });
    } else {
      dbStatus = 'degraded';
      checks.push({ name: 'database', status: dbStatus, details: { configured: false } });
    }
  } catch (err: any) {
    dbStatus = 'down';
    checks.push({ name: 'database', status: dbStatus, details: { configured: !!process.env.DATABASE_URL, error: err.message?.substring(0, 100) } });
  }

  // Redis
  let redisStatus: 'healthy' | 'degraded' | 'down' = 'down';
  try {
    if (process.env.REDIS_URL) {
      const { getRedis } = await import('../../../db/redis');
      const redis = getRedis();
      const pong = await redis.ping();
      redisStatus = pong === 'PONG' ? 'healthy' : 'degraded';
    } else {
      redisStatus = 'degraded'; // Using in-memory fallback
    }
  } catch {
    redisStatus = 'down';
  }
  checks.push({ name: 'redis', status: redisStatus, details: { configured: !!process.env.REDIS_URL, mode: process.env.REDIS_URL ? 'real' : 'memory-fallback' } });

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
      service: env.SERVICE_NAME || 'agent-platform',
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
