/**
 * GET /api/providers/[id]/models — List models for a provider
 * POST /api/providers/[id]/models — Add a model manually
 *
 * Used when the provider doesn't support auto-discovery (e.g., custom OpenAI-compatible providers)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../db/client';
import { providers, models } from '../../../../../db/schema';
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
      models: providerModels.map(m => ({
        id: m.id,
        name: m.name,
        displayName: m.displayName,
        status: m.status,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsStreaming: m.supportsStreaming,
        supportsThinking: m.supportsThinking,
        supportsJsonMode: m.supportsJsonMode,
        inputPricePer1k: m.inputPricePer1k,
        outputPricePer1k: m.outputPricePer1k,
        priority: m.priority,
        createdAt: m.createdAt,
      })),
    },
  });
}

const addModelSchema = z.object({
  name: z.string().min(1).max(200).describe('Model name as expected by the API (e.g., gpt-4o, nemotron-3-ultra-free)'),
  displayName: z.string().min(1).max(200).optional().describe('Human-friendly name (defaults to name)'),
  contextWindow: z.number().int().min(1024).max(10000000).default(8192),
  maxOutputTokens: z.number().int().min(1).max(1000000).default(4096),
  inputPricePer1k: z.number().min(0).max(1000).default(0).describe('Price in USD per 1K input tokens'),
  outputPricePer1k: z.number().min(0).max(1000).default(0).describe('Price in USD per 1K output tokens'),
  supportsTools: z.boolean().default(false),
  supportsVision: z.boolean().default(false),
  supportsStreaming: z.boolean().default(true),
  supportsThinking: z.boolean().default(false),
  supportsJsonMode: z.boolean().default(false),
  priority: z.number().int().min(1).max(1000).default(100).describe('Lower = higher priority'),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const [provider] = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
    if (!provider) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } },
        { status: 404 }
      );
    }

    const body = await req.json();
    const parsed = addModelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const displayName = data.displayName || data.name;

    // Check for duplicate (provider + name)
    const allProviderModels = await db.select().from(models).where(eq(models.providerId, provider.id));
    const duplicate = allProviderModels.find(m => m.name === data.name);
    if (duplicate) {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: `Model "${data.name}" already exists for this provider` } },
        { status: 409 }
      );
    }

    const [model] = await db.insert(models).values({
      providerId: provider.id,
      name: data.name,
      displayName,
      contextWindow: data.contextWindow,
      maxOutputTokens: data.maxOutputTokens,
      inputPricePer1k: data.inputPricePer1k.toString(),
      outputPricePer1k: data.outputPricePer1k.toString(),
      supportsTools: data.supportsTools,
      supportsVision: data.supportsVision,
      supportsStreaming: data.supportsStreaming,
      supportsThinking: data.supportsThinking,
      supportsJsonMode: data.supportsJsonMode,
      priority: data.priority,
      status: 'active',
    }).returning();

    // Audit log
    const audit = createAuditLogger();
    await audit.record({
      userId: user.sub,
      action: 'model.create',
      resourceType: 'model',
      resourceId: model.id,
      after: { ...model, providerName: provider.name },
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      success: true,
      data: {
        model: {
          id: model.id,
          name: model.name,
          displayName: model.displayName,
          status: model.status,
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
        },
      },
    }, { status: 201 });
  } catch (err: any) {
    console.error('[models/create] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create model' } },
      { status: 500 }
    );
  }
}
// Force rebuild Sun Jun 21 00:27:55 UTC 2026
