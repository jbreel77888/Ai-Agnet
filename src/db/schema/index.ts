/**
 * Drizzle ORM Schema — Central Export
 *
 * All schema files live in this directory and are re-exported here.
 * Run `bun run db:generate` to generate migrations.
 */

import { users, roles, permissions, rolePermissions, userRoles, refreshTokens, auditLogs } from './auth.schema';
import { providers, models } from './providers.schema';
import { agents, agentTools, agentModels } from './agents.schema';
import { tools, toolPermissions } from './tools.schema';
import { mcpServers, mcpTools } from './mcp.schema';
import {
  memoryShort,
  memoryLong,
  memoryEntities,
  memorySummaries,
} from './memory.schema';
import {
  agentSessions,
  messages,
  artifacts,
  toolCalls,
} from './sessions.schema';
import {
  workflows,
  workflowRuns,
  workflowStepRuns,
} from './workflows.schema';
import { documents, documentChunks } from './rag.schema';
import { jobRecords, jobLogs } from './jobs.schema';
import { costRecords, costBudgets } from './cost.schema';
import { traces, metrics } from './observability.schema';
import { storageObjects } from './storage.schema';
import { integrations } from './integrations.schema';

// Re-export everything
export {
  users, roles, permissions, rolePermissions, userRoles, refreshTokens, auditLogs,
  providers, models,
  agents, agentTools, agentModels,
  tools, toolPermissions,
  mcpServers, mcpTools,
  memoryShort, memoryLong, memoryEntities, memorySummaries,
  agentSessions, messages, artifacts, toolCalls,
  workflows, workflowRuns, workflowStepRuns,
  documents, documentChunks,
  jobRecords, jobLogs,
  costRecords, costBudgets,
  traces, metrics,
  storageObjects,
  integrations,
};

// Schema object for drizzle config
export const schema = {
  users, roles, permissions, rolePermissions, userRoles, refreshTokens, auditLogs,
  providers, models,
  agents, agentTools, agentModels,
  tools, toolPermissions,
  mcpServers, mcpTools,
  memoryShort, memoryLong, memoryEntities, memorySummaries,
  agentSessions, messages, artifacts, toolCalls,
  workflows, workflowRuns, workflowStepRuns,
  documents, documentChunks,
  jobRecords, jobLogs,
  costRecords, costBudgets,
  traces, metrics,
  storageObjects,
  integrations,
};
