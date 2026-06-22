/**
 * Tool Registry interface
 */
import type { ToolDefinition, ToolResult, ToolContext, JSONSchema, ToolCategory } from '../../../types';

export interface ITool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: JSONSchema;
  readonly category: ToolCategory;
  readonly timeoutMs: number;

  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
  validate(args: unknown): { valid: boolean; errors?: string[] };
  getCapabilities?(): ToolCapabilities;
}

export interface ToolCapabilities {
  streaming?: boolean;
  longRunning?: boolean;
  requiresApproval?: boolean;
  sideEffects?: boolean;
  costEstimate?: number;
}

export interface ToolDescriptor {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  category: ToolCategory;
  schema: JSONSchema;
  enabled: boolean;
  requiredPermissions: string[];
  rateLimitPerMin: number;
  timeoutMs: number;
}

export interface ToolFilter {
  category?: ToolCategory;
  enabledOnly?: boolean;
  search?: string;
}

export interface ToolRegistry {
  register(tool: ITool): void;
  unregister(name: string): void;
  get(name: string): ITool | undefined;
  list(filter?: ToolFilter): ToolDescriptor[];

  toOpenAITools(allowedNames?: string[]): ToolDefinition[];
  toAnthropicTools(allowedNames?: string[]): AnthropicToolFormat[];

  reloadFromDB(): Promise<void>;
  reloadMCPTools(serverId: string): Promise<void>;

  on(event: 'tool_registered' | 'tool_unregistered' | 'tools_changed', cb: (e: unknown) => void): void;

  // Execution
  execute(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface AnthropicToolFormat {
  name: string;
  description: string;
  input_schema: JSONSchema;
}
