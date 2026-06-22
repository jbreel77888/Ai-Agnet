/**
 * /api/models/[id]
 * GET — Get model details
 * PATCH — Update model
 * DELETE — Delete model
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../db/client';
import { models } from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { createJWTService } from '../../../../auth/jwt';
import { createAuditLogger } from '../../../../observability/logger/audit';

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

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  const { id } = await params;
  const [model] = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (!model) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      model: {
        id: model.id,
        name: model.name,
        displayName: model.displayName,
        status: model.status,
        providerId: model.providerId,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        supportsTools: model.supportsTools,
        supportsVision: model.supportsVision,
        supportsStreaming: model.supportsStreaming,
        supportsThinking: model.supportsThinking,
        supportsJsonMode: model.supportsJsonMode,
        inputPricePer1k: model.inputPricePer1k,
        outputPricePer1k: model.outputPricePer1k,
        priority: model.priority,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
      },
    },
  });
}

const updateSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  contextWindow: z.number().int().min(1024).max(10000000).optional(),
  maxOutputTokens: z.number().int().min(1).max(1000000).optional(),
  inputPricePer1k: z.number().min(0).max(1000).optional(),
  outputPricePer1k: z.number().min(0).max(1000).optional(),
  supportsTools: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  supportsJsonMode: z.boolean().optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  status: z.enum(['active', 'deprecated', 'inactive']).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
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

    const data = parsed.data;
    const updates: any = { updatedAt: new Date() };
    if (data.displayName !== undefined) updates.displayName = data.displayName;
    if (data.contextWindow !== undefined) updates.contextWindow = data.contextWindow;
    if (data.maxOutputTokens !== undefined) updates.maxOutputTokens = data.maxOutputTokens;
    if (data.inputPricePer1k !== undefined) updates.inputPricePer1k = data.inputPricePer1k.toString();
    if (data.outputPricePer1k !== undefined) updates.outputPricePer1k = data.outputPricePer1k.toString();
    if (data.supportsTools !== undefined) updates.supportsTools = data.supportsTools;
    if (data.supportsVision !== undefined) updates.supportsVision = data.supportsVision;
    if (data.supportsStreaming !== undefined) updates.supportsStreaming = data.supportsStreaming;
    if (data.supportsThinking !== undefined) updates.supportsThinking = data.supportsThinking;
    if (data.supportsJsonMode !== undefined) updates.supportsJsonMode = data.supportsJsonMode;
    if (data.priority !== undefined) updates.priority = data.priority;
    if (data.status !== undefined) updates.status = data.status;

    const [updated] = await db.update(models).set(updates).where(eq(models.id, id)).returning();
    if (!updated) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } },
        { status: 404 }
      );
    }

    const audit = createAuditLogger();
    await audit.record({
      userId: user.sub,
      action: 'model.update',
      resourceType: 'model',
      resourceId: id,
      after: updated,
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, data: { model: updated } });
  } catch (err: any) {
    console.error('[models/update] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Update failed' } },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  const { id } = await params;
  const [model] = await db.select().from(models).where(eq(models.id, id)).limit(1);
  if (!model) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Model not found' } },
      { status: 404 }
    );
  }

  await db.delete(models).where(eq(models.id, id));

  const audit = createAuditLogger();
  await audit.record({
    userId: user.sub,
    action: 'model.delete',
    resourceType: 'model',
    resourceId: id,
    before: model,
    ipAddress: req.headers.get('x-forwarded-for') || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  });

  return NextResponse.json({ success: true, data: { message: 'Model deleted' } });
}
