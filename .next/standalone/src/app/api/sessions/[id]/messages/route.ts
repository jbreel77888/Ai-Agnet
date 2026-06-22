/**
 * POST /api/sessions/[id]/messages — Send a message and get streaming response
 *
 * Body: { content: string, modelId?: string }
 * Returns: SSE stream of AgentEvent chunks
 *
 * Rate limited: 30 messages per minute per user.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAgentOrchestrator } from '../../../../../agents/orchestrator';
import { createJWTService } from '../../../../../auth/jwt';
import { checkChatRateLimit } from '../../../../../lib/rate-limit';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    return await jwtService.verifyAccessToken(authHeader.slice(7));
  } catch { return null; }
}

const sendSchema = z.object({
  content: z.string().min(1).max(10000, 'Message too long (max 10000 chars)'),
  modelId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  // ── Rate limit: 30 messages per minute per user ───────────────────────
  const rl = checkChatRateLimit(user.sub);
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: { code: 'RATE_LIMITED', message: `Too many messages. Try again in ${rl.retryAfterSec}s.` } },
      {
        status: 429,
        headers: {
          'Retry-After': String(rl.retryAfterSec),
          'X-RateLimit-Limit': '30',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rl.resetAtMs / 1000)),
        },
      }
    );
  }

  const { id: sessionId } = await params;

  try {
    const body = await req.json();
    const parsed = sendSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } }, { status: 400 });

    const orchestrator = getAgentOrchestrator();

    // Verify session exists and belongs to user
    const session = await orchestrator.getSession(sessionId, user.sub);
    if (!session) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, { status: 404 });

    // Stream the response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const eventStream = orchestrator.sendMessage(sessionId, {
            userId: user.sub,
            content: parsed.data.content,
            modelId: parsed.data.modelId,
          });

          for await (const event of eventStream) {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err: any) {
          const errorData = `data: ${JSON.stringify({ type: 'error', error: { code: 'STREAM_ERROR', message: err.message } })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}
