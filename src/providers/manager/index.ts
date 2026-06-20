/**
 * Provider Manager — central interface for all LLM operations
 *
 * Responsibilities:
 * - Load providers/models from DB
 * - Route requests to the correct strategy
 * - Apply timeout + retry + circuit breaker
 * - Handle fallback chains
 * - Track metrics + cost
 */
import { db } from '../../db/client';
import { providers, models } from '../../db/schema';
import { eq, and } from 'drizzle-orm';
import { decrypt } from '../../utils/crypto';
import { withRetry, withTimeout, TimeoutError } from '../../utils/retry';
import { createCircuitBreaker, CircuitOpenError, type CircuitBreaker } from '../../utils/circuit-breaker';
import { OpenAIStrategy } from '../strategies/openai.strategy';
import { AnthropicStrategy } from '../strategies/anthropic.strategy';
import { GeminiStrategy } from '../strategies/gemini.strategy';
import type { IProviderStrategy } from '../strategies/base';
import type {
  ProviderManager, IProvider, ProviderConfig, Model, ChatRequest,
  ChatResponse, ChatChunk, ChatOptions, ProviderHealth, ProviderMetrics,
} from './types';
import type { ProviderType } from '../../types';

// Strategy registry — one per provider type
const strategies: Record<ProviderType, IProviderStrategy> = {
  openai: new OpenAIStrategy(),
  openai_compatible: new OpenAIStrategy(),
  anthropic: new AnthropicStrategy(),
  gemini: new GeminiStrategy(),
  groq: new OpenAIStrategy(),
  openrouter: new OpenAIStrategy(),
  ollama: new OpenAIStrategy(),
  custom: new OpenAIStrategy(),
};

// In-memory caches
const providerCache = new Map<string, { config: ProviderConfig; strategy: IProviderStrategy; circuit: CircuitBreaker }>();
const modelCache = new Map<string, Model>();

let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

async function loadProvidersFromDB(): Promise<void> {
  if (Date.now() - cacheLoadedAt < CACHE_TTL_MS) return;

  providerCache.clear();
  modelCache.clear();

  const allProviders = await db.select().from(providers);
  const allModels = await db.select().from(models).where(eq(models.status, 'active'));

  for (const p of allProviders) {
    if (p.status !== 'active') continue;

    let apiKey = '';
    try {
      apiKey = p.apiKeyEncrypted ? decrypt(p.apiKeyEncrypted) : '';
    } catch (err) {
      console.error(`[provider-manager] Failed to decrypt API key for ${p.slug}:`, err);
      continue;
    }

    const config: ProviderConfig = {
      id: p.id,
      slug: p.slug,
      name: p.name,
      type: p.type as ProviderType,
      baseUrl: p.baseUrl,
      apiKey,
      headers: (p.headers as Record<string, string>) || undefined,
      timeoutMs: p.timeoutMs,
      maxRetries: p.maxRetries,
      status: p.status as 'active' | 'inactive' | 'error',
      healthStatus: p.healthStatus as 'healthy' | 'degraded' | 'down' | 'unknown',
    };

    const strategy = strategies[config.type] || strategies.openai_compatible;
    const circuit = createCircuitBreaker(`provider:${p.slug}`, {
      failureThreshold: 5,
      windowMs: 10000,
      openMs: 30000,
    });

    providerCache.set(p.slug, { config, strategy, circuit });
  }

  for (const m of allModels) {
    const model: Model = {
      id: m.id,
      providerId: m.providerId,
      name: m.name,
      displayName: m.displayName || m.name,
      inputPricePer1k: parseFloat(m.inputPricePer1k),
      outputPricePer1k: parseFloat(m.outputPricePer1k),
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      capabilities: {
        supportsTools: m.supportsTools,
        supportsVision: m.supportsVision,
        supportsStreaming: m.supportsStreaming,
        supportsThinking: m.supportsThinking,
        supportsJsonMode: m.supportsJsonMode,
        supportsSystemPrompt: true,
        maxContextTokens: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
      },
      priority: m.priority,
      status: m.status as 'active' | 'deprecated' | 'inactive',
    };
    modelCache.set(m.id, model);
  }

  cacheLoadedAt = Date.now();
  console.log(`[provider-manager] Loaded ${providerCache.size} providers, ${modelCache.size} models`);
}

function findProviderForModel(modelId: string): { config: ProviderConfig; strategy: IProviderStrategy; circuit: CircuitBreaker } | undefined {
  const model = modelCache.get(modelId);
  if (!model) return undefined;

  for (const p of providerCache.values()) {
    if (p.config.id === model.providerId) return p;
  }
  return undefined;
}

export class ProviderManagerImpl implements ProviderManager {
  async chat(request: ChatRequest, opts: ChatOptions = {}): Promise<ChatResponse> {
    await loadProvidersFromDB();

    const modelChain = this.buildModelChain(request.modelId, opts.fallbackModelIds);
    let lastError: Error | undefined;

    for (const modelId of modelChain) {
      const providerInfo = findProviderForModel(modelId);
      if (!providerInfo) {
        lastError = new Error(`No provider found for model ${modelId}`);
        continue;
      }

      const { config, strategy, circuit } = providerInfo;
      const model = modelCache.get(modelId)!;

      try {
        const result = await circuit.execute(async () => {
          const req = strategy.buildRequest(
            { ...request, modelId, stream: false },
            config.baseUrl,
            config.apiKey,
            config.headers,
          );

          const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
          const startTime = Date.now();

          const response = await withTimeout(
            async () => {
              const res = await fetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: JSON.stringify(req.body),
              });

              if (!res.ok) {
                const errorBody = await res.json().catch(() => ({}));
                const errorInfo = strategy.classifyError(res.status, errorBody);
                const err = new Error(errorInfo.message) as any;
                err.code = errorInfo.code;
                err.statusCode = errorInfo.statusCode;
                err.rateLimited = errorInfo.rateLimited;
                err.retryable = errorInfo.retryable;
                throw err;
              }

              return res;
            },
            timeoutMs
          );

          const raw = await response.json();
          const chatResponse = strategy.parseResponse(raw, model.name);
          chatResponse.latencyMs = Date.now() - startTime;

          // Record cost
          if (opts.userId && chatResponse.usage.totalTokens > 0) {
            try {
              const { createCostTracker } = await import('../../observability/cost');
              const costTracker = createCostTracker();
              await costTracker.record({
                userId: opts.userId,
                sessionId: opts.sessionId,
                agentId: opts.agentId,
                modelId,
                providerId: config.id,
                tokensInput: chatResponse.usage.inputTokens,
                tokensOutput: chatResponse.usage.outputTokens,
              });
            } catch (err) {
              console.error('[provider-manager] Cost tracking failed:', err);
            }
          }

          return chatResponse;
        });

        return result;
      } catch (err: any) {
        lastError = err;
        console.warn(`[provider-manager] Model ${modelId} failed:`, err.message);

        // Don't fallback for non-retryable errors (4xx other than 429)
        if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
          throw err;
        }

        // Try next model in fallback chain
        continue;
      }
    }

    throw lastError || new Error('All models failed');
  }

  async *chatStream(request: ChatRequest, opts: ChatOptions = {}): AsyncIterable<ChatChunk> {
    await loadProvidersFromDB();

    const modelChain = this.buildModelChain(request.modelId, opts.fallbackModelIds);
    let lastError: Error | undefined;

    for (const modelId of modelChain) {
      const providerInfo = findProviderForModel(modelId);
      if (!providerInfo) {
        lastError = new Error(`No provider found for model ${modelId}`);
        continue;
      }

      const { config, strategy } = providerInfo;

      try {
        const req = strategy.buildRequest(
          { ...request, modelId, stream: true },
          config.baseUrl,
          config.apiKey,
          config.headers,
        );

        const response = await fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: JSON.stringify(req.body),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          const errorInfo = strategy.classifyError(response.status, errorBody);
          throw Object.assign(new Error(errorInfo.message), {
            code: errorInfo.code,
            statusCode: errorInfo.statusCode,
            rateLimited: errorInfo.rateLimited,
            retryable: errorInfo.retryable,
          });
        }

        if (!response.body) {
          throw new Error('No response body for stream');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              const chunk = strategy.parseStreamChunk(trimmed);
              if (chunk) {
                if (chunk.usage) {
                  totalInputTokens = chunk.usage.inputTokens;
                  totalOutputTokens = chunk.usage.outputTokens;
                }
                yield chunk;
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            const chunk = strategy.parseStreamChunk(buffer.trim());
            if (chunk) yield chunk;
          }
        } finally {
          reader.releaseLock();
        }

        // Record cost for the stream
        if (opts.userId && (totalInputTokens > 0 || totalOutputTokens > 0)) {
          try {
            const { createCostTracker } = await import('../../observability/cost');
            const costTracker = createCostTracker();
            await costTracker.record({
              userId: opts.userId,
              sessionId: opts.sessionId,
              agentId: opts.agentId,
              modelId,
              providerId: config.id,
              tokensInput: totalInputTokens,
              tokensOutput: totalOutputTokens,
            });
          } catch (err) {
            console.error('[provider-manager] Stream cost tracking failed:', err);
          }
        }

        return; // Success — exit the fallback loop
      } catch (err: any) {
        lastError = err;
        console.warn(`[provider-manager] Stream for model ${modelId} failed:`, err.message);

        if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
          throw err;
        }
        continue;
      }
    }

    throw lastError || new Error('All models failed for stream');
  }

  private buildModelChain(primaryId: string, fallbackIds?: string[]): string[] {
    const chain = [primaryId, ...(fallbackIds || [])];
    // Dedupe
    return [...new Set(chain)];
  }

  selectModel(preferredId: string, fallbackChain?: string[]): Model {
    // Synchronous version — uses cached data
    const model = modelCache.get(preferredId);
    if (model) return model;
    if (fallbackChain) {
      for (const id of fallbackChain) {
        const m = modelCache.get(id);
        if (m) return m;
      }
    }
    throw new Error(`Model ${preferredId} not found`);
  }

  resolveModel(modelId: string): Model {
    const model = modelCache.get(modelId);
    if (!model) throw new Error(`Model ${modelId} not found`);
    return model;
  }

  getProvider(slug: string): IProvider | undefined {
    const cached = providerCache.get(slug);
    if (!cached) return undefined;
    return {
      id: cached.config.id,
      slug: cached.config.slug,
      type: cached.config.type,
      config: cached.config,
      initialize: async () => {},
      shutdown: async () => {},
      healthCheck: async () => ({ status: cached.config.healthStatus, lastCheckedAt: new Date() }),
      chat: async (req) => this.chat(req),
      chatStream: (req) => this.chatStream(req),
      listModels: async () => Array.from(modelCache.values()).filter(m => m.providerId === cached.config.id),
      refreshModels: async () => { cacheLoadedAt = 0; },
      getCapabilities: (name: string) => {
        const m = Array.from(modelCache.values()).find(m => m.name === name);
        return m?.capabilities || {
          supportsTools: false, supportsVision: false, supportsStreaming: true,
          supportsThinking: false, supportsJsonMode: false, supportsSystemPrompt: true,
          maxContextTokens: 4096, maxOutputTokens: 4096,
        };
      },
    };
  }

  listProviders(): IProvider[] {
    return Array.from(providerCache.keys()).map(slug => this.getProvider(slug)!).filter(Boolean);
  }

  registerProvider(_provider: IProvider): void {
    cacheLoadedAt = 0; // Force reload
  }

  async enableProvider(slug: string): Promise<void> {
    await db.update(providers).set({ status: 'active' }).where(eq(providers.slug, slug));
    cacheLoadedAt = 0;
  }

  async disableProvider(slug: string): Promise<void> {
    await db.update(providers).set({ status: 'inactive' }).where(eq(providers.slug, slug));
    cacheLoadedAt = 0;
  }

  listModels(providerSlug?: string[]): Model[] {
    if (!providerSlug) return Array.from(modelCache.values());
    const providerIds = providerSlug.flatMap(s => {
      const p = providerCache.get(s);
      return p ? [p.config.id] : [];
    });
    return Array.from(modelCache.values()).filter(m => providerIds.includes(m.providerId));
  }

  async refreshModels(providerSlug: string): Promise<void> {
    const cached = providerCache.get(providerSlug);
    if (!cached) throw new Error(`Provider ${providerSlug} not found`);
    const { config, strategy } = cached;

    if (!strategy.getModelsEndpoint || !strategy.parseModelsResponse) return;

    try {
      const url = strategy.getModelsEndpoint(config.baseUrl);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.type === 'anthropic') {
        headers['x-api-key'] = config.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }
      if (config.headers) Object.assign(headers, config.headers);

      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Failed to fetch models: HTTP ${response.status}`);
      }
      const raw = await response.json();
      const discoveredModels = strategy.parseModelsResponse(raw);

      // Update DB — mark new models as active, leave existing ones untouched
      for (const m of discoveredModels) {
        const [existing] = await db.select().from(models)
          .where(and(eq(models.providerId, config.id), eq(models.name, m.id)))
          .limit(1);

        if (!existing) {
          await db.insert(models).values({
            providerId: config.id,
            name: m.id,
            displayName: m.name,
            status: 'active',
          });
        }
      }

      cacheLoadedAt = 0; // Force reload
      console.log(`[provider-manager] Refreshed ${discoveredModels.length} models for ${providerSlug}`);
    } catch (err) {
      console.error(`[provider-manager] Failed to refresh models for ${providerSlug}:`, err);
      throw err;
    }
  }

  async healthCheck(slug: string): Promise<ProviderHealth> {
    const cached = providerCache.get(slug);
    if (!cached) {
      return { status: 'down', lastCheckedAt: new Date(), details: { error: 'Provider not found' } };
    }

    const start = Date.now();
    try {
      // Simple health check: try to list models
      if (cached.strategy.getModelsEndpoint) {
        const url = cached.strategy.getModelsEndpoint(cached.config.baseUrl);
        const headers: Record<string, string> = {};
        if (cached.config.type === 'anthropic') {
          headers['x-api-key'] = cached.config.apiKey;
          headers['anthropic-version'] = '2023-06-01';
        } else {
          headers['Authorization'] = `Bearer ${cached.config.apiKey}`;
        }
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          return { status: 'healthy', latencyMs: Date.now() - start, lastCheckedAt: new Date() };
        }
        return { status: 'degraded', latencyMs: Date.now() - start, lastCheckedAt: new Date(), details: { statusCode: response.status } };
      }
      return { status: 'healthy', lastCheckedAt: new Date() };
    } catch (err: any) {
      return { status: 'down', lastCheckedAt: new Date(), details: { error: err.message } };
    }
  }

  getMetrics(_slug?: string): ProviderMetrics {
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageLatencyMs: 0,
      p95LatencyMs: 0,
      totalTokensUsed: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalCostUsd: 0,
      circuitState: 'closed',
    };
  }
}

// Singleton
let managerInstance: ProviderManagerImpl | null = null;

export function getProviderManager(): ProviderManagerImpl {
  if (!managerInstance) managerInstance = new ProviderManagerImpl();
  return managerInstance;
}
