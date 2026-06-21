/**
 * /api/sessions/[id]
 * GET — Get session details + messages
 * DELETE — Delete session
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAgentOrchestrator } from '../../../../agents/orchestrator';
import { createJWTService } from '../../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    return await jwtService.verifyAccessToken(authHeader.slice(7));
  } catch { return null; }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  const { id } = await params;
  const orchestrator = getAgentOrchestrator();
  const session = await orchestrator.getSession(id, user.sub);
  if (!session) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 });

  const messages = await orchestrator.getMessages(id, user.sub);
  return NextResponse.json({ success: true, data: { session, messages } });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  const { id } = await params;
  const orchestrator = getAgentOrchestrator();
  try {
    await orchestrator.deleteSession(id, user.sub);
    return NextResponse.json({ success: true, data: { message: 'Session deleted' } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: err.message } }, { status: 404 });
  }
}
