/**
 * GET /api/costs/breakdown — Cost breakdown by model, provider, and user
 *
 * Query params:
 *   from    — ISO date (default: 30 days ago)
 *   to      — ISO date (default: now)
 *   userId  — filter by user id (optional; non-admins only see their own)
 *
 * Returns:
 *   {
 *     byModel:    [{ modelId, modelName, cost, tokensInput, tokensOutput, count }],
 *     byProvider: [{ providerId, providerName, cost, tokensInput, tokensOutput, count }],
 *     byUser:     [{ userId, userEmail, cost, tokensInput, tokensOutput, count }]  (admin only)
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../db/client';
import { costRecords, models, providers, users } from '../../../../db/schema';
import { sql, and, gte, lte, eq } from 'drizzle-orm';
import { createJWTService } from '../../../../auth/jwt';

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

    const isAdmin = user.roles?.includes('admin');
    const userIdFilter = userIdParam && isAdmin ? userIdParam : user.sub;

    const conditions = [
      gte(costRecords.recordedAt, from),
      lte(costRecords.recordedAt, to),
    ];
    if (userIdFilter) {
      conditions.push(eq(costRecords.userId, userIdFilter));
    }

    // By model
    const byModel = await db
      .select({
        modelId: costRecords.modelId,
        modelName: models.name,
        cost: sql<string>`COALESCE(SUM(${costRecords.cost}), 0)::numeric`,
        tokensInput: sql<number>`COALESCE(SUM(${costRecords.tokensInput}), 0)`,
        tokensOutput: sql<number>`COALESCE(SUM(${costRecords.tokensOutput}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(costRecords)
      .leftJoin(models, eq(costRecords.modelId, models.id))
      .where(and(...conditions))
      .groupBy(costRecords.modelId, models.name)
      .orderBy(sql`SUM(${costRecords.cost}) DESC`);

    // By provider
    const byProvider = await db
      .select({
        providerId: costRecords.providerId,
        providerName: providers.name,
        providerType: providers.type,
        cost: sql<string>`COALESCE(SUM(${costRecords.cost}), 0)::numeric`,
        tokensInput: sql<number>`COALESCE(SUM(${costRecords.tokensInput}), 0)`,
        tokensOutput: sql<number>`COALESCE(SUM(${costRecords.tokensOutput}), 0)`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(costRecords)
      .leftJoin(providers, eq(costRecords.providerId, providers.id))
      .where(and(...conditions))
      .groupBy(costRecords.providerId, providers.name, providers.type)
      .orderBy(sql`SUM(${costRecords.cost}) DESC`);

    // By user (admin only)
    let byUser: any[] = [];
    if (isAdmin) {
      byUser = await db
        .select({
          userId: costRecords.userId,
          userEmail: users.email,
          userName: users.name,
          cost: sql<string>`COALESCE(SUM(${costRecords.cost}), 0)::numeric`,
          tokensInput: sql<number>`COALESCE(SUM(${costRecords.tokensInput}), 0)`,
          tokensOutput: sql<number>`COALESCE(SUM(${costRecords.tokensOutput}), 0)`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(costRecords)
        .leftJoin(users, eq(costRecords.userId, users.id))
        .where(and(...conditions))
        .groupBy(costRecords.userId, users.email, users.name)
        .orderBy(sql`SUM(${costRecords.cost}) DESC`);
    }

    return NextResponse.json({
      success: true,
      data: {
        byModel: byModel.map((r) => ({
          modelId: r.modelId,
          modelName: r.modelName ?? 'unknown',
          cost: parseFloat(r.cost),
          tokensInput: r.tokensInput,
          tokensOutput: r.tokensOutput,
          tokens: r.tokensInput + r.tokensOutput,
          count: r.count,
        })),
        byProvider: byProvider.map((r) => ({
          providerId: r.providerId,
          providerName: r.providerName ?? 'unknown',
          providerType: r.providerType ?? 'unknown',
          cost: parseFloat(r.cost),
          tokensInput: r.tokensInput,
          tokensOutput: r.tokensOutput,
          tokens: r.tokensInput + r.tokensOutput,
          count: r.count,
        })),
        byUser: byUser.map((r) => ({
          userId: r.userId,
          userEmail: r.userEmail ?? 'unknown',
          userName: r.userName ?? null,
          cost: parseFloat(r.cost),
          tokensInput: r.tokensInput,
          tokensOutput: r.tokensOutput,
          tokens: r.tokensInput + r.tokensOutput,
          count: r.count,
        })),
      },
    });
  } catch (err: any) {
    console.error('[costs/breakdown] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch cost breakdown' } },
      { status: 500 }
    );
  }
}
