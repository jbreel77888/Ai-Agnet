/**
 * GET /api/costs — Cost summary
 *
 * Query params:
 *   from    — ISO date (default: 30 days ago)
 *   to      — ISO date (default: now)
 *   userId  — filter by user id (optional)
 *
 * Returns:
 *   {
 *     totalCost: number,
 *     totalTokens: number,
 *     requestCount: number,
 *     currency: string,
 *     range: { from, to },
 *     daily: [{ date, cost, tokensInput, tokensOutput, count }]
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../db/client';
import { costRecords } from '../../../db/schema';
import { sql, and, gte, lte, eq } from 'drizzle-orm';
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

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  try {
    const url = new URL(req.url);
    const now = new Date();
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');
    const userIdParam = url.searchParams.get('userId');

    const from = fromStr ? new Date(fromStr) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const to = toStr ? new Date(toStr) : now;

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid date range' } },
        { status: 400 }
      );
    }

    // Non-admins can only see their own costs
    const isAdmin = user.roles?.includes('admin');
    const userIdFilter = userIdParam && isAdmin ? userIdParam : user.sub;

    // Build the filter conditions
    const conditions = [
      gte(costRecords.recordedAt, from),
      lte(costRecords.recordedAt, to),
    ];
    if (userIdFilter) {
      conditions.push(eq(costRecords.userId, userIdFilter));
    }

    // Overall summary
    const [summary] = await db
      .select({
        totalCost: sql<string>`COALESCE(SUM(${costRecords.cost}), 0)::numeric`,
        totalTokensInput: sql<number>`COALESCE(SUM(${costRecords.tokensInput}), 0)`,
        totalTokensOutput: sql<number>`COALESCE(SUM(${costRecords.tokensOutput}), 0)`,
        requestCount: sql<number>`COUNT(*)::int`,
      })
      .from(costRecords)
      .where(and(...conditions));

    // Daily aggregation (for charts)
    const daily = await db
      .select({
        date: sql<string>`to_char(date_trunc('day', ${costRecords.recordedAt}), 'YYYY-MM-DD')`,
        cost: sql<string>`COALESCE(SUM(${costRecords.cost}), 0)::numeric`,
        tokensInput: sql<number>`COALESCE(SUM(${costRecords.tokensInput}), 0)`,
        tokensOutput: sql<number>`COALESCE(SUM(${costRecords.tokensOutput}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(costRecords)
      .where(and(...conditions))
      .groupBy(sql`date_trunc('day', ${costRecords.recordedAt})`)
      .orderBy(sql`date_trunc('day', ${costRecords.recordedAt})`);

    const totalCost = parseFloat(summary?.totalCost ?? '0');
    const totalTokens = (summary?.totalTokensInput ?? 0) + (summary?.totalTokensOutput ?? 0);

    return NextResponse.json({
      success: true,
      data: {
        totalCost,
        totalTokens,
        totalTokensInput: summary?.totalTokensInput ?? 0,
        totalTokensOutput: summary?.totalTokensOutput ?? 0,
        requestCount: summary?.requestCount ?? 0,
        currency: 'USD',
        range: { from: from.toISOString(), to: to.toISOString() },
        daily: daily.map((d) => ({
          date: d.date,
          cost: parseFloat(d.cost),
          tokensInput: d.tokensInput,
          tokensOutput: d.tokensOutput,
          tokens: d.tokensInput + d.tokensOutput,
          count: d.count,
        })),
      },
    });
  } catch (err: any) {
    console.error('[costs/summary] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch cost summary' } },
      { status: 500 }
    );
  }
}
