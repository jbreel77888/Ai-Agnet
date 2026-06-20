/**
 * Agent Registry & Orchestrator interfaces
 */
import type {
  AgentType, AgentConfig, AgentInput, AgentOutput, AgentEvent,
  AgentContext, HandoffPayload, HealthStatus,
} from '../../../types';

export interface IAgent {
  readonly id: string;
  readonly slug: string;
  readonly type: AgentType;
  readonly config: AgentConfig;

  initialize(context: AgentContext): Promise<void>;
  shutdown(): Promise<void>;

  execute(input: AgentInput, ctx: AgentContext): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;

  canHandle(input: AgentInput): number;
  handoff(target: string, payload: HandoffPayload): Promise<void>;
  onHandoff(payload: HandoffPayload): Promise<void>;

  spawnSubAgent(type: AgentType, config?: Partial<AgentConfig>): Promise<IAgent>;
  listSubAgents(): IAgent[];

  getMetrics(): AgentMetrics;
  healthCheck(): Promise<HealthStatus>;
}

export interface AgentMetrics {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDurationMs: number;
  totalTokensUsed: number;
  totalCostUsd: number;
  activeSubAgents: number;
}

export interface AgentRegistry {
  register(agent: IAgent): void;
  unregister(slug: string): void;
  get(slug: string): IAgent | undefined;
  list(filter?: { type?: AgentType; enabledOnly?: boolean }): IAgent[];
  reloadFromDB(): Promise<void>;
  selectBestFor(input: AgentInput): IAgent | undefined;
}

export interface AgentOrchestrator {
  startSession(opts: {
    agentSlug: string;
    input: AgentInput;
    userId: string;
    title?: string;
  }): Promise<OrchestrationHandle>;
}

export interface OrchestrationHandle {
  sessionId: string;
  agentId: string;
  events(): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  waitForCompletion(): Promise<AgentOutput>;
}
