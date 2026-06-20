/**
 * Short-Term Memory interface (Redis-backed)
 */
import type { ChatMessage } from '../../../types';

export interface ShortTermMemory {
  addMessage(sessionId: string, msg: ChatMessage): Promise<void>;
  getMessages(sessionId: string, opts?: {
    limit?: number;
    since?: Date;
    role?: ChatMessage['role'];
  }): Promise<ChatMessage[]>;
  clearMessages(sessionId: string): Promise<void>;
  countMessages(sessionId: string): Promise<number>;

  setVar(sessionId: string, key: string, value: unknown, ttlSec?: number): Promise<void>;
  getVar<T>(sessionId: string, key: string): Promise<T | undefined>;
  deleteVar(sessionId: string, key: string): Promise<void>;
  getAllVars(sessionId: string): Promise<Record<string, unknown>>;

  setAgentState(sessionId: string, agentId: string, state: unknown): Promise<void>;
  getAgentState<T>(sessionId: string, agentId: string): Promise<T | undefined>;

  // Session-level operations
  touchSession(sessionId: string): Promise<void>;
  isSessionActive(sessionId: string): Promise<boolean>;
  setSessionExpiry(sessionId: string, ttlSec: number): Promise<void>;

  // Persistence sync with PostgreSQL
  persistSession(sessionId: string): Promise<void>;
  restoreSession(sessionId: string): Promise<void>;
}
