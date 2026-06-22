/**
 * GET  /api/costs/budgets — List budgets (admin: all, user: own)
 * POST /api/costs/budgets — Create a budget (admin only)
 *
 * Budget schema fields:
 *   scope: 'user' | 'session' | 'agent' | 'global'
 *   period: 'daily' | 'weekly' | 'monthly' | 'total'
 *   action: 'warn' | 'block' | 'notify'
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../db/client';
import { costBudgets } from '../../../../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { createJWTService } from '../../../../auth/jwt';
import { createAuditLogger } from '../../../../observability/logger/audit';

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

function serializeBudget(b: any) {
  return {
    id: b.id,
    userId: b.userId,
    scope: b.scope,
    scopeId: b.scopeId,
    period: b.period,
    limitUsd: parseFloat(b.limitUsd),
    spentUsd: parseFloat(b.spentUsd),
    resetAt: b.resetAt,
    action: b.action,
    enabled: b.enabled,
    metadata: b.metadata,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    utilization: b.limitUsd > 0 ? Math.min(100, (parseFloat(b.spentUsd) / parseFloat(b.limitUsd)) * 100) : 0,
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

  try {
    const url = new URL(req.url);
    const scope = url.searchParams.get('scope');
    const enabled = url.searchParams.get('enabled');

    const isAdmin = user.roles?.includes('admin');

    const conditions = [];
    if (!isAdmin) {
      conditions.push(eq(costBudgets.userId, user.sub));
    }
    if (scope) {
      conditions.push(eq(costBudgets.scope, scope as any));
    }
    if (enabled === 'true') {
      conditions.push(eq(costBudgets.enabled, true));
    } else if (enabled === 'false') {
      conditions.push(eq(costBudgets.enabled, false));
    }

    const query = db
      .select()
      .from(costBudgets)
      .orderBy(desc(costBudgets.createdAt));

    const rows = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    return NextResponse.json({
      success: true,
      data: { budgets: rows.map(serializeBudget), total: rows.length },
    });
  } catch (err: any) {
    console.error('[budgets/list] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch budgets' } },
      { status: 500 }
    );
  }
}

const createBudgetSchema = z.object({
  userId: z.string().uuid().optional(),
  scope: z.enum(['user', 'session', 'agent', 'global']),
  scopeId: z.string().uuid().optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'total']),
  limitUsd: z.number().positive().max(1_000_000),
  action: z.enum(['warn', 'block', 'notify']).default('warn'),
  enabled: z.boolean().default(true),
  resetAt: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }
  if (!user.roles?.includes('admin')) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const parsed = createBudgetSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const data = parsed.data;
    // For 'global' scope, userId is not required; for 'user' scope it defaults to admin
    const userIdValue = data.userId ?? (data.scope === 'user' ? user.sub : null);

    const [created] = await db
      .insert(costBudgets)
      .values({
        userId: userIdValue,
        scope: data.scope,
        scopeId: data.scopeId ?? null,
        period: data.period,
        limitUsd: data.limitUsd.toFixed(2),
        spentUsd: '0.00',
        action: data.action,
        enabled: data.enabled,
        resetAt: data.resetAt ? new Date(data.resetAt) : null,
      })
      .returning();

    const audit = createAuditLogger();
    await audit.record({
      userId: user.sub,
      action: 'budget.create',
      resourceType: 'budget',
      resourceId: created.id,
      after: serializeBudget(created),
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json(
      { success: true, data: { budget: serializeBudget(created) } },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('[budgets/create] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create budget' } },
      { status: 500 }
    );
  }
}
