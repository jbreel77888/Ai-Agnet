/**
 * /api/costs/budgets/[id]
 * PATCH  — Update budget (admin only)
 * DELETE — Delete budget (admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../db/client';
import { costBudgets } from '../../../../../db/schema';
import { eq } from 'drizzle-orm';
import { createJWTService } from '../../../../../auth/jwt';
import { createAuditLogger } from '../../../../../observability/logger/audit';

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    const payload = await jwtService.verifyAccessToken(authHeader.slice(7));
    if (!payload.roles?.includes('admin')) return null;
    return payload;
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
    utilization: parseFloat(b.limitUsd) > 0
      ? Math.min(100, (parseFloat(b.spentUsd) / parseFloat(b.limitUsd)) * 100)
      : 0,
  };
}

const updateSchema = z.object({
  limitUsd: z.number().positive().max(1_000_000).optional(),
  spentUsd: z.number().min(0).max(1_000_000).optional(),
  period: z.enum(['daily', 'weekly', 'monthly', 'total']).optional(),
  action: z.enum(['warn', 'block', 'notify']).optional(),
  enabled: z.boolean().optional(),
  resetAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const [before] = await db.select().from(costBudgets).where(eq(costBudgets.id, id)).limit(1);
    if (!before) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Budget not found' } },
        { status: 404 }
      );
    }

    const updates: any = { updatedAt: new Date() };
    if (parsed.data.limitUsd !== undefined) updates.limitUsd = parsed.data.limitUsd.toFixed(2);
    if (parsed.data.spentUsd !== undefined) updates.spentUsd = parsed.data.spentUsd.toFixed(2);
    if (parsed.data.period !== undefined) updates.period = parsed.data.period;
    if (parsed.data.action !== undefined) updates.action = parsed.data.action;
    if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
    if (parsed.data.resetAt !== undefined) {
      updates.resetAt = parsed.data.resetAt ? new Date(parsed.data.resetAt) : null;
    }

    const [updated] = await db
      .update(costBudgets)
      .set(updates)
      .where(eq(costBudgets.id, id))
      .returning();

    const audit = createAuditLogger();
    await audit.record({
      userId: user.sub,
      action: 'budget.update',
      resourceType: 'budget',
      resourceId: id,
      before: serializeBudget(before),
      after: serializeBudget(updated),
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, data: { budget: serializeBudget(updated) } });
  } catch (err: any) {
    console.error('[budgets/update] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Update failed' } },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const [before] = await db.select().from(costBudgets).where(eq(costBudgets.id, id)).limit(1);
    if (!before) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Budget not found' } },
        { status: 404 }
      );
    }

    await db.delete(costBudgets).where(eq(costBudgets.id, id));

    const audit = createAuditLogger();
    await audit.record({
      userId: user.sub,
      action: 'budget.delete',
      resourceType: 'budget',
      resourceId: id,
      before: serializeBudget(before),
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, data: { message: 'Budget deleted' } });
  } catch (err: any) {
    console.error('[budgets/delete] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Delete failed' } },
      { status: 500 }
    );
  }
}
