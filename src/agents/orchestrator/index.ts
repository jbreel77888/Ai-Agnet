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
import { db, dbPool } from '../../db/client';
import { agentSessions, messages, models } from '../../db/schema';
import { eq, desc, and, sql } from 'drizzle-orm';
import { getAgentRegistry } from '../registry';
import type { AgentEvent, AgentContext, ChatMessage } from '../../types';

/**
 * Get a fresh pg Pool using the correct DATABASE_URL
 * In production (Railway), use the env var directly (set by Railway)
 * In development, use the embedded PG URL
 */
async function getPoolClient() {
  const { Pool } = require('pg');
  // In production, DATABASE_URL is set by Railway and should point to Railway Postgres
  // In development, it's set by instrumentation to localhost:5433
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not set');
  }
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  return pool;
}

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
    const pool = await getPoolClient();
    try {
      const result = await pool.query(
        `SELECT * FROM agent_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`,
        [sessionId, userId]
      );
      if (result.rows.length === 0) return null;
      const session = result.rows[0];
      const registry = getAgentRegistry();
      const agent = registry.list().find(a => a.id === session.agent_id);
      return {
        id: session.id,
        agentId: session.agent_id,
        agentSlug: agent?.slug || 'unknown',
        agentName: agent?.slug || 'Unknown',
        title: session.title || 'Untitled',
        status: session.status,
        totalTokens: session.total_tokens || 0,
        totalCost: session.total_cost || '0',
        startedAt: session.started_at,
        lastActivityAt: session.last_activity_at,
        messageCount: 0,
      };
    } finally {
      await pool.end();
    }
  }

  async getMessages(sessionId: string, userId: string): Promise<any[]> {
    const session = await this.getSession(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const pool = await getPoolClient();
    try {
      const result = await pool.query(
        `SELECT * FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId]
      );
      return result.rows.map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        modelId: m.model_id,
        tokensInput: m.tokens_input,
        tokensOutput: m.tokens_output,
        cost: m.cost,
        latencyMs: m.latency_ms,
        createdAt: m.created_at,
      }));
    } finally {
      await pool.end();
    }
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

    // Save user message — use fresh pg pool for maximum compatibility
    const pool = await getPoolClient();
    try {
      await pool.query(
        `INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2)`,
        [sessionId, opts.content]
      );
    } finally {
      await pool.end();
    }

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

    // Save assistant response — use fresh pg pool
    const pool2 = await getPoolClient();
    let savedMsgId = 'unknown';
    try {
      const result = await pool2.query(
        `INSERT INTO messages (session_id, role, content, model_id, tokens_input, tokens_output, cost, finish_reason) VALUES ($1, 'assistant', $2, $3, $4, $5, $6, 'stop') RETURNING id`,
        [sessionId, fullContent, opts.modelId || null, Math.floor(tokensUsed * 0.3), Math.floor(tokensUsed * 0.7), cost.toFixed(6)]
      );
      savedMsgId = result.rows[0]?.id || 'unknown';

      await pool2.query(
        `UPDATE agent_sessions SET total_tokens = total_tokens + $1, total_cost = total_cost + $2, last_activity_at = NOW() WHERE id = $3`,
        [tokensUsed, cost.toFixed(6), sessionId]
      );
    } finally {
      await pool2.end();
    }

    yield { type: 'message_saved', messageId: savedMsgId };
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
