/**
 * GET /api/storage/[key] — Download a file
 * DELETE /api/storage/[key] — Delete a file
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStorageManager } from '../../../../storage/manager';
import { createJWTService } from '../../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try { const jwt = createJWTService(); return await jwt.verifyAccessToken(authHeader.slice(7)); } catch { return null; }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const { key } = await params;
  const storage = getStorageManager();
  const exists = await storage.exists(key);
  if (!exists) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND' } }, { status: 404 });
  const data = await storage.download(key);
  return new NextResponse(data, {
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${key}"` },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const { key } = await params;
  const storage = getStorageManager();
  await storage.delete(key);
  return NextResponse.json({ success: true, data: { message: 'Deleted' } });
}
