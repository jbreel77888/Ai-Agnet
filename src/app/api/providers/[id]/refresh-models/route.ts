/**
 * POST /api/providers/[id]/refresh-models
 * Fetches the model list from the provider's API and updates the DB
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../../db/client';
import { providers, models } from '../../../../../db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '../../../../../utils/crypto';
import { createJWTService } from '../../../../../auth/jwt';
import { OpenAIStrategy } from '../../../../../providers/strategies/openai.strategy';
import { AnthropicStrategy } from '../../../../../providers/strategies/anthropic.strategy';
import { GeminiStrategy } from '../../../../../providers/strategies/gemini.strategy';
import type { ProviderType } from '../../../../../types';

const strategies: Record<ProviderType, any> = {
  openai: new OpenAIStrategy(),
  openai_compatible: new OpenAIStrategy(),
  anthropic: new AnthropicStrategy(),
  gemini: new GeminiStrategy(),
  groq: new OpenAIStrategy(),
  openrouter: new OpenAIStrategy(),
  ollama: new OpenAIStrategy(),
  custom: new OpenAIStrategy(),
};

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const jwtService = createJWTService();
    const payload = await jwtService.verifyAccessToken(token);
    if (!payload.roles?.includes('admin')) return null;
    return payload;
  } catch {
    return null;
  }
}

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

    const strategy = strategies[provider.type as ProviderType];
    if (!strategy?.getModelsEndpoint) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_SUPPORTED', message: 'This provider type does not support model discovery. Use "Add Model" to add models manually.' } },
        { status: 400 }
      );
    }

    const apiKey = provider.apiKeyEncrypted ? decrypt(provider.apiKeyEncrypted) : '';
    const url = strategy.getModelsEndpoint(provider.baseUrl);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.type === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    if (provider.headers) Object.assign(headers, provider.headers);

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

    if (!response.ok) {
      const errorBody = await response.text();
      const status = response.status;
      let hint = '';
      if (status === 401 || status === 403) {
        hint = ' — Check that the API key is correct and has permission to list models';
      } else if (status === 404) {
        hint = ' — This provider may not support model discovery. Try adding models manually instead.';
      } else if (status === 429) {
        hint = ' — Rate limit exceeded. Try again later or add models manually.';
      }
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PROVIDER_ERROR',
            message: `Provider returned HTTP ${status}${hint}`,
            details: errorBody.substring(0, 500),
            suggestion: 'You can add models manually using the "Add Model" button on the provider card.',
          },
        },
        { status: 502 }
      );
    }

    const raw = await response.json();

    // Some providers return empty data arrays or unexpected formats
    const discovered = strategy.parseModelsResponse(raw);
    if (discovered.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NO_MODELS_FOUND',
            message: 'Provider returned no models. The API may not support model discovery.',
            suggestion: 'Add models manually using the "Add Model" button on the provider card.',
            rawResponse: JSON.stringify(raw).substring(0, 500),
          },
        },
        { status: 422 }
      );
    }

    // Update DB
    let addedCount = 0;
    let updatedCount = 0;

    for (const m of discovered) {
      const [existing] = await db.select().from(models)
        .where(and(eq(models.providerId, provider.id), eq(models.name, m.id)))
        .limit(1);

      if (!existing) {
        await db.insert(models).values({
          providerId: provider.id,
          name: m.id,
          displayName: m.name,
          status: 'active',
        });
        addedCount++;
      } else {
        await db.update(models).set({
          displayName: m.name !== existing.displayName ? m.name : existing.displayName,
        }).where(eq(models.id, existing.id));
        updatedCount++;
      }
    }

    // Update provider's health
    await db.update(providers).set({
      healthStatus: 'healthy',
      healthCheckAt: new Date(),
    }).where(eq(providers.id, provider.id));

    return NextResponse.json({
      success: true,
      data: {
        discovered: discovered.length,
        added: addedCount,
        updated: updatedCount,
      },
    });
  } catch (err: any) {
    console.error('[providers/refresh-models] Error:', err);

    // Mark provider as degraded
    try {
      const { id } = await params;
      await db.update(providers).set({
        healthStatus: 'degraded',
        healthCheckAt: new Date(),
      }).where(eq(providers.id, id));
    } catch {}

    return NextResponse.json(
      { success: false, error: { code: 'REFRESH_FAILED', message: err.message || 'Failed to refresh models' } },
      { status: 500 }
    );
  }
}
