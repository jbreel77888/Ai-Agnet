/**
 * Integrated Agent Engine — connects LangGraph StateGraph with
 * the BaseAgent, Tool Registry, and Orchestrator
 */

import { StateGraph, CompiledGraph, Channel, MemorySaver } from '../../workflows/stategraph';
import { getProviderManager } from '../../providers/manager';
import { getToolRegistry } from '../../tools/registry';
import { registerBuiltinTools } from '../../tools/builtin';
import { getLongTermMemory } from '../../memory/long-term';
import type { ChatMessage, ToolDefinition, AgentEvent } from '../../types';

interface AgentGraphState {
  messages: ChatMessage[];
  userQuery: string;
  systemPrompt: string;
  modelId: string;
  agentId: string;
  userId: string;
  sessionId: string;
  tools: ToolDefinition[];
  toolResults: Array<{ tool: string; args: any; result: any; durationMs: number }>;
  finalResponse: string;
  tokensUsed: number;
  stepCount: number;
  thinking: string[];
  error?: string;
}

export function buildAgentGraph(agentConfig: {
  systemPrompt: string; modelId: string; agentId: string; userId: string; sessionId: string;
  temperature: number; maxTokens: number;
}): CompiledGraph<AgentGraphState> {
  try { await registerBuiltinTools(); } catch {}
  const registry = getToolRegistry();
  const toolDefs = registry.toOpenAITools();

  const graph = new StateGraph<AgentGraphState>([
    Channel.append<ChatMessage>('messages'), Channel.last('userQuery'), Channel.last('systemPrompt'),
    Channel.last('modelId'), Channel.last('agentId'), Channel.last('userId'), Channel.last('sessionId'),
    Channel.append('toolResults'), Channel.last('finalResponse'), Channel.sum('tokensUsed'),
    Channel.sum('stepCount'), Channel.append<string>('thinking'), Channel.last('error'),
  ]);

  graph.addNode('enrich_context', async (state) => {
    const thinking = [...(state.thinking || []), 'Retrieving relevant memories...'];
    try {
      const memory = getLongTermMemory();
      const results = await memory.search({ text: state.userQuery, userId: state.userId, topK: 3, minScore: 0.2 });
      if (results.length > 0) {
        thinking.push(`Found ${results.length} relevant memories`);
        return { thinking, systemPrompt: state.systemPrompt + '\n\n## Relevant Memories\n' + results.map(r => `- ${r.record.fact}`).join('\n') };
      }
      return { thinking };
    } catch { return { thinking }; }
  });

  graph.addNode('call_llm', async (state) => {
    const thinking = [...(state.thinking || []), 'Calling LLM...'];
    const providerManager = getProviderManager();
    try {
      const response = await providerManager.chat({
        modelId: state.modelId, messages: state.messages, systemPrompt: state.systemPrompt,
        temperature: agentConfig.temperature, maxTokens: agentConfig.maxTokens, tools: state.tools,
      }, { userId: state.userId, sessionId: state.sessionId, agentId: state.agentId });
      thinking.push(`LLM responded (${response.usage.totalTokens} tokens)`);
      if (response.toolCalls && response.toolCalls.length > 0) {
        thinking.push(`LLM requested ${response.toolCalls.length} tool calls`);
        return { thinking, finalResponse: response.content, tokensUsed: response.usage.totalTokens,
          messages: [...state.messages, { role: 'assistant', content: response.content, toolCalls: response.toolCalls } as any], error: 'has_tools' };
      }
      thinking.push('LLM response complete');
      return { thinking, finalResponse: response.content, tokensUsed: response.usage.totalTokens,
        messages: [...state.messages, { role: 'assistant', content: response.content } as any], error: 'no_tools' };
    } catch (err: any) {
      thinking.push(`LLM error: ${err.message}`);
      return { thinking, error: 'llm_error', finalResponse: `Error: ${err.message}` };
    }
  });

  graph.addNode('execute_tools', async (state) => {
    const thinking = [...(state.thinking || []), 'Executing tools...'];
    const lastMsg = state.messages[state.messages.length - 1];
    const toolCalls = lastMsg?.toolCalls || [];
    const registry = getToolRegistry();
    const toolResults: any[] = [];
    const newMessages: ChatMessage[] = [];
    for (const tc of toolCalls) {
      thinking.push(`Running ${tc.name}...`);
      const result = await registry.execute(tc.name, tc.arguments, { userId: state.userId, sessionId: state.sessionId, agentId: state.agentId, permissions: [], rateLimiterKey: state.userId, traceId: `${state.sessionId}-${Date.now()}` } as any);
      toolResults.push({ tool: tc.name, args: tc.arguments, result: result.data || result.error, durationMs: result.metadata?.durationMs || 0 });
      newMessages.push({ role: 'tool', content: JSON.stringify(result.data || result.error), toolCallId: tc.id } as any);
    }
    thinking.push(`All ${toolCalls.length} tools completed`);
    const toolSummary = toolResults.map(r => `Tool "${r.tool}" result: ${JSON.stringify(r.result).substring(0, 1000)}`).join('\n\n');
    newMessages.push({ role: 'user', content: `I executed the tools. Results:\n\n${toolSummary}\n\nPlease answer my original question.` });
    return { thinking, toolResults, messages: [...state.messages, ...newMessages], stepCount: 1, error: undefined };
  });

  graph.addNode('finalize', async (state) => {
    const thinking = [...(state.thinking || []), 'Finalizing...'];
    if (state.toolResults?.length > 0 && state.stepCount > 0) {
      thinking.push('Generating follow-up...');
      const providerManager = getProviderManager();
      try {
        const response = await providerManager.chat({
          modelId: state.modelId, messages: state.messages, systemPrompt: state.systemPrompt,
          temperature: agentConfig.temperature, maxTokens: agentConfig.maxTokens,
        }, { userId: state.userId, sessionId: state.sessionId, agentId: state.agentId });
        thinking.push('Follow-up complete');
        return { thinking, finalResponse: response.content, tokensUsed: response.usage.totalTokens,
          messages: [...state.messages, { role: 'assistant', content: response.content } as any] };
      } catch (err: any) { thinking.push(`Follow-up error: ${err.message}`); return { thinking, error: err.message }; }
    }
    return { thinking };
  });

  graph.setEntryPoint('enrich_context');
  graph.addEdge('enrich_context', 'call_llm');
  graph.addConditionalEdges('call_llm', (state) => state.error === 'has_tools' ? 'execute_tools' : 'finalize',
    { 'execute_tools': 'execute_tools', 'finalize': 'finalize' });
  graph.addEdge('execute_tools', 'finalize');
  graph.setFinishPoint('finalize');
  return graph.compile({ checkpointer: new MemorySaver<AgentGraphState>() });
}

export async function* executeAgentGraph(graph: CompiledGraph<AgentGraphState>, input: {
  userQuery: string; systemPrompt: string; modelId: string; agentId: string; userId: string; sessionId: string; messages: ChatMessage[];
}): AsyncIterable<AgentEvent> {
  try { await registerBuiltinTools(); } catch {}
  const registry = getToolRegistry();
  const tools = registry.toOpenAITools();
  const initialState: Partial<AgentGraphState> = {
    messages: input.messages, userQuery: input.userQuery, systemPrompt: input.systemPrompt,
    modelId: input.modelId, agentId: input.agentId, userId: input.userId, sessionId: input.sessionId,
    tools, toolResults: [], finalResponse: '', tokensUsed: 0, stepCount: 0, thinking: [],
  };
  yield { type: 'started', agentId: input.agentId, input: { task: input.userQuery } };
  for await (const event of graph.stream(initialState, { threadId: `${input.sessionId}-${Date.now()}`, userId: input.userId, recursionLimit: 15 })) {
    if (event.type === 'node_start' && event.state?.thinking?.length) {
      yield { type: 'thinking', content: event.state.thinking[event.state.thinking.length - 1] };
    }
    if (event.type === 'node_update') {
      if (event.update?.toolResults) {
        for (const tr of event.update.toolResults) {
          yield { type: 'tool_call', toolName: tr.tool, args: tr.args, toolCallId: `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` };
          yield { type: 'tool_result', toolName: tr.tool, result: tr.result, durationMs: tr.durationMs };
        }
      }
      if (event.update?.finalResponse) yield { type: 'message_chunk', content: event.update.finalResponse };
    }
    if (event.type === 'error') yield { type: 'error', error: { code: 'GRAPH_ERROR', message: event.error.message, retryable: false }, recoverable: false };
    if (event.type === 'end') {
      yield { type: 'completed', output: { content: event.state.finalResponse || '', metadata: { tokensUsed: event.state.tokensUsed, cost: 0, durationMs: 0, stepsCompleted: event.state.stepCount } }, tokensUsed: event.state.tokensUsed, cost: 0 };
    }
  }
}
