/**
 * POST /api/sessions/[id]/messages — Send a message and get streaming response
 *
 * Body: { content: string, modelId?: string }
 * Returns: SSE stream of AgentEvent chunks
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAgentOrchestrator } from '../../../../../agents/orchestrator';
import { createJWTService } from '../../../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    return await jwtService.verifyAccessToken(authHeader.slice(7));
  } catch { return null; }
}

const sendSchema = z.object({
  content: z.string().min(1),
  modelId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

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
