/**
 * GET /api/models — List all available models
 * Returns models with their provider info, for chat UI dropdown
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../db/client';
import { models, providers } from '../../../db/schema';
import { eq } from 'drizzle-orm';
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
    const allModels = await db.select({
      model: models,
      provider: providers,
    })
    .from(models)
    .innerJoin(providers, eq(models.providerId, providers.id))
    .where(eq(models.status, 'active'));

    return NextResponse.json({
      success: true,
      data: {
        models: allModels.map(({ model, provider }) => ({
          id: model.id,
          name: model.name,
          displayName: model.displayName || model.name,
          providerId: model.providerId,
          providerName: provider.name,
          providerSlug: provider.slug,
          providerType: provider.type,
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
        })),
      },
    });
  } catch (err: any) {
    console.error('[models/list] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch models' } },
      { status: 500 }
    );
  }
}
