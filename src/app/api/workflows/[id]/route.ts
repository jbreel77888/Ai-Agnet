/**
 * GET /api/workflows/[id] — Get workflow details
 * DELETE /api/workflows/[id] — Delete workflow
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../db/client';
import { workflows } from '../../../../db/schema';
import { eq } from 'drizzle-orm';
import { createJWTService } from '../../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try { const jwt = createJWTService(); return await jwt.verifyAccessToken(authHeader.slice(7)); } catch { return null; }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const { id } = await params;
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
  if (!wf) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
  return NextResponse.json({ success: true, data: { workflow: wf } });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const { id } = await params;
  await db.delete(workflows).where(eq(workflows.id, id));
  return NextResponse.json({ success: true, data: { message: 'Deleted' } });
}
