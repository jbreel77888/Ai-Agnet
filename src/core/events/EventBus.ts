/**
 * Central EventBus — decouples modules from each other.
 *
 * - Type-safe event names (string literal unions or symbols)
 * - Async handlers
 * - Error isolation (one failing handler doesn't break others)
 * - Wildcard subscription for observability
 */

export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface EventBusSubscription {
  unsubscribe(): void;
}

export interface EventBus {
  emit<T>(event: string, payload: T): Promise<void>;
  on<T = unknown>(event: string, handler: EventHandler<T>): EventBusSubscription;
  once<T = unknown>(event: string, handler: EventHandler<T>): EventBusSubscription;
  off(event: string, handler: EventHandler): void;
  removeAllListeners(event?: string): void;
  listenerCount(event: string): number;
}

export function createEventBus(): EventBus {
  const handlers = new Map<string, Set<EventHandler>>();
  const wildcardHandlers = new Set<EventHandler<{ event: string; payload: unknown }>>();

  const emit = async <T>(event: string, payload: T): Promise<void> => {
    const eventHandlers = handlers.get(event);
    const promises: Promise<void>[] = [];

    if (eventHandlers) {
      for (const handler of eventHandlers) {
        promises.push(
          Promise.resolve(handler(payload)).catch((err) => {
            // Log error but don't break other handlers
            console.error(`[eventbus] Handler error for "${event}":`, err);
          })
        );
      }
    }

    for (const handler of wildcardHandlers) {
      promises.push(
        Promise.resolve(handler({ event, payload })).catch((err) => {
          console.error(`[eventbus] Wildcard handler error for "${event}":`, err);
        })
      );
    }

    await Promise.all(promises);
  };

  const on = <T = unknown>(event: string, handler: EventHandler<T>): EventBusSubscription => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler as EventHandler);
    return { unsubscribe: () => off(event, handler as EventHandler) };
  };

  const once = <T = unknown>(event: string, handler: EventHandler<T>): EventBusSubscription => {
    const wrapped: EventHandler<T> = async (payload) => {
      off(event, wrapped as EventHandler);
      await handler(payload);
    };
    return on(event, wrapped);
  };

  const off = (event: string, handler: EventHandler) => {
    handlers.get(event)?.delete(handler);
  };

  const removeAllListeners = (event?: string) => {
    if (event) handlers.delete(event);
    else handlers.clear();
  };

  const listenerCount = (event: string) => handlers.get(event)?.size ?? 0;

  return { emit, on, once, off, removeAllListeners, listenerCount };
}

// =============================================================================
// Standard Event Names (registry to avoid typos)
// =============================================================================

export const EVENTS = {
  // Agent lifecycle
  AGENT_STARTED: 'agent.started',
  AGENT_COMPLETED: 'agent.completed',
  AGENT_FAILED: 'agent.failed',
  AGENT_CANCELLED: 'agent.cancelled',
  AGENT_HANDOFF: 'agent.handoff',
  AGENT_SUBAGENT_SPAWNED: 'agent.subagent_spawned',

  // Messages
  MESSAGE_CREATED: 'message.created',
  MESSAGE_STREAM_CHUNK: 'message.stream_chunk',

  // Tools
  TOOL_REGISTERED: 'tool.registered',
  TOOL_UNREGISTERED: 'tool.unregistered',
  TOOL_CALLED: 'tool.called',
  TOOL_RESULT: 'tool.result',
  TOOLS_CHANGED: 'tools.changed',

  // Providers
  PROVIDER_HEALTH_CHANGED: 'provider.health_changed',
  PROVIDER_FALLBACK_TRIGGERED: 'provider.fallback_triggered',
  PROVIDER_CIRCUIT_OPEN: 'provider.circuit_open',

  // Memory
  MEMORY_FACT_STORED: 'memory.fact_stored',
  MEMORY_ENTITY_EXTRACTED: 'memory.entity_extracted',
  MEMORY_SUMMARY_CREATED: 'memory.summary_created',
  MEMORY_COMPRESSED: 'memory.compressed',

  // MCP
  MCP_SERVER_CONNECTED: 'mcp.server_connected',
  MCP_SERVER_DISCONNECTED: 'mcp.server_disconnected',
  MCP_TOOLS_DISCOVERED: 'mcp.tools_discovered',

  // Workflows
  WORKFLOW_STARTED: 'workflow.started',
  WORKFLOW_STEP_COMPLETED: 'workflow.step_completed',
  WORKFLOW_STEP_FAILED: 'workflow.step_failed',
  WORKFLOW_COMPLETED: 'workflow.completed',
  WORKFLOW_FAILED: 'workflow.failed',

  // Cost
  COST_TOKEN_USED: 'cost.token_used',
  COST_BUDGET_EXCEEDED: 'cost.budget_exceeded',

  // Auth
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_REGISTERED: 'user.registered',
  ROLE_ASSIGNED: 'role.assigned',

  // Sessions
  SESSION_CREATED: 'session.created',
  SESSION_PAUSED: 'session.paused',
  SESSION_RESUMED: 'session.resumed',
  SESSION_COMPLETED: 'session.completed',

  // System
  SYSTEM_SHUTTING_DOWN: 'system.shutting_down',
  SYSTEM_HEALTH_CHANGED: 'system.health_changed',
} as const;

export type EventName = typeof EVENTS[keyof typeof EVENTS];
