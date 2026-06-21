/**
 * POST /api/storage — Upload a file (multipart form data or JSON with base64)
 * GET /api/storage — List files
 */
import { NextRequest, NextResponse } from 'next/server';
import { getStorageManager } from '../../../storage/manager';
import { createJWTService } from '../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try { const jwt = createJWTService(); return await jwt.verifyAccessToken(authHeader.slice(7)); } catch { return null; }
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const storage = getStorageManager();
  const files = await storage.list();
  return NextResponse.json({ success: true, data: { files } });
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File;
      if (!file) return NextResponse.json({ success: false, error: { code: 'NO_FILE' } }, { status: 400 });

      const buffer = Buffer.from(await file.arrayBuffer());
      const key = `${Date.now()}-${file.name}`;
      const storage = getStorageManager();
      const result = await storage.upload({
        key, data: buffer, contentType: file.type, ownerId: user.sub,
      });
      return NextResponse.json({ success: true, data: result }, { status: 201 });
    }

    // JSON upload with base64
    const body = await req.json();
    if (!body?.name || !body?.content) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name and content required' } }, { status: 400 });

    const buffer = Buffer.from(body.content, body.encoding || 'utf-8');
    const key = `${Date.now()}-${body.name}`;
    const storage = getStorageManager();
    const result = await storage.upload({
      key, data: buffer, contentType: body.contentType, ownerId: user.sub,
    });
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}
