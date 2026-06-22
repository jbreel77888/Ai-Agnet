/**
 * GET /api/sessions — List user's sessions
 * POST /api/sessions — Create new session
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAgentOrchestrator } from '../../../agents/orchestrator';
import { getAgentRegistry } from '../../../agents/registry';
import { createJWTService } from '../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    return await jwtService.verifyAccessToken(authHeader.slice(7));
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  try {
    const orchestrator = getAgentOrchestrator();
    const sessions = await orchestrator.listSessions(user.sub);
    return NextResponse.json({ success: true, data: { sessions } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}

const createSchema = z.object({
  agentSlug: z.string().min(1),
  title: z.string().optional(),
  modelId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } }, { status: 400 });

    const orchestrator = getAgentOrchestrator();
    const result = await orchestrator.createSession({
      agentSlug: parsed.data.agentSlug,
      userId: user.sub,
      title: parsed.data.title,
      modelId: parsed.data.modelId,
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}
