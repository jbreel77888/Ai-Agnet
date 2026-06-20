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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireAdmin(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } },
      { status: 403 }
    );
  }

  try {
    const [provider] = await db.select().from(providers).where(eq(providers.id, params.id)).limit(1);
    if (!provider) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Provider not found' } },
        { status: 404 }
      );
    }

    const strategy = strategies[provider.type as ProviderType];
    if (!strategy?.getModelsEndpoint) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_SUPPORTED', message: 'This provider type does not support model discovery' } },
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
      return NextResponse.json(
        { success: false, error: { code: 'PROVIDER_ERROR', message: `Provider returned ${response.status}`, details: errorBody.substring(0, 500) } },
        { status: 502 }
      );
    }

    const raw = await response.json();
    const discovered = strategy.parseModelsResponse(raw);

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
        // Update display name only
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
      await db.update(providers).set({
        healthStatus: 'degraded',
        healthCheckAt: new Date(),
      }).where(eq(providers.id, params.id));
    } catch {}

    return NextResponse.json(
      { success: false, error: { code: 'REFRESH_FAILED', message: err.message || 'Failed to refresh models' } },
      { status: 500 }
    );
  }
}
