/**
 * GET /api/system — System information
 * Returns platform info, modules, documentation files
 */
import { NextResponse } from 'next/server';

const MODULES = [
  { name: 'core', status: 'ready', files: 5, doc: 'ARCHITECTURE.md' },
  { name: 'providers', status: 'ready', files: 8, doc: 'PROVIDERS.md' },
  { name: 'agents', status: 'ready', files: 6, doc: 'AGENTS.md' },
  { name: 'tools', status: 'ready', files: 5, doc: 'TOOLS.md' },
  { name: 'memory', status: 'ready', files: 6, doc: 'MEMORY.md' },
  { name: 'context', status: 'scaffold', files: 3, doc: 'AGENTS.md' },
  { name: 'workflows', status: 'ready', files: 5, doc: 'WORKFLOWS.md' },
  { name: 'mcp', status: 'ready', files: 4, doc: 'MCP.md' },
  { name: 'background', status: 'ready', files: 4, doc: 'ARCHITECTURE.md' },
  { name: 'rag', status: 'scaffold', files: 3, doc: 'DATABASE.md' },
  { name: 'vector', status: 'scaffold', files: 2 },
  { name: 'storage', status: 'scaffold', files: 3 },
  { name: 'integrations', status: 'scaffold', files: 5 },
  { name: 'config', status: 'ready', files: 2 },
  { name: 'auth', status: 'ready', files: 5, doc: 'API.md' },
  { name: 'observability', status: 'ready', files: 6, doc: 'ARCHITECTURE.md' },
  { name: 'api', status: 'scaffold', files: 3, doc: 'API.md' },
  { name: 'db', status: 'ready', files: 13, doc: 'DATABASE.md' },
  { name: 'admin', status: 'scaffold', files: 2 },
];

const DOCUMENTATION = [
  'ARCHITECTURE.md',
  'DATABASE.md',
  'AGENTS.md',
  'PROVIDERS.md',
  'TOOLS.md',
  'MEMORY.md',
  'WORKFLOWS.md',
  'MCP.md',
  'API.md',
];

const PHASES = [
  { id: 1, name: 'Architecture & Documentation', status: 'in-progress', progress: 90 },
  { id: 2, name: 'Core Implementation', status: 'pending', progress: 35 },
  { id: 3, name: 'Agents System', status: 'pending', progress: 0 },
  { id: 4, name: 'Tools + MCP + RAG', status: 'pending', progress: 0 },
  { id: 5, name: 'Workflows + Background', status: 'pending', progress: 0 },
  { id: 6, name: 'Admin UI + Observability', status: 'pending', progress: 5 },
  { id: 7, name: 'Resilience + Tests + Deploy', status: 'pending', progress: 0 },
];

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      platform: 'Agent Platform',
      version: '0.1.0',
      inspiredBy: 'Manus',
      techStack: {
        language: 'TypeScript',
        runtime: 'Node.js + Next.js 16',
        database: 'PostgreSQL 15+',
        cache: 'Redis',
        orm: 'Drizzle ORM',
        queue: 'BullMQ',
        vector: 'pgvector',
        validation: 'Zod',
        auth: 'JWT + RBAC',
        observability: 'Pino + OpenTelemetry',
        deploy: 'Railway',
      },
      modules: MODULES,
      documentation: DOCUMENTATION,
      phases: PHASES,
      currentPhase: 1,
    },
    meta: {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    },
  });
}
