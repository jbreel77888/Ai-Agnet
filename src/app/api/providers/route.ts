/**
 * GET /api/providers — List all providers
 * POST /api/providers — Create new provider
 *
 * Requires admin role
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../db/client';
import { providers, models } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { encrypt } from '../../../utils/crypto';
import { createJWTService } from '../../../auth/jwt';
import { createAuditLogger } from '../../../observability/logger/audit';

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const jwtService = createJWTService();
  try {
    const payload = await jwtService.verifyAccessToken(token);
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

export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const allProviders = await db.select().from(providers);
    const allModels = await db.select().from(models);

    const result = allProviders.map(p => ({
      ...sanitizeProvider(p),
      models: allModels.filter(m => m.providerId === p.id).map(m => ({
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
    }));

    return NextResponse.json({ success: true, data: { providers: result } });
  } catch (err: any) {
    console.error('[providers/list] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch providers' } },
      { status: 500 }
    );
  }
}

const createProviderSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
  type: z.enum(['openai', 'anthropic', 'gemini', 'groq', 'ollama', 'openrouter', 'openai_compatible', 'custom']),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
  timeoutMs: z.number().min(1000).max(300000).default(30000),
  maxRetries: z.number().min(0).max(10).default(3),
});

export async function POST(req: NextRequest) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const parsed = createProviderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const { apiKey, ...rest } = parsed.data;
    const apiKeyEncrypted = apiKey ? encrypt(apiKey) : null;

    const [provider] = await db.insert(providers).values({
      ...rest,
      apiKeyEncrypted,
      status: 'active',
      healthStatus: 'unknown',
    }).returning();

    // Audit log
    const audit = createAuditLogger();
    await audit.record({
      userId: user.sub,
      action: 'provider.create',
      resourceType: 'provider',
      resourceId: provider.id,
      after: sanitizeProvider(provider),
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      success: true,
      data: { provider: sanitizeProvider(provider) },
    }, { status: 201 });
  } catch (err: any) {
    if (err.code === '23505') {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: 'Provider slug already exists' } },
        { status: 409 }
      );
    }
    console.error('[providers/create] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create provider' } },
      { status: 500 }
    );
  }
}
