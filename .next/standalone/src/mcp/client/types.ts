/**
 * MCP Client interface
 */
import type {
  MCPServerConfig, MCPTool, MCPTransportType, MCPAuthType,
  JSONSchema,
} from '../../../types';

export interface MCPClient {
  connect(serverConfig: MCPServerConfig): Promise<MCPSession>;
  disconnect(serverId: string): Promise<void>;
  reconnect(serverId: string): Promise<void>;
  reconnectAll(): Promise<void>;

  listTools(serverId: string): Promise<MCPTool[]>;
  listResources(serverId: string): Promise<MCPResource[]>;
  listPrompts(serverId: string): Promise<MCPPrompt[]>;

  callTool(serverId: string, toolName: string, args: unknown): Promise<MCPToolResult>;
  readResource(serverId: string, uri: string): Promise<MCPResourceContent>;
  getPrompt(serverId: string, name: string, args?: Record<string, string>): Promise<MCPPromptResult>;

  healthCheck(serverId: string): Promise<MCPHealth>;
  ping(serverId: string): Promise<boolean>;
  getSessions(): Map<string, MCPSession>;
}

export interface MCPSession {
  serverId: string;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  transport: MCPTransportType;
  lastPingAt: Date;
  toolsCache: MCPTool[];
  resourcesCache: MCPResource[];
  startedAt: Date;
  process?: unknown; // for stdio
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: { name: string; description?: string; required?: boolean }[];
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64
}

export interface MCPPromptResult {
  description?: string;
  messages: { role: 'user' | 'assistant'; content: { type: 'text' | 'image' | 'resource'; text?: string; data?: string; resource?: { uri: string; mimeType?: string } } }[];
}

export interface MCPToolResult {
  content: unknown;
  isError: boolean;
}

export interface MCPHealth {
  status: 'healthy' | 'degraded' | 'down';
  lastCheckedAt: Date;
  latencyMs?: number;
  toolsCount: number;
  error?: string;
}
