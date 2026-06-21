/**
 * /api/providers/[id]
 * GET — Get provider details
 * PATCH — Update provider
 * DELETE — Delete provider
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../db/client';
import { providers, models } from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { encrypt } from '../../../../utils/crypto';
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

function sanitizeProvider(p: any) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    baseUrl: p.baseUrl,
    status: p.status,
    healthStatus: p.healthStatus,
    timeoutMs: p.timeoutMs,
    maxRetries: p.maxRetries,
    headers: p.headers,
    metadata: p.metadata,
    hasApiKey: !!p.apiKeyEncrypted,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    healthCheckAt: p.healthCheckAt,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  const { id } = await params;
  const [provider] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
  if (!provider) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } },
      { status: 404 }
    );
  }

  const providerModels = await db.select().from(models).where(eq(models.providerId, provider.id));

  return NextResponse.json({
    success: true,
    data: {
      provider: sanitizeProvider(provider),
      models: providerModels.map(m => ({
        id: m.id,
        name: m.name,
        displayName: m.displayName,
        status: m.status,
        contextWindow: m.contextWindow,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsStreaming: m.supportsStreaming,
        inputPricePer1k: m.inputPricePer1k,
        outputPricePer1k: m.outputPricePer1k,
        priority: m.priority,
      })),
    },
  });
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().min(1000).max(300000).optional(),
  maxRetries: z.number().min(0).max(10).optional(),
  status: z.enum(['active', 'inactive']).optional(),
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
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } },
        { status: 400 }
      );
    }

    const { apiKey, ...rest } = parsed.data;
    const updates: any = { ...rest, updatedAt: new Date() };
    if (apiKey !== undefined) {
      updates.apiKeyEncrypted = apiKey ? encrypt(apiKey) : null;
    }

    const [updated] = await db.update(providers).set(updates).where(eq(providers.id, id)).returning();
    if (!updated) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } },
        { status: 404 }
      );
    }

    const audit = createAuditLogger();
    await audit.record({
      userId: user.sub,
      action: 'provider.update',
      resourceType: 'provider',
      resourceId: id,
      after: sanitizeProvider(updated),
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ success: true, data: { provider: sanitizeProvider(updated) } });
  } catch (err: any) {
    console.error('[providers/update] Error:', err);
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

  const { id } = await params;
  const [provider] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
  if (!provider) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } },
      { status: 404 }
    );
  }

  await db.delete(providers).where(eq(providers.id, id));

  const audit = createAuditLogger();
  await audit.record({
    userId: user.sub,
    action: 'provider.delete',
    resourceType: 'provider',
    resourceId: id,
    before: sanitizeProvider(provider),
    ipAddress: req.headers.get('x-forwarded-for') || undefined,
    userAgent: req.headers.get('user-agent') || undefined,
  });

  return NextResponse.json({ success: true, data: { message: 'Provider deleted' } });
}
