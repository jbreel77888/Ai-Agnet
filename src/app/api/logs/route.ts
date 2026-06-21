/**
 * GET /api/logs — Recent traces with pagination
 *
 * Query params:
 *   page      — page number (default: 1)
 *   pageSize  — items per page (default: 50, max: 200)
 *   name      — filter by span name (case-insensitive LIKE)
 *   status    — filter by status (ok | error | unset)
 *   traceId   — filter by trace id (exact)
 *   from      — ISO date (start_time >= from)
 *   to        — ISO date (start_time <= to)
 *
 * Returns:
 *   {
 *     logs: Trace[],
 *     pagination: { page, pageSize, total, totalPages }
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../db/client';
import { traces } from '../../../db/schema';
import { eq, desc, sql, and, gte, lte, ilike, count } from 'drizzle-orm';
import { createJWTService } from '../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    return await jwtService.verifyAccessToken(authHeader.slice(7));
  } catch {
    return null;
  }
}

function serializeTrace(t: any) {
  return {
    id: t.id,
    traceId: t.traceId,
    spanId: t.spanId,
    parentSpanId: t.parentSpanId,
    name: t.name,
    kind: t.kind,
    startTime: t.startTime,
    endTime: t.endTime,
    durationMs: t.durationMs,
    status: t.status,
    attributes: t.attributes,
    events: t.events,
    resource: t.resource,
  };
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  // Only admins/operators can browse all logs; regular users can also browse (logs are system-level)
  try {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50));
    const name = url.searchParams.get('name');
    const status = url.searchParams.get('status');
    const traceId = url.searchParams.get('traceId');
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');

    const conditions = [];
    if (name) conditions.push(ilike(traces.name, `%${name}%`));
    if (status && ['ok', 'error', 'unset'].includes(status)) {
      conditions.push(eq(traces.status, status as any));
    }
    if (traceId) conditions.push(eq(traces.traceId, traceId));
    if (fromStr) {
      const from = new Date(fromStr);
      if (!isNaN(from.getTime())) conditions.push(gte(traces.startTime, from));
    }
    if (toStr) {
      const to = new Date(toStr);
      if (!isNaN(to.getTime())) conditions.push(lte(traces.startTime, to));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total count for pagination
    const [totalRow] = whereClause
      ? await db.select({ total: count() }).from(traces).where(whereClause)
      : await db.select({ total: count() }).from(traces);
    const total = Number(totalRow?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Fetch page
    const rows = whereClause
      ? await db
          .select()
          .from(traces)
          .where(whereClause)
          .orderBy(desc(traces.startTime))
          .limit(pageSize)
          .offset((page - 1) * pageSize)
      : await db
          .select()
          .from(traces)
          .orderBy(desc(traces.startTime))
          .limit(pageSize)
          .offset((page - 1) * pageSize);

    return NextResponse.json({
      success: true,
      data: {
        logs: rows.map(serializeTrace),
        pagination: { page, pageSize, total, totalPages },
      },
    });
  } catch (err: any) {
    console.error('[logs/list] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch logs' } },
      { status: 500 }
    );
  }
}
