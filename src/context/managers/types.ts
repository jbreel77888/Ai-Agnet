/**
 * Context Manager interface
 */
import type { ChatMessage, ChatRequest } from '../../../types';

export interface ContextManager {
  buildSystemPrompt(opts: BuildSystemPromptOpts): Promise<string>;
  compressIfNeeded(ctx: CompressContext): Promise<CompressionResult>;
  extractEntities(text: string): Promise<ExtractedEntity[]>;
  summarize(messages: ChatMessage[], opts?: SummarizeOpts): Promise<string>;
  truncateToContext(messages: ChatMessage[], contextWindow: number): ChatMessage[];
  estimateTokens(text: string): number;
  estimateMessagesTokens(messages: ChatMessage[]): number;
}

export interface BuildSystemPromptOpts {
  agentSystemPrompt?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  userMessage: string;
  previousContextSummary?: string;
  relevantMemories?: { fact: string; importance: number; score: number }[];
  availableTools?: { name: string; description: string }[];
  variables?: Record<string, unknown>;
}

export interface CompressContext {
  sessionId: string;
  userId?: string;
  messages: ChatMessage[];
  contextWindow: number;
  thresholdPercent?: number; // default 80
}

export interface CompressionResult {
  compressed: boolean;
  newMessages: ChatMessage[];
  summaryCreated?: string;
  tokensSaved: number;
  strategy: 'rolling' | 'semantic' | 'extractive' | 'none';
}

export interface ExtractedEntity {
  type: string;
  value: string;
  canonical?: string;
  confidence: number;
}

export interface SummarizeOpts {
  maxLength?: number;
  focus?: string;
  style?: 'concise' | 'detailed' | 'bullet';
}

export interface ContextEnrichment {
  systemPrompt: string;
  relevantMemories: { fact: string; importance: number; score: number }[];
  entities: ExtractedEntity[];
}
