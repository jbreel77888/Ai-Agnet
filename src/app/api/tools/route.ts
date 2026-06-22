/**
 * GET /api/tools — List all available tools (built-in + DB)
 * POST /api/tools — Execute a tool
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getToolRegistry } from '../../../tools/registry';
import { registerBuiltinTools } from '../../../tools/builtin';
import { createJWTService } from '../../../auth/jwt';
import type { ToolContext } from '../../../types';

// Register built-in tools on first load
let initialized = false;
let initPromise: Promise<void> | null = null;
function ensureTools(): Promise<void> {
  if (initialized) return Promise.resolve();
  if (!initPromise) {
    initPromise = registerBuiltinTools().then(() => { initialized = true; }).catch(err => {
      console.error('[api/tools] Failed to register tools:', err);
      initPromise = null; // allow retry
    });
  }
  return initPromise;
}

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
  await ensureTools();
  const registry = getToolRegistry();
  const tools = registry.list().map(t => ({ name: t.name, description: t.description, category: t.category, schema: t.schema }));
  return NextResponse.json({ success: true, data: { tools } });
}

const executeSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.any()).default({}),
});

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  await ensureTools();

  try {
    const body = await req.json();
    const parsed = executeSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: { code: 'VALIDATION_ERROR', details: parsed.error.issues } }, { status: 400 });

    const registry = getToolRegistry();
    const ctx: ToolContext = { userId: user.sub, sessionId: 'api', agentId: 'api', permissions: [], rateLimiterKey: user.sub, traceId: crypto.randomUUID() };
    const result = await registry.execute(parsed.data.tool, parsed.data.args, ctx);
    return NextResponse.json({ success: true, data: result });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, { status: 500 });
  }
}
