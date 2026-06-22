/**
 * Core Domain Types — Shared across all modules
 *
 * These are pure TypeScript types/interfaces with NO runtime dependencies.
 * All modules can import from here safely.
 */

// =============================================================================
// Providers & Models
// =============================================================================

export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'ollama'
  | 'openrouter'
  | 'openai_compatible'
  | 'custom';

export interface ProviderConfig {
  id: string;
  slug: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  status: 'active' | 'inactive' | 'error';
  healthStatus: 'healthy' | 'degraded' | 'down' | 'unknown';
}

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  supportsJsonMode: boolean;
  supportsSystemPrompt: boolean;
  maxContextTokens: number;
  maxOutputTokens: number;
}

export interface Model {
  id: string;
  providerId: string;
  name: string;
  displayName?: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  priority: number;
  status: 'active' | 'deprecated' | 'inactive';
}

export interface ChatRequest {
  modelId: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  responseFormat?: 'text' | 'json';
  stream?: boolean;
  userId?: string;
  sessionId?: string;
  traceId?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlock[];
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64' | 'url'; data: string; mediaType: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  role: 'assistant';
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  raw?: unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatChunk {
  delta?: {
    content?: string;
    toolCalls?: Partial<ToolCall>[];
    thinking?: string;
  };
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: TokenUsage;
  model?: string;
}

export interface ChatOptions {
  timeoutMs?: number;
  maxRetries?: number;
  fallbackModelIds?: string[];
  priority?: 'cost' | 'speed' | 'quality';
  costBudget?: number;
  traceId?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
}

// =============================================================================
// JSON Schema (simplified)
// =============================================================================

export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  additionalProperties?: boolean | JSONSchema;
  $ref?: string;
}

// =============================================================================
// Agents
// =============================================================================

export type AgentType =
  | 'planner'
  | 'research'
  | 'reasoning'
  | 'coding'
  | 'execution'
  | 'tool'
  | 'memory'
  | 'reflection'
  | 'summarizer'
  | 'custom';

export interface AgentConfig {
  defaultModelId: string;
  fallbackModelIds: string[];
  temperature: number;
  maxTokens: number;
  topP: number;
  stopSequences?: string[];
  systemPrompt: string;
  allowedTools: string[];
  deniedTools: string[];
  maxStepsPerRun: number;
  maxRetries: number;
  canSpawnSubagents: boolean;
  maxSubagents: number;
  handoffTargets: string[];
  requireApprovalForTools?: string[];
  sandboxed: boolean;
  timeoutMs: number;
  retryStrategy: 'none' | 'exponential' | 'linear';
  fallbackAgentSlug?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  traceEnabled: boolean;
}

export interface AgentInput {
  task: string;
  context?: Record<string, unknown>;
  constraints?: string[];
  expectedOutput?: string;
}

export interface AgentOutput {
  content: string;
  artifacts?: Artifact[];
  toolCalls?: ToolCall[];
  nextAgentSuggestion?: string;
  metadata?: {
    tokensUsed: number;
    cost: number;
    durationMs: number;
    stepsCompleted: number;
  };
}

export type AgentEvent =
  | { type: 'started'; agentId: string; input: AgentInput }
  | { type: 'thinking'; content: string }
  | { type: 'message_chunk'; content: string }
  | { type: 'tool_call'; toolName: string; args: unknown; toolCallId: string }
  | { type: 'tool_result'; toolName: string; result: unknown; durationMs: number }
  | { type: 'handoff_request'; target: string; reason: string }
  | { type: 'subagent_spawned'; subAgentId: string; type: AgentType }
  | { type: 'error'; error: AgentError; recoverable: boolean }
  | { type: 'completed'; output: AgentOutput; tokensUsed: number; cost: number }
  | { type: 'cancelled'; reason: string };

export interface AgentError {
  code: string;
  message: string;
  details?: unknown;
  retryable: boolean;
}

export interface HandoffPayload {
  from: string;
  to: string;
  reason: string;
  contextSnapshot: AgentContext;
  partialOutput?: AgentOutput;
  instructions?: string;
  requiredTools?: string[];
  priority: 'low' | 'normal' | 'high';
}

export interface HandoffRecord {
  from: string;
  to: string;
  reason: string;
  timestamp: Date;
  stepNumber: number;
}

// =============================================================================
// Agent Context (shared between agents in a session)
// =============================================================================

export interface AgentContext {
  sessionId: string;
  userId: string;
  tenantId?: string;

  messages: ChatMessage[];
  variables: Map<string, unknown>;
  artifacts: Artifact[];

  currentAgentId: string;
  parentAgentId?: string;
  handoffHistory: HandoffRecord[];
  stepNumber: number;
  budget: BudgetContext;

  // Injected services (read-only references)
  // Note: These will be typed using interfaces from their modules
  // to avoid circular deps. See src/core/container.ts for actual wiring.
  services: AgentServices;
}

export interface BudgetContext {
  tokensRemaining: number;
  costRemainingUsd: number;
  stepsRemaining: number;
}

export interface AgentServices {
  // Filled by DI container — see src/core/container.ts
  [key: symbol]: unknown;
}

// =============================================================================
// Artifacts & Sessions
// =============================================================================

export interface Artifact {
  id: string;
  name: string;
  type: 'file' | 'image' | 'code' | 'report' | 'data';
  storageKey: string;
  mimeType?: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Memory
// =============================================================================

export type FactType = 'preference' | 'entity' | 'event' | 'summary' | 'custom';

export interface MemoryRecord {
  id: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  fact: string;
  factType: FactType;
  importance: number;
  metadata?: Record<string, unknown>;
  lastAccessedAt?: Date;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryQuery {
  text: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  factTypes?: FactType[];
  topK?: number;
  minScore?: number;
  timeRange?: { from?: Date; to?: Date };
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
}

// =============================================================================
// Tools
// =============================================================================

export type ToolCategory = 'builtin' | 'integration' | 'mcp' | 'custom';

export interface ToolContext {
  userId: string;
  sessionId: string;
  agentId: string;
  permissions: string[];
  rateLimiterKey: string;
  traceId: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  metadata?: {
    durationMs: number;
    cost?: number;
    tokensUsed?: number;
    artifacts?: { name: string; storageKey: string }[];
  };
}

// =============================================================================
// MCP
// =============================================================================

export type MCPTransportType = 'stdio' | 'sse' | 'websocket' | 'http';
export type MCPAuthType = 'none' | 'bearer' | 'basic' | 'api_key';

export interface MCPServerConfig {
  id: string;
  name: string;
  slug: string;
  transport: MCPTransportType;
  command?: string;
  args?: string[];
  url?: string;
  authType: MCPAuthType;
  authCredentials?: string;
  envVars?: Record<string, string>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface MCPToolResult {
  content: unknown;
  isError: boolean;
}

// =============================================================================
// Workflows
// =============================================================================

export type NodeType =
  | 'start' | 'end' | 'agent' | 'tool' | 'condition' | 'parallel'
  | 'loop' | 'delay' | 'code' | 'handoff' | 'webhook' | 'human_approval'
  | 'sub_workflow';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  condition?: string;
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  outputSchema?: JSONSchema;
  timeoutMs: number;
  maxRetries: number;
  retryStrategy: 'none' | 'exponential' | 'linear';
  trigger:
    | { type: 'manual' }
    | { type: 'webhook'; path: string; method: 'GET' | 'POST' }
    | { type: 'schedule'; cron: string }
    | { type: 'event'; eventName: string };
  initialVariables?: Record<string, unknown>;
}

export type WorkflowRunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowRunStatus;
  input: unknown;
  output?: unknown;
  context: WorkflowContext;
  currentStepId?: string;
  error?: { code: string; message: string; nodeId?: string };
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface WorkflowContext {
  variables: Map<string, unknown>;
  stepResults: Map<string, unknown>;
  artifacts: Artifact[];
  traceId: string;
  parentRunId?: string;
}

// =============================================================================
// Auth
// =============================================================================

export type SystemRole = 'admin' | 'operator' | 'user';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  roles: SystemRole[];
  status: 'active' | 'suspended' | 'deleted';
}

export interface AuthSession {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

// =============================================================================
// Observability
// =============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  requestId?: string;
  traceId?: string;
  userId?: string;
  sessionId?: string;
  agentId?: string;
  meta?: Record<string, unknown>;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: Date;
  endTime?: Date;
  attributes: Record<string, unknown>;
  events: { name: string; timestamp: Date; attributes?: Record<string, unknown> }[];
  status: 'ok' | 'error' | 'unset';
}

// =============================================================================
// Health
// =============================================================================

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  checks: {
    name: string;
    status: 'healthy' | 'degraded' | 'down';
    latencyMs?: number;
    details?: Record<string, unknown>;
  }[];
  timestamp: Date;
  uptime: number;
}
