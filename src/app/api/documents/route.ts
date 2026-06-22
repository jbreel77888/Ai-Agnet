/**
 * GET /api/documents — List documents
 * POST /api/documents — Upload a document (text content)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRAGService } from '../../../rag';
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
  const rag = getRAGService();
  const docs = await rag.listDocuments(user.sub);
  return NextResponse.json({ success: true, data: { documents: docs } });
}

const uploadSchema = z.object({
  name: z.string().min(1).max(200),
  content: z.string().min(1),
  mimeType: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } }, { status: 400 });

    const rag = getRAGService();
    const result = await rag.ingest({
      userId: user.sub,
      name: parsed.data.name,
      content: parsed.data.content,
      mimeType: parsed.data.mimeType || 'text/plain',
      sourceType: 'upload',
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}
