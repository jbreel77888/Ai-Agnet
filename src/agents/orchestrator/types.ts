/**
 * Agent Orchestrator interface
 */
import type {
  AgentInput, AgentOutput, AgentEvent, AgentContext,
} from '../../../types';
import type { IAgent } from '../../registry/types';

export interface AgentOrchestrator {
  startSession(opts: {
    agentSlug: string;
    input: AgentInput;
    userId: string;
    title?: string;
  }): Promise<OrchestrationHandle>;

  resumeSession(sessionId: string): Promise<OrchestrationHandle>;
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
}

export interface OrchestrationHandle {
  sessionId: string;
  agentId: string;
  events(): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  waitForCompletion(): Promise<AgentOutput>;
  getCurrentAgent(): IAgent | undefined;
  getHandoffHistory(): { from: string; to: string; reason: string; at: Date }[];
}

export interface SessionStatus {
  sessionId: string;
  status: 'active' | 'paused' | 'completed' | 'failed';
  currentAgentSlug?: string;
  stepNumber: number;
  tokensUsed: number;
  costUsd: number;
  startedAt: Date;
  lastActivityAt: Date;
}
