/**
 * Tool Registry — manages dynamic tools, executes them, converts to LLM format
 */
import { db } from '../../db/client';
import { tools } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { ToolDefinition, ToolResult, ToolContext } from '../../types';

export interface ITool {
  readonly name: string;
  readonly description: string;
  readonly schema: any;
  readonly category: string;
  execute(args: any, ctx: ToolContext): Promise<ToolResult>;
  validate(args: any): { valid: boolean; errors?: string[] };
}

class ToolRegistryImpl {
  private builtinTools = new Map<string, ITool>();
  private dbToolsCache: any[] | null = null;
  private cacheLoadedAt = 0;

  register(tool: ITool): void {
    this.builtinTools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.builtinTools.delete(name);
  }

  get(name: string): ITool | undefined {
    return this.builtinTools.get(name);
  }

  list(): ITool[] {
    return Array.from(this.builtinTools.values());
  }

  toOpenAITools(allowedNames?: string[]): ToolDefinition[] {
    let toolList = this.list();
    if (allowedNames && allowedNames.length > 0 && !allowedNames.includes('*')) {
      toolList = toolList.filter(t => allowedNames.includes(t.name));
    }
    return toolList.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.schema,
    }));
  }

  async execute(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) {
      return {
        success: false,
        error: { code: 'TOOL_NOT_FOUND', message: `Tool "${name}" not found` },
        metadata: { durationMs: 0 },
      };
    }

    const validation = tool.validate(args);
    if (!validation.valid) {
      return {
        success: false,
        error: { code: 'INVALID_ARGS', message: validation.errors?.join(', ') || 'Invalid arguments' },
        metadata: { durationMs: 0 },
      };
    }

    const start = Date.now();
    try {
      const result = await tool.execute(args, ctx);
      if (!result.metadata) result.metadata = { durationMs: Date.now() - start };
      else result.metadata.durationMs = Date.now() - start;
      return result;
    } catch (err: any) {
      return {
        success: false,
        error: { code: 'TOOL_ERROR', message: err.message },
        metadata: { durationMs: Date.now() - start },
      };
    }
  }
}

let instance: ToolRegistryImpl | null = null;
export function getToolRegistry(): ToolRegistryImpl {
  if (!instance) instance = new ToolRegistryImpl();
  return instance;
}
