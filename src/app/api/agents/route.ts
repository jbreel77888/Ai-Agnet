/**
 * GET /api/agents — List all agents
 * POST /api/agents — Create new agent
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../db/client';
import { agents, agentTools, models } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { createJWTService } from '../../../auth/jwt';

async function getUser(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const jwtService = createJWTService();
    return await jwtService.verifyAccessToken(authHeader.slice(7));
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  try {
    const allAgents = await db.select().from(agents);
    return NextResponse.json({
      success: true,
      data: {
        agents: allAgents.map(a => ({
          id: a.id,
          name: a.name,
          slug: a.slug,
          type: a.type,
          description: a.description,
          systemPrompt: a.systemPrompt,
          defaultModelId: a.defaultModelId,
          temperature: parseFloat(a.temperature),
          maxTokens: a.maxTokens,
          topP: parseFloat(a.topP),
          enabled: a.enabled,
          canSpawnSubagents: a.canSpawnSubagents,
          maxSubagents: a.maxSubagents,
          handoffTargets: a.handoffTargets,
          metadata: a.metadata,
        })),
      },
    });
  } catch (err: any) {
    console.error('[agents/list] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch agents' } },
      { status: 500 }
    );
  }
}

const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
  type: z.enum(['planner', 'research', 'reasoning', 'coding', 'execution', 'tool', 'memory', 'reflection', 'summarizer', 'custom']),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  defaultModelId: z.string().uuid().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).max(1000000).default(4096),
  topP: z.number().min(0).max(1).default(1),
  enabled: z.boolean().default(true),
  canSpawnSubagents: z.boolean().default(false),
  maxSubagents: z.number().min(0).max(20).default(0),
  handoffTargets: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  if (!user.roles?.includes('admin') && !user.roles?.includes('operator')) {
    return NextResponse.json(
      { success: false, error: { code: 'FORBIDDEN', message: 'Admin or operator access required' } },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const parsed = createAgentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const [agent] = await db.insert(agents).values({
      ...parsed.data,
      temperature: parsed.data.temperature.toString(),
      topP: parsed.data.topP.toString(),
      handoffTargets: parsed.data.handoffTargets as any,
    }).returning();

    return NextResponse.json({ success: true, data: { agent } }, { status: 201 });
  } catch (err: any) {
    if (err.code === '23505') {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: 'Agent slug already exists' } },
        { status: 409 }
      );
    }
    console.error('[agents/create] Error:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create agent' } },
      { status: 500 }
    );
  }
}
