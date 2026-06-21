/**
 * Base Agent — implementation of IAgent that wraps LLM calls
 */
import { db } from '../../db/client';
import { agents, agentTools, tools, models, providers } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { getProviderManager } from '../../providers/manager';
import { getToolRegistry } from '../../tools/registry';
import type {
  IAgent, AgentConfig, AgentInput, AgentOutput, AgentEvent,
  AgentContext, AgentType, HandoffPayload, AgentMetrics, HealthStatus,
  ChatMessage, ToolDefinition, ToolCall,
} from '../../types';

export interface BaseAgentConfig {
  id: string;
  slug: string;
  type: AgentType;
  systemPrompt: string;
  defaultModelId?: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  enabled: boolean;
  canSpawnSubagents: boolean;
  maxSubagents: number;
  handoffTargets: string[];
}

export class BaseAgent implements IAgent {
  readonly id: string;
  readonly slug: string;
  readonly type: AgentType;
  readonly config: AgentConfig;
  private metrics: AgentMetrics = {
    totalRuns: 0, successfulRuns: 0, failedRuns: 0,
    averageDurationMs: 0, totalTokensUsed: 0, totalCostUsd: 0,
    activeSubAgents: 0,
  };
  private cancelled = false;
  private subAgents: IAgent[] = [];

  constructor(config: BaseAgentConfig) {
    this.id = config.id;
    this.slug = config.slug;
    this.type = config.type;
    this.config = {
      defaultModelId: config.defaultModelId || '',
      fallbackModelIds: [],
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      topP: config.topP,
      systemPrompt: config.systemPrompt,
      allowedTools: [],
      deniedTools: [],
      maxStepsPerRun: 20,
      maxRetries: 2,
      canSpawnSubagents: config.canSpawnSubagents,
      maxSubagents: config.maxSubagents,
      handoffTargets: config.handoffTargets,
      requireApprovalForTools: [],
      sandboxed: false,
      timeoutMs: 60000,
      retryStrategy: 'exponential',
      logLevel: 'info',
      traceEnabled: true,
    };
  }

  async initialize(_ctx: AgentContext): Promise<void> {}
  async shutdown(): Promise<void> { this.cancelled = true; for (const s of this.subAgents) await s.cancel(); this.subAgents = []; }
  async cancel(): Promise<void> { this.cancelled = true; }

  async *execute(input: AgentInput, ctx: AgentContext): AsyncIterable<AgentEvent> {
    const startTime = Date.now();
    this.cancelled = false;
    this.metrics.totalRuns++;
    yield { type: 'started', agentId: this.id, input };

    try {
      const modelId = await this.resolveModelId(ctx);
      if (!modelId) throw new Error('No model available — add a provider with models first');

      const messages: ChatMessage[] = [];
      if (ctx.messages && ctx.messages.length > 0) {
        messages.push(...ctx.messages.slice(-20));
      }
      messages.push({ role: 'user', content: input.task });

      const providerManager = getProviderManager();

      // Get available tools
      let toolDefs: ToolDefinition[] | undefined;
      try {
        const { registerBuiltinTools } = await import('../../tools/builtin');
        registerBuiltinTools(); // idempotent
        const registry = getToolRegistry();
        toolDefs = registry.toOpenAITools();
      } catch {}

      let fullContent = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let toolCalls: ToolCall[] | undefined;

      try {
        const stream = providerManager.chatStream({
          modelId, messages,
          systemPrompt: this.config.systemPrompt,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          topP: this.config.topP,
          tools: toolDefs,
        }, { userId: ctx.userId, sessionId: ctx.sessionId, agentId: this.id });

        for await (const chunk of stream) {
          if (this.cancelled) { yield { type: 'cancelled', reason: 'User cancelled' }; return; }
          if (chunk.delta?.content) { fullContent += chunk.delta.content; yield { type: 'message_chunk', content: chunk.delta.content }; }
          if (chunk.delta?.toolCalls) { toolCalls = (toolCalls || []).concat(chunk.delta.toolCalls as any); }
          if (chunk.usage) { totalInputTokens = chunk.usage.inputTokens; totalOutputTokens = chunk.usage.outputTokens; }
        }
      } catch (streamErr: any) {
        console.warn(`[agent:${this.slug}] Stream failed, trying non-stream:`, streamErr.message);
        const response = await providerManager.chat({
          modelId, messages,
          systemPrompt: this.config.systemPrompt,
          temperature: this.config.temperature,
          maxTokens: this.config.maxTokens,
          topP: this.config.topP,
        }, { userId: ctx.userId, sessionId: ctx.sessionId, agentId: this.id });
        fullContent = response.content;
        totalInputTokens = response.usage.inputTokens;
        totalOutputTokens = response.usage.outputTokens;
        toolCalls = response.toolCalls;
        yield { type: 'message_chunk', content: fullContent };
      }

      // Execute tool calls if any
      if (toolCalls && toolCalls.length > 0) {
        const registry = getToolRegistry();
        const toolContext = {
          userId: ctx.userId,
          sessionId: ctx.sessionId,
          agentId: this.id,
          permissions: [],
          rateLimiterKey: ctx.userId,
          traceId: crypto.randomUUID(),
        };

        for (const tc of toolCalls) {
          yield { type: 'tool_call', toolName: tc.name, args: tc.arguments, toolCallId: tc.id };
          const result = await registry.execute(tc.name, tc.arguments, toolContext as any);
          yield { type: 'tool_result', toolName: tc.name, result: result.data || result.error, durationMs: result.metadata?.durationMs || 0 };

          // Add tool result to messages for follow-up
          messages.push({
            role: 'assistant',
            content: fullContent,
            toolCalls: [tc],
          } as any);
          messages.push({
            role: 'tool',
            content: JSON.stringify(result.data || result.error),
            toolCallId: tc.id,
          } as any);
        }

        // Get follow-up response with tool results
        try {
          const followUp = await providerManager.chat({
            modelId, messages,
            systemPrompt: this.config.systemPrompt,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            topP: this.config.topP,
            tools: toolDefs,
          }, { userId: ctx.userId, sessionId: ctx.sessionId, agentId: this.id });

          fullContent += '\n\n' + followUp.content;
          totalInputTokens += followUp.usage.inputTokens;
          totalOutputTokens += followUp.usage.outputTokens;
          yield { type: 'message_chunk', content: '\n\n' + followUp.content };
        } catch (err: any) {
          console.warn(`[agent:${this.slug}] Follow-up failed:`, err.message);
        }
      }

      const durationMs = Date.now() - startTime;
      const tokensUsed = totalInputTokens + totalOutputTokens;
      this.metrics.successfulRuns++;
      this.metrics.totalTokensUsed += tokensUsed;
      this.metrics.averageDurationMs = (this.metrics.averageDurationMs * (this.metrics.successfulRuns - 1) + durationMs) / this.metrics.successfulRuns;

      const output: AgentOutput = { content: fullContent, toolCalls, metadata: { tokensUsed, cost: 0, durationMs, stepsCompleted: 1 } };
      yield { type: 'completed', output, tokensUsed, cost: 0 };
    } catch (err: any) {
      this.metrics.failedRuns++;
      yield { type: 'error', error: { code: err.code || 'AGENT_ERROR', message: err.message, retryable: !err.statusCode || err.statusCode >= 500 }, recoverable: !err.statusCode || err.statusCode >= 500 };
    }
  }

  private async resolveModelId(ctx: AgentContext): Promise<string | undefined> {
    if (this.config.defaultModelId) return this.config.defaultModelId;
    try {
      const allModels = await db.select({ model: models, provider: providers })
        .from(models).innerJoin(providers, eq(models.providerId, providers.id))
        .where(eq(models.status, 'active'));
      if (allModels.length === 0) return undefined;
      allModels.sort((a, b) => a.model.priority - b.model.priority);
      return allModels[0].model.id;
    } catch { return undefined; }
  }

  canHandle(_input: AgentInput): number { return 0.5; }
  async handoff(_target: string, _payload: HandoffPayload): Promise<void> {}
  async onHandoff(_payload: HandoffPayload): Promise<void> {}

  async spawnSubAgent(type: AgentType, config?: Partial<AgentConfig>): Promise<IAgent> {
    if (!this.config.canSpawnSubagents) throw new Error(`Agent ${this.slug} cannot spawn sub-agents`);
    if (this.subAgents.length >= this.config.maxSubagents) throw new Error(`Max sub-agents reached`);
    const sub = new BaseAgent({
      id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      slug: `sub-${type}`, type,
      systemPrompt: config?.systemPrompt || `You are a ${type} agent.`,
      temperature: config?.temperature ?? 0.5, maxTokens: config?.maxTokens ?? 2048,
      topP: config?.topP ?? 1, enabled: true, canSpawnSubagents: false, maxSubagents: 0, handoffTargets: [],
    });
    this.subAgents.push(sub);
    this.metrics.activeSubAgents = this.subAgents.length;
    return sub;
  }

  listSubAgents(): IAgent[] { return [...this.subAgents]; }
  getMetrics(): AgentMetrics { return { ...this.metrics }; }
  async healthCheck(): Promise<HealthStatus> {
    return { status: 'healthy', checks: [{ name: 'agent', status: 'healthy', details: { runs: this.metrics.totalRuns } }], timestamp: new Date(), uptime: process.uptime() };
  }
}
