/**
 * GET /api/workflows/runs/[id] — Get run status + steps
 * POST /api/workflows/runs/[id]/cancel — Cancel a run
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../../db/client';
import { workflowRuns, workflowStepRuns } from '../../../../../db/schema';
import { eq } from 'drizzle-orm';
import { getWorkflowEngine } from '../../../../../workflows/executor';
import { createJWTService } from '../../../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try { const jwt = createJWTService(); return await jwt.verifyAccessToken(authHeader.slice(7)); } catch { return null; }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const { id } = await params;
  const engine = getWorkflowEngine();
  const run = await engine.getStatus(id);
  if (!run) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 });

  const steps = await db.select().from(workflowStepRuns).where(eq(workflowStepRuns.workflowRunId, id));
  return NextResponse.json({ success: true, data: { run, steps } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const { id } = await params;
  const engine = getWorkflowEngine();
  await engine.cancel(id);
  return NextResponse.json({ success: true, data: { message: 'Run cancelled' } });
}
