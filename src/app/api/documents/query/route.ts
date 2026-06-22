/**
 * POST /api/documents/query — Semantic search across documents
 * DELETE /api/documents/[id] — Delete a document
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRAGService } from '../../../../rag';
import { createJWTService } from '../../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    return await jwtService.verifyAccessToken(authHeader.slice(7));
  } catch { return null; }
}

const querySchema = z.object({
  text: z.string().min(1),
  topK: z.number().min(1).max(20).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  try {
    const body = await req.json();
    const parsed = querySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } }, { status: 400 });

    const rag = getRAGService();
    const results = await rag.query({
      text: parsed.data.text,
      userId: user.sub,
      topK: parsed.data.topK || 5,
      minScore: parsed.data.minScore ?? 0.1,
    });

    return NextResponse.json({ success: true, data: { results, count: results.length } });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}
