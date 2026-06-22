/**
 * POST /api/chat
 * Body: {
 *   modelId: string,
 *   messages: ChatMessage[],
 *   systemPrompt?: string,
 *   temperature?: number,
 *   maxTokens?: number,
 *   stream?: boolean
 * }
 *
 * Non-streaming: returns ChatResponse
 * Streaming: returns SSE stream of ChatChunks
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createJWTService } from '../../../auth/jwt';
import { getProviderManager } from '../../../providers/manager';
import type { ChatMessage } from '../../../types';

const chatSchema = z.object({
  modelId: z.string().min(1),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.union([z.string(), z.array(z.any())]),
  })),
  systemPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().min(1).max(1000000).optional(),
  topP: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  tools: z.array(z.any()).optional(),
});

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const jwtService = createJWTService();
    return await jwtService.verifyAccessToken(token);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  try {
    const body = await req.json();
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const manager = getProviderManager();

    if (parsed.data.stream) {
      // Streaming response
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const chatStream = manager.chatStream(
              {
                modelId: parsed.data.modelId,
                messages: parsed.data.messages as ChatMessage[],
                systemPrompt: parsed.data.systemPrompt,
                temperature: parsed.data.temperature,
                maxTokens: parsed.data.maxTokens,
                topP: parsed.data.topP,
                stream: true,
                tools: parsed.data.tools as any,
              },
              {
                userId: user.sub,
                traceId: crypto.randomUUID(),
              }
            );

            for await (const chunk of chatStream) {
              const data = `data: ${JSON.stringify(chunk)}\n\n`;
              controller.enqueue(encoder.encode(data));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (err: any) {
            const errorData = `data: ${JSON.stringify({ error: { code: 'STREAM_ERROR', message: err.message } })}\n\n`;
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
    }

    // Non-streaming
    const response = await manager.chat(
      {
        modelId: parsed.data.modelId,
        messages: parsed.data.messages as ChatMessage[],
        systemPrompt: parsed.data.systemPrompt,
        temperature: parsed.data.temperature,
        maxTokens: parsed.data.maxTokens,
        topP: parsed.data.topP,
        tools: parsed.data.tools as any,
      },
      {
        userId: user.sub,
        traceId: crypto.randomUUID(),
      }
    );

    return NextResponse.json({ success: true, data: response });
  } catch (err: any) {
    console.error('[chat] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'CHAT_ERROR', message: err.message || 'Chat failed' } },
      { status: 500 }
    );
  }
}
