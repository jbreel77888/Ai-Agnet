/**
 * GET /api/workflows — List workflows
 * POST /api/workflows — Create workflow
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getWorkflowEngine } from '../../../workflows/executor';
import { createJWTService } from '../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try { const jwt = createJWTService(); return await jwt.verifyAccessToken(authHeader.slice(7)); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const engine = getWorkflowEngine();
  const wfs = await engine.listWorkflows();
  return NextResponse.json({ success: true, data: { workflows: wfs } });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  definition: z.object({
    nodes: z.array(z.any()),
    edges: z.array(z.any()),
    timeoutMs: z.number().optional(),
  }),
});

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } }, { status: 400 });
    const engine = getWorkflowEngine();
    const id = await engine.createWorkflow(parsed.data);
    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 }); }
}
