/**
 * /api/sessions/[id]/workspace
 * ─────────────────────────────────────────────────────────────────────────────
 * Aggregates everything related to a session in one payload, for the
 * "Workspace" side panel:
 *
 *   - files           → session-scoped uploads (storage_objects with this sessionId)
 *   - artifacts       → rows from the `artifacts` table for this session
 *   - toolCalls       → recent tool_calls rows for this session
 *   - messages        → recent messages (id, role, createdAt, preview, tokens)
 *   - environment     → agent info, model info, provider info, plan mode, etc.
 *   - sandbox         → sandbox / runtime info: env vars (filtered), runtime,
 *                       storage path, scheduler jobs related to the session
 *
 * The data shape is intentionally flat so the WorkspacePanel can render
 * each tab independently.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../../db/client';
import {
  agentSessions, messages, artifacts, toolCalls,
  agents, models, providers,
} from '../../../../../db/schema';
import { eq, sql, desc } from 'drizzle-orm';
import { createJWTService } from '../../../../../auth/jwt';
import { getAgentOrchestrator } from '../../../../../agents/orchestrator';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwt = createJWTService();
    return await jwt.verifyAccessToken(authHeader.slice(7));
  } catch { return null; }
}

function preview(content: string | null | undefined, max = 200): string {
  if (!content) return '';
  const s = content.trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function safeJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  const { id: sessionId } = await params;
  const orchestrator = getAgentOrchestrator();
  const session = await orchestrator.getSession(sessionId, user.sub);
  if (!session) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, { status: 404 });

  try {
    // ── 1. Files (storage_objects scoped to this session) ────────────────────
    const fileQuery = await db.execute(sql`
      SELECT key, content_type, size_bytes, is_public, created_at, metadata
      FROM storage_objects
      WHERE metadata->>'sessionId' = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 200
    `).catch(() => ({ rows: [] as any[] }));

    const files = (fileQuery.rows || []).map((r: any) => ({
      key: r.key,
      name: (r.key as string).split('/').pop() || r.key,
      contentType: r.content_type,
      sizeBytes: Number(r.size_bytes || 0),
      isPublic: r.is_public,
      createdAt: r.created_at,
      originalName: r.metadata?.originalName || (r.key as string).split('/').pop(),
      source: r.metadata?.source || 'unknown',
    }));

    // ── 2. Artifacts (artifacts table) ───────────────────────────────────────
    const artifactRows = await db.select()
      .from(artifacts)
      .where(eq(artifacts.sessionId, sessionId))
      .orderBy(desc(artifacts.createdAt))
      .limit(100)
      .catch(() => []);

    const artifactList = artifactRows.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type,
      storageKey: a.storageKey,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt,
      metadata: a.metadata,
    }));

    // ── 3. Tool calls ────────────────────────────────────────────────────────
    const toolCallRows = await db.select()
      .from(toolCalls)
      .where(eq(toolCalls.sessionId, sessionId))
      .orderBy(desc(toolCalls.startedAt))
      .limit(200)
      .catch(() => []);

    const toolCallList = toolCallRows.map(tc => ({
      id: tc.id,
      toolName: tc.toolName,
      arguments: safeJson(tc.arguments),
      result: safeJson(tc.result),
      status: tc.status,
      error: tc.error,
      startedAt: tc.startedAt,
      completedAt: tc.completedAt,
      durationMs: tc.durationMs,
    }));

    // ── 4. Recent messages (preview only) ────────────────────────────────────
    const msgRows = await db.select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(desc(messages.createdAt))
      .limit(50)
      .catch(() => []);

    const messageList = msgRows.map(m => ({
      id: m.id,
      role: m.role,
      preview: preview(m.content, 160),
      tokensInput: m.tokensInput,
      tokensOutput: m.tokensOutput,
      cost: m.cost,
      latencyMs: m.latencyMs,
      createdAt: m.createdAt,
      finishReason: m.finishReason,
      toolCallCount: Array.isArray(m.toolCalls) ? (m.toolCalls as any[]).length : 0,
    }));

    // ── 5. Environment: agent + model + provider + runtime ───────────────────
    let agentInfo: any = null;
    let modelInfo: any = null;
    let providerInfo: any = null;

    try {
      const [agentRow] = await db.select()
        .from(agents)
        .where(eq(agents.id, session.agentId))
        .limit(1);
      if (agentRow) {
        agentInfo = {
          id: agentRow.id,
          name: agentRow.name,
          slug: agentRow.slug,
          type: agentRow.type,
          description: agentRow.description,
          temperature: agentRow.temperature,
          maxTokens: agentRow.maxTokens,
          topP: agentRow.topP,
          systemPrompt: agentRow.systemPrompt,
        };
      }
    } catch (e: any) {
      console.warn('[workspace] agent info failed:', e.message);
    }

    // Try to find the most recent assistant message's model
    try {
      const lastAssistant = msgRows.find(m => m.role === 'assistant' && m.modelId);
      if (lastAssistant?.modelId) {
        const [mRow] = await db.select()
          .from(models)
          .where(eq(models.id, lastAssistant.modelId!))
          .limit(1);
        if (mRow) {
          modelInfo = {
            id: mRow.id,
            name: mRow.name,
            displayName: mRow.displayName,
            contextWindow: mRow.contextWindow,
            maxOutputTokens: mRow.maxOutputTokens,
            supportsTools: mRow.supportsTools,
            supportsVision: mRow.supportsVision,
            supportsStreaming: mRow.supportsStreaming,
            supportsThinking: mRow.supportsThinking,
            supportsJsonMode: mRow.supportsJsonMode,
            status: mRow.status,
            inputPricePer1k: mRow.inputPricePer1k,
            outputPricePer1k: mRow.outputPricePer1k,
          };
          const [pRow] = await db.select()
            .from(providers)
            .where(eq(providers.id, mRow.providerId))
            .limit(1);
          if (pRow) {
            providerInfo = {
              id: pRow.id,
              name: pRow.name,
              slug: pRow.slug,
              type: pRow.type,
              baseUrl: pRow.baseUrl,
              status: pRow.status,
              healthStatus: pRow.healthStatus,
            };
          }
        }
      }
    } catch (e: any) {
      console.warn('[workspace] model info failed:', e.message);
    }

    // ── 6. Sandbox / runtime state ────────────────────────────────────────────
    const sandbox = {
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        uptime: process.uptime(),
      },
      storage: {
        driver: 'local-filesystem',
        basePath: process.env.STORAGE_LOCAL_PATH || './storage',
        filesCount: files.length,
      },
      session: {
        id: sessionId,
        status: session.status,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        totalTokens: session.totalTokens,
        totalCost: session.totalCost,
        messageCount: messageList.length,
      },
      environment: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        DATABASE_URL_set: !!process.env.DATABASE_URL,
        REDIS_URL_set: !!process.env.REDIS_URL,
        OPENAI_API_KEY_set: !!process.env.OPENAI_API_KEY,
      },
      sandbox: {
        // Reserved for future sandboxed execution; currently "none" because we
        // don't spin up an isolated container per session.
        type: 'none',
        isolated: false,
        networkAccess: true,
        filesystemAccess: 'session-scoped',
      },
      integrations: {
        github: !!process.env.GITHUB_TOKEN,
        slack: !!process.env.SLACK_BOT_TOKEN,
        notion: !!process.env.NOTION_API_KEY,
        email: !!(process.env.SMTP_HOST || process.env.EMAIL_API_KEY),
      },
    };

    // ── Final payload ─────────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      data: {
        sessionId,
        session: {
          id: sessionId,
          title: session.title,
          status: session.status,
          startedAt: session.startedAt,
          lastActivityAt: session.lastActivityAt,
          totalTokens: session.totalTokens,
          totalCost: session.totalCost,
          agentSlug: session.agentSlug,
          agentName: session.agentName,
        },
        files,
        artifacts: artifactList,
        toolCalls: toolCallList,
        messages: messageList,
        environment: {
          agent: agentInfo,
          model: modelInfo,
          provider: providerInfo,
        },
        sandbox,
      },
    });
  } catch (err: any) {
    console.error('[workspace] error:', err);
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}
