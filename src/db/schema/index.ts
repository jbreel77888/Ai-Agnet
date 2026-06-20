/**
 * Drizzle ORM Schema — Central Export
 *
 * All schema files live in this directory and are re-exported here.
 * Run `bun run db:generate` to generate migrations.
 */

import { users, roles, permissions, rolePermissions, userRoles, refreshTokens, auditLogs, userStatus, providerHealthStatus } from './auth.schema';
import { providers, models, providerType, entityStatus, modelStatus } from './providers.schema';
import { agents, agentTools, agentModels, agentType } from './agents.schema';
import { tools, toolPermissions, toolCategory, toolSource } from './tools.schema';
import { mcpServers, mcpTools, mcpTransport, mcpAuthType } from './mcp.schema';
import {
  memoryShort,
  memoryLong,
  memoryEntities,
  memorySummaries,
  factType,
  messageRole,
} from './memory.schema';
import {
  agentSessions,
  messages,
  artifacts,
  toolCalls,
  sessionStatus,
  messageRole as msgRole,
  artifactType,
  toolCallStatus,
} from './sessions.schema';
import {
  workflows,
  workflowRuns,
  workflowStepRuns,
  workflowStatus,
  stepType,
  stepStatus,
  triggerType,
} from './workflows.schema';
import { documents, documentChunks, docStatus, docSource } from './rag.schema';
import { jobRecords, jobLogs, jobStatus } from './jobs.schema';
import { costRecords, costBudgets, costScope, costPeriod, costAction } from './cost.schema';
import { traces, metrics, spanKind, spanStatus } from './observability.schema';
import { storageObjects, storageBackend } from './storage.schema';
import { integrations, integrationType } from './integrations.schema';

// Re-export everything
export {
  users, roles, permissions, rolePermissions, userRoles, refreshTokens, auditLogs,
  userStatus, providerHealthStatus,
  providers, models, providerType, entityStatus, modelStatus,
  agents, agentTools, agentModels, agentType,
  tools, toolPermissions, toolCategory, toolSource,
  mcpServers, mcpTools, mcpTransport, mcpAuthType,
  memoryShort, memoryLong, memoryEntities, memorySummaries, factType, messageRole,
  agentSessions, messages, artifacts, toolCalls, sessionStatus, msgRole, artifactType, toolCallStatus,
  workflows, workflowRuns, workflowStepRuns, workflowStatus, stepType, stepStatus, triggerType,
  documents, documentChunks, docStatus, docSource,
  jobRecords, jobLogs, jobStatus,
  costRecords, costBudgets, costScope, costPeriod, costAction,
  traces, metrics, spanKind, spanStatus,
  storageObjects, storageBackend,
  integrations, integrationType,
};

// Schema object for drizzle config (include enums so drizzle-kit generates CREATE TYPE)
export const schema = {
  users, roles, permissions, rolePermissions, userRoles, refreshTokens, auditLogs,
  userStatus, providerHealthStatus,
  providers, models, providerType, entityStatus, modelStatus,
  agents, agentTools, agentModels, agentType,
  tools, toolPermissions, toolCategory, toolSource,
  mcpServers, mcpTools, mcpTransport, mcpAuthType,
  memoryShort, memoryLong, memoryEntities, memorySummaries, factType, messageRole,
  agentSessions, messages, artifacts, toolCalls, sessionStatus, msgRole, artifactType, toolCallStatus,
  workflows, workflowRuns, workflowStepRuns, workflowStatus, stepType, stepStatus, triggerType,
  documents, documentChunks, docStatus, docSource,
  jobRecords, jobLogs, jobStatus,
  costRecords, costBudgets, costScope, costPeriod, costAction,
  traces, metrics, spanKind, spanStatus,
  storageObjects, storageBackend,
  integrations, integrationType,
};
