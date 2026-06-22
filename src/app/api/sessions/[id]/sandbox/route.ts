/**
 * /api/sessions/[id]/sandbox
 * ─────────────────────────────────────────────────────────────────────────────
 * Browse and download files from the session's stateful Tensorlake sandbox.
 *
 *   GET ?path=/home/tl-user           → list directory entries
 *   GET ?path=/home/tl-user/file.txt  → download file (raw bytes)
 *   GET ?path=/home/tl-user/file.txt&preview=1  → file content as JSON (for preview)
 *
 * All paths must be absolute and within /home/tl-user (the sandbox home).
 * This prevents reading system files like /etc/passwd.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createJWTService } from '../../../../../auth/jwt';
import { getAgentOrchestrator } from '../../../../../agents/orchestrator';
import { getSandboxManager } from '../../../../../sandbox/manager';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwt = createJWTService();
    return await jwt.verifyAccessToken(authHeader.slice(7));
  } catch { return null; }
}

const SANDBOX_HOME = '/home/tl-user';

/**
 * Security check: ensure path is within the sandbox home directory.
 * Prevents path traversal (../../../etc/passwd) and absolute system paths.
 */
function isPathSafe(path: string): boolean {
  if (!path) return false;
  if (!path.startsWith(SANDBOX_HOME)) return false;
  // Block obvious traversal attempts
  if (path.includes('..')) return false;
  return true;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });

  const { id: sessionId } = await params;
  const orchestrator = getAgentOrchestrator();
  const session = await orchestrator.getSession(sessionId, user.sub);
  if (!session) return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } }, { status: 404 });

  const url = new URL(req.url);
  const path = url.searchParams.get('path') || SANDBOX_HOME;
  const preview = url.searchParams.get('preview') === '1';

  if (!isPathSafe(path)) {
    return NextResponse.json({
      success: false,
      error: { code: 'PATH_NOT_ALLOWED', message: `Path must be within ${SANDBOX_HOME}` },
    }, { status: 403 });
  }

  const sandboxManager = getSandboxManager();
  if (!sandboxManager.isEnabled()) {
    return NextResponse.json({
      success: false,
      error: { code: 'SANDBOX_DISABLED', message: 'TENSORLAKE_API_KEY not set — sandbox unavailable' },
    }, { status: 503 });
  }

  const handle = await sandboxManager.getSessionSandbox(sessionId);
  if (!handle) {
    return NextResponse.json({
      success: false,
      error: { code: 'SANDBOX_UNAVAILABLE', message: 'Failed to get sandbox for this session' },
    }, { status: 503 });
  }

  const { sandbox, sandboxId } = handle;

  try {
    // Try to list as directory first
    try {
      const listing = await sandbox.listDirectory(path);
      const entries = (listing as any).entries || (listing as any).files || listing;
      if (Array.isArray(entries)) {
        const files = entries.map((e: any) => ({
          name: e.name || e.filename || '',
          type: e.type || (e.isDirectory ? 'directory' : 'file'),
          size: e.size || 0,
          modifiedAt: e.modifiedAt || e.mtime || null,
          path: path.endsWith('/') ? `${path}${e.name || e.filename || ''}` : `${path}/${e.name || e.filename || ''}`,
        }));
        return NextResponse.json({
          success: true,
          data: {
            path,
            isDirectory: true,
            entries: files,
            count: files.length,
            sandboxId,
          },
        });
      }
    } catch {
      // Not a directory — fall through to file read
    }

    // Read as file
    const data = await sandbox.readFile(path);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    // Preview mode: return content as JSON (text or base64 for images)
    if (preview) {
      const ext = path.split('.').pop()?.toLowerCase();
      const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext || '');
      const isText = ['txt', 'md', 'json', 'csv', 'html', 'js', 'ts', 'py', 'sh', 'yml', 'yaml', 'xml', 'log', 'css', 'sql'].includes(ext || '');

      if (isImage) {
        const mimeType = ext === 'png' ? 'image/png'
          : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'gif' ? 'image/gif'
          : ext === 'webp' ? 'image/webp'
          : ext === 'svg' ? 'image/svg+xml'
          : 'application/octet-stream';
        return NextResponse.json({
          success: true,
          data: {
            path,
            isDirectory: false,
            type: 'image',
            mimeType,
            size: buffer.length,
            content: `data:${mimeType};base64,${buffer.toString('base64')}`,
            sandboxId,
          },
        });
      } else if (isText) {
        const text = buffer.toString('utf-8');
        const truncated = text.length > 50000
          ? text.substring(0, 50000) + `\n\n... [truncated, full length ${text.length}]`
          : text;
        return NextResponse.json({
          success: true,
          data: {
            path,
            isDirectory: false,
            type: 'text',
            mimeType: 'text/plain',
            size: buffer.length,
            content: truncated,
            truncated: text.length > 50000,
            sandboxId,
          },
        });
      } else {
        // Binary — return metadata only, use download for actual content
        return NextResponse.json({
          success: true,
          data: {
            path,
            isDirectory: false,
            type: 'binary',
            mimeType: 'application/octet-stream',
            size: buffer.length,
            content: null,
            note: 'Binary file — use download endpoint to fetch raw bytes',
            sandboxId,
          },
        });
      }
    }

    // Download mode: return raw bytes
    const ext = path.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'png' ? 'image/png'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'gif' ? 'image/gif'
      : ext === 'webp' ? 'image/webp'
      : ext === 'svg' ? 'image/svg+xml'
      : ext === 'pdf' ? 'application/pdf'
      : ext === 'json' ? 'application/json'
      : ext === 'csv' ? 'text/csv'
      : ext === 'html' || ext === 'htm' ? 'text/html'
      : 'application/octet-stream';

    const filename = path.split('/').pop() || 'download';
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    const isNotFound = err.message?.includes('not found') || err.message?.includes('does not exist') || err.message?.includes('No such file');
    return NextResponse.json({
      success: false,
      error: {
        code: isNotFound ? 'NOT_FOUND' : 'SANDBOX_ERROR',
        message: err.message,
      },
    }, { status: isNotFound ? 404 : 500 });
  }
}
