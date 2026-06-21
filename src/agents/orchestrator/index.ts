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
import { agentSessions, messages, models, toolCalls as toolCallsTable } from '../../db/schema';
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
  const connectionString = process.env.DATABASE_URL;
  console.log('[orchestrator] DATABASE_URL:', connectionString?.substring(0, 50) + '...');
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
    const sessions = await db.select()
      .from(agentSessions)
      .where(eq(agentSessions.userId, userId))
      .orderBy(desc(agentSessions.lastActivityAt));

    const registry = getAgentRegistry();
    const result: SessionInfo[] = [];
    for (const session of sessions) {
      const agent = registry.list().find(a => a.id === session.agentId);
      // Count messages in this session using a fresh pool (Drizzle doesn't always
      // return correct results from aggregates on the embedded pg without it)
      let messageCount = 0;
      try {
        const pool = await getPoolClient();
        try {
          const r = await pool.query('SELECT COUNT(*)::int AS n FROM messages WHERE session_id = $1', [session.id]);
          messageCount = r.rows[0]?.n || 0;
        } finally { await pool.end(); }
      } catch {}
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
        messageCount,
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
      // Count messages
      let messageCount = 0;
      try {
        const r2 = await pool.query('SELECT COUNT(*)::int AS n FROM messages WHERE session_id = $1', [sessionId]);
        messageCount = r2.rows[0]?.n || 0;
      } catch {}
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
        messageCount,
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
    const client = await pool.connect();
    try {
      // Debug: check which database we're connected to
      const dbInfo = await client.query('SELECT current_database(), current_schema()');
      console.log('[orchestrator] Connected to DB:', dbInfo.rows[0]);

      const tableCheck = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='messages'");
      console.log('[orchestrator] messages table exists:', tableCheck.rows.length > 0);

      console.log('[orchestrator] Inserting user message, sessionId:', sessionId);
      await client.query(
        `INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2)`,
        [sessionId, opts.content]
      );
      console.log('[orchestrator] ✓ User message saved');
    } catch (err: any) {
      console.error('[orchestrator] Failed to save user message:', err.message, err.code);
      throw err;
    } finally {
      client.release();
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
    // Track tool calls so we can persist them after the assistant message is saved
    const collectedToolCalls: Array<{
      toolName: string;
      args: any;
      result: any;
      durationMs: number;
      status: 'success' | 'failed' | 'running';
      error?: string;
      startedAt: Date;
      completedAt?: Date;
    }> = [];

    for await (const event of agent.execute({ task: opts.content }, ctx)) {
      if (event.type === 'message_chunk') {
        fullContent += event.content;
      }
      if (event.type === 'completed') {
        tokensUsed = event.tokensUsed;
        cost = event.cost;
      }
      // Track tool calls for persistence
      if (event.type === 'tool_call') {
        collectedToolCalls.push({
          toolName: (event as any).toolName,
          args: (event as any).args,
          result: undefined,
          durationMs: 0,
          status: 'running',
          startedAt: new Date(),
        });
      }
      if (event.type === 'tool_result') {
        const lastRunning = [...collectedToolCalls].reverse().find(tc => tc.toolName === (event as any).toolName && tc.status === 'running');
        if (lastRunning) {
          lastRunning.result = (event as any).result;
          lastRunning.durationMs = (event as any).durationMs || 0;
          lastRunning.status = 'success';
          lastRunning.completedAt = new Date();
        }
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

      // Persist tool calls to the tool_calls table — so the Workspace panel has data
      for (const tc of collectedToolCalls) {
        try {
          const argsJson = tc.args ? JSON.stringify(tc.args) : null;
          const resultJson = tc.result !== undefined ? JSON.stringify(tc.result) : null;
          const status = tc.status === 'running' ? 'running' : (tc.status === 'success' ? 'success' : 'failed');
          await pool2.query(
            `INSERT INTO tool_calls (session_id, message_id, tool_name, arguments, result, status, started_at, completed_at, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [sessionId, savedMsgId, tc.toolName, argsJson, resultJson, status, tc.startedAt, tc.completedAt || new Date(), tc.durationMs]
          );
        } catch (tcErr: any) {
          console.warn('[orchestrator] Failed to save tool call:', tcErr.message);
        }
      }

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
