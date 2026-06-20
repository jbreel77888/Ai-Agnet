/**
 * Lightweight Dependency Injection Container
 *
 * Features:
 * - Token-based (Symbol) registration to avoid circular imports
 * - Singleton & Transient scopes
 * - Lazy initialization
 * - Async factories
 *
 * Usage:
 *   const C = new Container();
 *   C.bind(LOGGER, () => new PinoLogger(), { scope: 'singleton' });
 *   const logger = await C.resolve<Logger>(LOGGER);
 */

export type Token<T = unknown> = symbol & { readonly __type?: T };

export function token<T>(description: string): Token<T> {
  return Symbol(description) as Token<T>;
}

export interface BindingOptions {
  scope?: 'singleton' | 'transient';
}

export interface Container {
  bind<T>(token: Token<T>, factory: (c: Container) => T | Promise<T>, opts?: BindingOptions): void;
  bindInstance<T>(token: Token<T>, instance: T): void;
  resolve<T>(token: Token<T>): Promise<T>;
  resolveSync<T>(token: Token<T>): T;
  has(token: Token<unknown>): boolean;
  reset(): void;
  child(): Container;
}

export function createContainer(parent?: Container): Container {
  const instances = new Map<Token, unknown>();
  const factories = new Map<Token, (c: Container) => unknown | Promise<unknown>>();
  const scopes = new Map<Token, 'singleton' | 'transient'>();

  const container: Container = {
    bind<T>(token: Token<T>, factory: (c: Container) => T | Promise<T>, opts: BindingOptions = {}) {
      factories.set(token, factory as (c: Container) => unknown);
      scopes.set(token, opts.scope ?? 'singleton');
      instances.delete(token); // reset cached instance
    },

    bindInstance<T>(token: Token<T>, instance: T) {
      instances.set(token, instance);
      factories.set(token, () => instance);
      scopes.set(token, 'singleton');
    },

    async resolve<T>(token: Token<T>): Promise<T> {
      const scope = scopes.get(token);
      if (scope === 'singleton' && instances.has(token)) {
        return instances.get(token) as T;
      }
      const factory = factories.get(token);
      if (!factory) {
        if (parent) return parent.resolve<T>(token);
        throw new Error(`[di] No binding for token: ${String(token)}`);
      }
      const instance = await factory(container);
      if (scope === 'singleton') {
        instances.set(token, instance);
      }
      return instance as T;
    },

    resolveSync<T>(token: Token<T>): T {
      if (instances.has(token)) return instances.get(token) as T;
      const factory = factories.get(token);
      if (!factory) {
        if (parent) return parent.resolveSync<T>(token);
        throw new Error(`[di] No sync binding for token: ${String(token)}`);
      }
      const instance = factory(container);
      if (instance instanceof Promise) {
        throw new Error(`[di] Token ${String(token)} requires async resolve`);
      }
      const scope = scopes.get(token);
      if (scope === 'singleton') {
        instances.set(token, instance);
      }
      return instance as T;
    },

    has(token: Token<unknown>): boolean {
      return factories.has(token) || (parent?.has(token) ?? false);
    },

    reset() {
      instances.clear();
    },

    child() {
      return createContainer(container);
    },
  };

  return container;
}

// =============================================================================
// Global Tokens — module-registered services
// =============================================================================

import type { Container } from './container';
import type { EventBus } from '../core/events/EventBus';
import type { Logger } from '../observability/logger/types';
import type { Tracer } from '../observability/tracing/types';
import type { MetricsCollector } from '../observability/metrics/types';
import type { CostTracker } from '../observability/cost/types';
import type { ProviderManager } from '../providers/manager/types';
import type { ToolRegistry } from '../tools/registry/types';
import type { AgentRegistry } from '../agents/registry/types';
import type { AgentOrchestrator } from '../agents/orchestrator/types';
import type { ShortTermMemory } from '../memory/short-term/types';
import type { LongTermMemory } from '../memory/long-term/types';
import type { ContextManager } from '../context/managers/types';
import type { WorkflowExecutor } from '../workflows/executor/types';
import type { MCPClient } from '../mcp/client/types';
import type { StorageManager } from '../storage/manager/types';
import type { RAGService } from '../rag/types';
import type { AuditLogger } from '../observability/logger/audit';

export const TOKENS = {
  Container: token<Container>('Container'),
  EventBus: token<EventBus>('EventBus'),
  Logger: token<Logger>('Logger'),
  Tracer: token<Tracer>('Tracer'),
  Metrics: token<MetricsCollector>('Metrics'),
  CostTracker: token<CostTracker>('CostTracker'),
  ProviderManager: token<ProviderManager>('ProviderManager'),
  ToolRegistry: token<ToolRegistry>('ToolRegistry'),
  AgentRegistry: token<AgentRegistry>('AgentRegistry'),
  AgentOrchestrator: token<AgentOrchestrator>('AgentOrchestrator'),
  ShortTermMemory: token<ShortTermMemory>('ShortTermMemory'),
  LongTermMemory: token<LongTermMemory>('LongTermMemory'),
  ContextManager: token<ContextManager>('ContextManager'),
  WorkflowExecutor: token<WorkflowExecutor>('WorkflowExecutor'),
  MCPClient: token<MCPClient>('MCPClient'),
  StorageManager: token<StorageManager>('StorageManager'),
  RAGService: token<RAGService>('RAGService'),
  AuditLogger: token<AuditLogger>('AuditLogger'),
} as const;
