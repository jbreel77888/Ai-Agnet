/**
 * Provider Manager — central interface for all LLM operations
 */
import type {
  ProviderConfig, Model, ChatRequest, ChatResponse, ChatChunk, ChatOptions,
  ModelCapabilities, TokenUsage,
} from '../../../types';

export interface ProviderManager {
  chat(request: ChatRequest, opts?: ChatOptions): Promise<ChatResponse>;
  chatStream(request: ChatRequest, opts?: ChatOptions): AsyncIterable<ChatChunk>;

  // Routing & Fallback
  selectModel(preferredId: string, fallbackChain?: string[]): Model;
  resolveModel(modelId: string): Model;

  // Provider management
  getProvider(slug: string): IProvider | undefined;
  listProviders(): IProvider[];
  registerProvider(provider: IProvider): void;
  enableProvider(slug: string): Promise<void>;
  disableProvider(slug: string): Promise<void>;

  // Models
  listModels(providerSlug?: string): Model[];
  refreshModels(providerSlug: string): Promise<void>;

  // Health
  healthCheck(slug: string): Promise<ProviderHealth>;
  getMetrics(slug?: string): ProviderMetrics;
}

export interface IProvider {
  readonly id: string;
  readonly slug: string;
  readonly type: ProviderConfig['type'];
  readonly config: ProviderConfig;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;

  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<ChatChunk>;

  listModels(): Promise<Model[]>;
  refreshModels(): Promise<void>;
  getCapabilities(modelName: string): ModelCapabilities;
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'down';
  latencyMs?: number;
  lastCheckedAt: Date;
  details?: Record<string, unknown>;
}

export interface ProviderMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  totalTokensUsed: TokenUsage;
  totalCostUsd: number;
  circuitState: 'closed' | 'open' | 'half_open';
  lastError?: { code: string; message: string; at: Date };
}

export interface ProviderError {
  code: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
  details?: unknown;
}
