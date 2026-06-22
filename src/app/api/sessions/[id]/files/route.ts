/**
 * /api/sessions/[id]/files
 * ─────────────────────────────────────────────────────────────────────────────
 * Session-scoped file storage. Files uploaded here are tagged with the
 * session id (stored in `storage_objects.metadata.sessionId`) so that the
 * Workspace panel can list / preview / delete them per-session.
 *
 *   GET    — list files for this session
 *   POST   — upload one or more files (multipart/form-data)
 *   DELETE — delete a single file by key (query: ?key=...)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../db/client';
import { storageObjects } from '../../../../../db/schema';
import { eq, sql } from 'drizzle-orm';
import { getStorageManager } from '../../../../../storage/manager';
import { createJWTService } from '../../../../../auth/jwt';
import { getAgentOrchestrator } from '../../../../../agents/orchestrator';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwt = createJWTService();
    return await jwt.verifyAccessToken(authHeader.slice(7));
  } catch { return null; }
}

async function verifySession(sessionId: string, userId: string) {
  const orchestrator = getAgentOrchestrator();
  const session = await orchestrator.getSession(sessionId, userId);
  if (!session) return null;
  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — list session files
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  const { id: sessionId } = await params;
  const session = await verifySession(sessionId, user.sub);
  if (!session) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, { status: 404 });

  try {
    // Files for this session are those whose metadata.sessionId = sessionId
    const rows = await db.select()
      .from(storageObjects)
      .where(sql`metadata->>'sessionId' = ${sessionId}`)
      .orderBy(storageObjects.createdAt);

    const files = rows.map(r => ({
      key: r.key,
      name: r.key.split('/').pop() || r.key,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      isPublic: r.isPublic,
      createdAt: r.createdAt,
      metadata: r.metadata,
    }));

    return NextResponse.json({ success: true, data: { files, sessionId } });
  } catch (err: any) {
    console.error('[files:list] error:', err);
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST — upload files (multipart/form-data)
// ─────────────────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB per file

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  const { id: sessionId } = await params;
  const session = await verifySession(sessionId, user.sub);
  if (!session) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, { status: 404 });

  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Expected multipart/form-data' } }, { status: 400 });
    }

    const formData = await req.formData();
    const files = formData.getAll('files').filter(f => f instanceof File) as File[];
    if (files.length === 0) {
      const single = formData.get('file');
      if (single instanceof File) files.push(single);
    }
    if (files.length === 0) {
      return NextResponse.json({ success: false, error: { code: 'NO_FILE', message: 'No files provided' } }, { status: 400 });
    }

    const storage = getStorageManager();
    const uploaded: any[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: `File "${file.name}" exceeds 25MB limit` },
        }, { status: 413 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      // Use session-scoped key: sessions/{sessionId}/{timestamp}-{filename}
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `sessions/${sessionId}/${Date.now()}-${safeName}`;

      const result = await storage.upload({
        key,
        data: buffer,
        contentType: file.type || 'application/octet-stream',
        ownerId: user.sub,
      });

      // Record in storage_objects table with sessionId in metadata
      try {
        await db.insert(storageObjects).values({
          key,
          ownerId: user.sub,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: result.sizeBytes,
          isPublic: false,
          metadata: {
            sessionId,
            originalName: file.name,
            uploadedAt: new Date().toISOString(),
            source: 'workspace-upload',
          },
        }).onConflictDoNothing();
      } catch (dbErr: any) {
        console.warn('[files:upload] DB insert failed (continuing):', dbErr.message);
      }

      uploaded.push({
        key,
        name: file.name,
        sizeBytes: result.sizeBytes,
        contentType: file.type,
      });
    }

    return NextResponse.json({ success: true, data: { files: uploaded, sessionId } }, { status: 201 });
  } catch (err: any) {
    console.error('[files:upload] error:', err);
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — delete a file (query: ?key=...)
// ─────────────────────────────────────────────────────────────────────────────
const deleteSchema = z.object({ key: z.string().min(1) });

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  const { id: sessionId } = await params;
  const session = await verifySession(sessionId, user.sub);
  if (!session) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, { status: 404 });

  try {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    const parsed = deleteSchema.safeParse({ key });
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } }, { status: 400 });

    // Ensure the file actually belongs to this session
    const [row] = await db.select()
      .from(storageObjects)
      .where(sql`key = ${parsed.data.key} AND metadata->>'sessionId' = ${sessionId}`)
      .limit(1);

    if (!row) {
      return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'File not found in this session' } }, { status: 404 });
    }

    const storage = getStorageManager();
    await storage.delete(parsed.data.key);
    await db.delete(storageObjects).where(eq(storageObjects.key, parsed.data.key));

    return NextResponse.json({ success: true, data: { deleted: parsed.data.key } });
  } catch (err: any) {
    console.error('[files:delete] error:', err);
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}
