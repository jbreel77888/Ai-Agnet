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

      // ── Build initial message history ─────────────────────────────────────
      // Keep last 20 messages from context to avoid blowing context window.
      // The user's task is already in ctx.messages (the orchestrator pushed it).
      const messages: ChatMessage[] = [];
      if (ctx.messages && ctx.messages.length > 0) {
        messages.push(...ctx.messages.slice(-20));
      }
      // Ensure the user's task is the last user message
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== input.task) {
        messages.push({ role: 'user', content: input.task });
      }

      const providerManager = getProviderManager();

      // ── Get available tools ───────────────────────────────────────────────
      let toolDefs: ToolDefinition[] | undefined;
      try {
        const { registerBuiltinTools } = await import('../../tools/builtin');
        await registerBuiltinTools(); // idempotent
        const registry = getToolRegistry();
        toolDefs = registry.toOpenAITools();
      } catch {}

      // ── ReAct Loop ────────────────────────────────────────────────────────
      // Reasoning + Acting loop: keep calling LLM → execute tool calls → feed
      // results back → repeat. Stop when:
      //   1. LLM returns no tool calls (final answer)
      //   2. maxStepsPerRun reached (default 20)
      //   3. cancellation requested
      //   4. error
      const maxSteps = this.config.maxStepsPerRun || 20;
      let step = 0;
      let fullContent = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      while (step < maxSteps && !this.cancelled) {
        step++;
        if (step > 1) {
          // Emit a thinking marker for steps after the first
          yield { type: 'thinking', content: `Step ${step}: continuing after tool execution...` };
        }

        // ── 1. LLM call (stream) ──────────────────────────────────────────
        // On step 1 we stream (so user sees partial response). On follow-up
        // steps (after tool results), we also stream for live feedback.
        let stepContent = '';
        const toolCallAccumulator = new Map<number, { id: string; name: string; argumentsStr: string }>();

        try {
          const stream = providerManager.chatStream({
            modelId,
            messages,
            systemPrompt: this.config.systemPrompt,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            topP: this.config.topP,
            tools: toolDefs,
          }, { userId: ctx.userId, sessionId: ctx.sessionId, agentId: this.id });

          for await (const chunk of stream) {
            if (this.cancelled) { yield { type: 'cancelled', reason: 'User cancelled' }; return; }
            if (chunk.delta?.content) {
              stepContent += chunk.delta.content;
              fullContent += chunk.delta.content;
              yield { type: 'message_chunk', content: chunk.delta.content };
            }
            if (chunk.delta?.toolCalls) {
              for (const tc of chunk.delta.toolCalls as any[]) {
                const idx = (tc as any).index ?? 0;
                const existing = toolCallAccumulator.get(idx) || { id: '', name: '', argumentsStr: '' };
                if (tc.id) existing.id = tc.id;
                if (tc.name) existing.name = tc.name;
                if (tc.arguments !== undefined) {
                  const argStr = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments);
                  existing.argumentsStr += argStr;
                }
                toolCallAccumulator.set(idx, existing);
              }
            }
            if (chunk.usage) {
              totalInputTokens = chunk.usage.inputTokens;
              totalOutputTokens = chunk.usage.outputTokens;
            }
          }
        } catch (streamErr: any) {
          // Stream failed — fall back to non-stream for this step
          console.warn(`[agent:${this.slug}] Step ${step} stream failed, trying non-stream:`, streamErr.message);
          try {
            const response = await providerManager.chat({
              modelId, messages,
              systemPrompt: this.config.systemPrompt,
              temperature: this.config.temperature,
              maxTokens: this.config.maxTokens,
              topP: this.config.topP,
              tools: toolDefs,
            }, { userId: ctx.userId, sessionId: ctx.sessionId, agentId: this.id });
            stepContent = response.content;
            fullContent += response.content;
            if (response.content) yield { type: 'message_chunk', content: response.content };
            totalInputTokens += response.usage.inputTokens;
            totalOutputTokens += response.usage.outputTokens;
            if (response.toolCalls) {
              response.toolCalls.forEach((tc, i) => {
                toolCallAccumulator.set(i, {
                  id: tc.id,
                  name: tc.name,
                  argumentsStr: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
                });
              });
            }
          } catch (fallbackErr: any) {
            // Both stream and fallback failed — if this is step 1, surface the error.
            // If later step, emit a partial error event but keep going.
            if (step === 1) throw fallbackErr;
            yield { type: 'thinking', content: `Step ${step}: LLM error — ${fallbackErr.message}. Stopping.` };
            break;
          }
        }

        // ── 2. Parse tool calls (if any) ──────────────────────────────────
        let toolCalls: ToolCall[] | undefined;
        if (toolCallAccumulator.size > 0) {
          toolCalls = Array.from(toolCallAccumulator.values())
            .filter(tc => tc.name) // Filter out unnamed fragments
            .map(tc => {
              let args: any = {};
              if (tc.argumentsStr) {
                try { args = JSON.parse(tc.argumentsStr); } catch { args = {}; }
              }
              return {
                id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: tc.name,
                arguments: args,
              };
            });
          if (toolCalls.length === 0) toolCalls = undefined;
        }

        // ── 3. No tool calls = final answer, end loop ─────────────────────
        if (!toolCalls || toolCalls.length === 0) {
          // Final answer received — break out of ReAct loop
          if (step > 1) {
            yield { type: 'thinking', content: `Step ${step}: final answer received after ${step - 1} tool execution round(s).` };
          }
          break;
        }

        // ── 4. Execute tool calls ─────────────────────────────────────────
        // Push the assistant message (with tool_calls) to message history
        // so the LLM sees its own request on the next iteration.
        messages.push({
          role: 'assistant',
          content: stepContent || '',
          toolCalls: toolCalls as any,
        } as ChatMessage);

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

          let result: any;
          let durationMs = 0;
          let isError = false;
          const toolStart = Date.now();
          try {
            const toolResult = await registry.execute(tc.name, tc.arguments, toolContext as any);
            result = toolResult.data ?? toolResult.error;
            isError = !toolResult.success;
            durationMs = toolResult.metadata?.durationMs || (Date.now() - toolStart);
          } catch (err: any) {
            result = { error: err.message };
            isError = true;
            durationMs = Date.now() - toolStart;
          }

          yield { type: 'tool_result', toolName: tc.name, result, durationMs } as any;

          // ── 5. Feed tool result back via proper role: 'tool' ──────────
          // Use the OpenAI-standard tool message (with tool_call_id) instead
          // of the previous user-message hack. The toOpenAIMessages() parser
          // in base.ts already handles this correctly.
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          // Truncate very long tool results to avoid blowing context window
          const truncated = resultStr.length > 4000
            ? resultStr.slice(0, 4000) + `\n... [truncated, full length ${resultStr.length}]`
            : resultStr;
          messages.push({
            role: 'tool',
            content: truncated,
            toolCallId: tc.id,
          } as any);
        }

        // Loop continues — LLM will be called again with the updated messages.
      }

      if (this.cancelled) { yield { type: 'cancelled', reason: 'User cancelled' }; return; }

      // ── Budget check (warn if exceeded) ───────────────────────────────
      if (step >= maxSteps) {
        yield { type: 'thinking', content: `Max steps (${maxSteps}) reached — stopping ReAct loop.` };
      }

      const durationMs = Date.now() - startTime;
      const tokensUsed = totalInputTokens + totalOutputTokens;
      this.metrics.successfulRuns++;
      this.metrics.totalTokensUsed += tokensUsed;
      this.metrics.averageDurationMs = (this.metrics.averageDurationMs * (this.metrics.successfulRuns - 1) + durationMs) / this.metrics.successfulRuns;

      const output: AgentOutput = {
        content: fullContent,
        toolCalls: undefined, // toolCalls were already streamed as events
        metadata: {
          tokensUsed,
          cost: 0,
          durationMs,
          stepsCompleted: step,
        },
      };
      yield { type: 'completed', output, tokensUsed, cost: 0 };
    } catch (err: any) {
      this.metrics.failedRuns++;
      yield {
        type: 'error',
        error: {
          code: err.code || 'AGENT_ERROR',
          message: err.message,
          retryable: !err.statusCode || err.statusCode >= 500,
        },
        recoverable: !err.statusCode || err.statusCode >= 500,
      };
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
