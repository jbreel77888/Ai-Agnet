/**
 * Agent Orchestrator — manages sessions, routes messages to agents
 *
 * Flow:
 * 1. User creates a session with an agent
 * 2. User sends a message
 * 3. Orchestrator loads conversation history
 * 4. Passes to agent.execute()
 * 5. Streams events back to the client
 * 6. Saves the response to DB
 */
import { db } from '../../db/client';
import { agentSessions, messages, models } from '../../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { getAgentRegistry } from '../registry';
import type { AgentEvent, AgentContext, ChatMessage } from '../../types';

export interface CreateSessionOpts {
  agentSlug: string;
  userId: string;
  title?: string;
  modelId?: string;
}

export interface SessionInfo {
  id: string;
  agentId: string;
  agentSlug: string;
  agentName: string;
  title: string;
  status: string;
  totalTokens: number;
  totalCost: string;
  startedAt: Date;
  lastActivityAt: Date;
  messageCount: number;
}

export interface SendMessageOpts {
  userId: string;
  content: string;
  modelId?: string;
}

class AgentOrchestratorImpl {
  async createSession(opts: CreateSessionOpts): Promise<{ sessionId: string; agentName: string }> {
    const registry = getAgentRegistry();
    await registry.loadFromDB();

    const agent = registry.get(opts.agentSlug);
    if (!agent) throw new Error(`Agent "${opts.agentSlug}" not found`);

    const [session] = await db.insert(agentSessions).values({
      userId: opts.userId,
      agentId: agent.id,
      title: opts.title || `Chat with ${agent.slug}`,
      status: 'active',
      totalTokens: 0,
      totalCost: '0',
    }).returning();

    return { sessionId: session.id, agentName: agent.slug };
  }

  async listSessions(userId: string): Promise<SessionInfo[]> {
    const sessions = await db.select({
      session: agentSessions,
    })
    .from(agentSessions)
    .where(eq(agentSessions.userId, userId))
    .orderBy(desc(agentSessions.lastActivityAt));

    const result: SessionInfo[] = [];
    for (const { session } of sessions) {
      const msgCount = await db.select({ count: db })
        .from(messages)
        .where(eq(messages.sessionId, session.id));

      // Get agent info
      const registry = getAgentRegistry();
      const agent = registry.list().find(a => a.id === session.agentId);

      result.push({
        id: session.id,
        agentId: session.agentId,
        agentSlug: agent?.slug || 'unknown',
        agentName: agent?.slug || 'Unknown',
        title: session.title || 'Untitled',
        status: session.status,
        totalTokens: session.totalTokens,
        totalCost: session.totalCost,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        messageCount: 0, // Would need a count query
      });
    }
    return result;
  }

  async getSession(sessionId: string, userId: string): Promise<SessionInfo | null> {
    const [session] = await db.select()
      .from(agentSessions)
      .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
      .limit(1);
    if (!session) return null;

    const registry = getAgentRegistry();
    const agent = registry.list().find(a => a.id === session.agentId);

    return {
      id: session.id,
      agentId: session.agentId,
      agentSlug: agent?.slug || 'unknown',
      agentName: agent?.slug || 'Unknown',
      title: session.title || 'Untitled',
      status: session.status,
      totalTokens: session.totalTokens,
      totalCost: session.totalCost,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      messageCount: 0,
    };
  }

  async getMessages(sessionId: string, userId: string): Promise<any[]> {
    // Verify session belongs to user
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const msgs = await db.select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt);

    return msgs.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      modelId: m.modelId,
      tokensInput: m.tokensInput,
      tokensOutput: m.tokensOutput,
      cost: m.cost,
      latencyMs: m.latencyMs,
      createdAt: m.createdAt,
    }));
  }

  async *sendMessage(sessionId: string, opts: SendMessageOpts): AsyncIterable<AgentEvent | { type: 'message_saved'; messageId: string }> {
    const registry = getAgentRegistry();
    await registry.loadFromDB();

    // Load session
    const [session] = await db.select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Error('Session not found');

    const agent = registry.list().find(a => a.id === session.agentId);
    if (!agent) throw new Error('Agent not found');

    // Save user message
    await db.insert(messages).values({
      sessionId,
      role: 'user',
      content: opts.content,
      tokensInput: 0,
      tokensOutput: 0,
      cost: '0',
      latencyMs: 0,
    });

    // Update session activity
    await db.update(agentSessions).set({
      lastActivityAt: new Date(),
    }).where(eq(agentSessions.id, sessionId));

    // Load conversation history
    const history = await db.select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt)
      .limit(50);

    const chatMessages: ChatMessage[] = history.map(m => ({
      role: m.role as any,
      content: m.content || '',
    }));

    // Build agent context
    const ctx: AgentContext = {
      sessionId,
      userId: opts.userId,
      messages: chatMessages,
      variables: new Map(),
      artifacts: [],
      currentAgentId: agent.id,
      handoffHistory: [],
      stepNumber: 0,
      budget: { tokensRemaining: 100000, costRemainingUsd: 10, stepsRemaining: 20 },
      services: {},
    };

    // Execute agent
    let fullContent = '';
    let tokensUsed = 0;
    let cost = 0;

    for await (const event of agent.execute({ task: opts.content }, ctx)) {
      if (event.type === 'message_chunk') {
        fullContent += event.content;
      }
      if (event.type === 'completed') {
        tokensUsed = event.tokensUsed;
        cost = event.cost;
      }
      yield event;
    }

    // Save assistant response
    const [savedMsg] = await db.insert(messages).values({
      sessionId,
      role: 'assistant',
      content: fullContent,
      modelId: opts.modelId || null,
      tokensInput: Math.floor(tokensUsed * 0.3),
      tokensOutput: Math.floor(tokensUsed * 0.7),
      cost: cost.toFixed(6),
      latencyMs: 0,
      finishReason: 'stop',
    }).returning();

    // Update session totals
    await db.update(agentSessions).set({
      totalTokens: session.totalTokens + tokensUsed,
      totalCost: (parseFloat(session.totalCost) + cost).toFixed(4),
      lastActivityAt: new Date(),
    }).where(eq(agentSessions.id, sessionId));

    yield { type: 'message_saved', messageId: savedMsg.id };
  }

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    // Verify ownership
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');

    await db.delete(agentSessions).where(eq(agentSessions.id, sessionId));
  }
}

let instance: AgentOrchestratorImpl | null = null;
export function getAgentOrchestrator(): AgentOrchestratorImpl {
  if (!instance) instance = new AgentOrchestratorImpl();
  return instance;
}
