/**
 * POST /api/workflows/runs — Start a workflow run
 * GET /api/workflows/runs — List recent runs
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkflowEngine } from '../../../../workflows/executor';
import { createJWTService } from '../../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try { const jwt = createJWTService(); return await jwt.verifyAccessToken(authHeader.slice(7)); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const engine = getWorkflowEngine();
  const runs = await engine.listRuns(20);
  return NextResponse.json({ success: true, data: { runs } });
}

const startSchema = z.object({
  workflowId: z.string().uuid(),
  input: z.any().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  try {
    const body = await req.json();
    const parsed = startSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } }, { status: 400 });
    const engine = getWorkflowEngine();
    const runId = await engine.start(parsed.data.workflowId, parsed.data.input || {}, user.sub);
    return NextResponse.json({ success: true, data: { runId } }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 }); }
}
