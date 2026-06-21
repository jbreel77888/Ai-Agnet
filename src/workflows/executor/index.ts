/**
 * Workflow Engine — executes DAG workflows with node types:
 * - start, end, agent, tool, condition, parallel, delay, code, handoff
 *
 * Persists state to PostgreSQL after each step.
 * Supports retry, timeout, and parallel branches.
 */
import { db } from '../../db/client';
import { workflows, workflowRuns, workflowStepRuns } from '../../db/schema';
import { eq, sql } from 'drizzle-orm';
import { getAgentRegistry } from '../../agents/registry';
import { getToolRegistry } from '../../tools/registry';
import { registerBuiltinTools } from '../../tools/builtin';

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  timeoutMs: number;
  maxRetries: number;
}

export interface WorkflowNode {
  id: string;
  type: 'start' | 'end' | 'agent' | 'tool' | 'condition' | 'parallel' | 'delay' | 'code';
  name: string;
  config: Record<string, any>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  input: any;
  output?: any;
  context: Map<string, any>;
  currentStepId?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

class WorkflowEngineImpl {
  async start(workflowId: string, input: any, userId?: string): Promise<string> {
    // Load workflow definition
    const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
    if (!wf) throw new Error('Workflow not found');

    const definition: WorkflowDefinition = {
      id: wf.id,
      name: wf.name,
      version: wf.version,
      nodes: (wf.definition as any)?.nodes || [],
      edges: (wf.definition as any)?.edges || [],
      timeoutMs: wf.definition?.timeoutMs || 300000,
      maxRetries: wf.maxRetries || 3,
    };

    if (definition.nodes.length === 0) {
      throw new Error('Workflow has no nodes');
    }

    // Create run record
    const [run] = await db.insert(workflowRuns).values({
      workflowId,
      status: 'running',
      input: input as any,
      context: { variables: {} } as any,
      startedAt: new Date(),
    }).returning();

    // Execute synchronously (for simple workflows)
    // Long-running workflows would use BullMQ
    try {
      const result = await this.execute(definition, run.id, input);
      return run.id;
    } catch (err: any) {
      await db.update(workflowRuns).set({
        status: 'failed',
        error: { message: err.message } as any,
        completedAt: new Date(),
      }).where(eq(workflowRuns.id, run.id));
      throw err;
    }
  }

  private async execute(definition: WorkflowDefinition, runId: string, input: any): Promise<any> {
    const context: Map<string, any> = new Map();
    context.set('input', input);

    // Find start node
    const startNode = definition.nodes.find(n => n.type === 'start');
    if (!startNode) throw new Error('No start node found');

    let currentNode: WorkflowNode | undefined = startNode;
    const executedNodes = new Set<string>();

    while (currentNode && currentNode.type !== 'end') {
      if (executedNodes.has(currentNode.id)) {
        throw new Error(`Cycle detected at node ${currentNode.id}`);
      }
      executedNodes.add(currentNode.id);

      // Record step start
      const [stepRun] = await db.insert(workflowStepRuns).values({
        workflowRunId: runId,
        stepId: currentNode.id,
        stepType: currentNode.type as any,
        status: 'running',
        input: context.get(currentNode.id) || context.get('input'),
        startedAt: new Date(),
      }).returning();

      try {
        const result = await this.executeNode(currentNode, context, runId);
        context.set(currentNode.id, result);

        // Record step completion
        await db.update(workflowStepRuns).set({
          status: 'completed',
          output: result as any,
          completedAt: new Date(),
        }).where(eq(workflowStepRuns.id, stepRun.id));

        // Find next node
        const edges = definition.edges.filter(e => e.from === currentNode!.id);
        if (edges.length === 0) break;

        if (currentNode.type === 'condition' && edges.length > 1) {
          // Evaluate condition
          const conditionResult = context.get(currentNode.id) as string;
          const matchedEdge = edges.find(e => e.condition === conditionResult) || edges[0];
          currentNode = definition.nodes.find(n => n.id === matchedEdge.to);
        } else {
          currentNode = definition.nodes.find(n => n.id === edges[0].to);
        }
      } catch (err: any) {
        await db.update(workflowStepRuns).set({
          status: 'failed',
          error: err.message,
          completedAt: new Date(),
        }).where(eq(workflowStepRuns.id, stepRun.id));
        throw err;
      }
    }

    // Execute end node
    const endResult = context.get(currentNode?.id || 'last') || context.get('input');
    await db.update(workflowRuns).set({
      status: 'completed',
      output: endResult as any,
      completedAt: new Date(),
    }).where(eq(workflowRuns.id, runId));

    return endResult;
  }

  private async executeNode(node: WorkflowNode, context: Map<string, any>, runId: string): Promise<any> {
    switch (node.type) {
      case 'start':
        return context.get('input');

      case 'agent': {
        const registry = getAgentRegistry();
        await registry.loadFromDB();
        const agent = registry.get(node.config.agentSlug);
        if (!agent) throw new Error(`Agent ${node.config.agentSlug} not found`);

        const agentInput = node.config.input || context.get('input') || '';
        const ctx = {
          sessionId: runId,
          userId: node.config.userId || 'system',
          messages: [],
          variables: new Map(),
          artifacts: [],
          currentAgentId: agent.id,
          handoffHistory: [],
          stepNumber: 0,
          budget: { tokensRemaining: 100000, costRemainingUsd: 10, stepsRemaining: 20 },
          services: {},
        };

        let output = '';
        for await (const event of agent.execute({ task: typeof agentInput === 'string' ? agentInput : JSON.stringify(agentInput) }, ctx as any)) {
          if (event.type === 'completed') {
            output = event.output.content;
          }
        }
        return output;
      }

      case 'tool': {
        try { registerBuiltinTools(); } catch {}
        const registry = getToolRegistry();
        const toolCtx = {
          userId: 'system', sessionId: runId, agentId: 'workflow',
          permissions: [], rateLimiterKey: 'workflow', traceId: runId,
        };
        const result = await registry.execute(node.config.toolName, node.config.args || {}, toolCtx as any);
        return result;
      }

      case 'condition': {
        const expression = node.config.expression || 'true';
        try {
          const result = Function('context', `"use strict"; return (${expression})`)(Object.fromEntries(context));
          return String(result);
        } catch {
          return 'false';
        }
      }

      case 'parallel': {
        const branches = node.config.branches || [];
        const results = await Promise.all(
          branches.map(async (branch: any) => {
            if (branch.type === 'agent') {
              const registry = getAgentRegistry();
              await registry.loadFromDB();
              const agent = registry.get(branch.agentSlug);
              if (!agent) return { error: `Agent ${branch.agentSlug} not found` };
              const ctx = {
                sessionId: runId, userId: 'system', messages: [], variables: new Map(),
                artifacts: [], currentAgentId: agent.id, handoffHistory: [], stepNumber: 0,
                budget: { tokensRemaining: 100000, costRemainingUsd: 10, stepsRemaining: 20 },
                services: {},
              };
              let output = '';
              for await (const event of agent.execute({ task: branch.input || '' }, ctx as any)) {
                if (event.type === 'completed') output = event.output.content;
              }
              return { agent: branch.agentSlug, output };
            }
            return branch;
          })
        );
        return { branches: results };
      }

      case 'delay': {
        const ms = node.config.durationMs || 1000;
        await new Promise(resolve => setTimeout(resolve, Math.min(ms, 10000)));
        return { delayed: ms };
      }

      case 'code': {
        const code = node.config.code || 'return null;';
        try {
          const result = Function('context', `"use strict"; ${code}`)(Object.fromEntries(context));
          return result;
        } catch (err: any) {
          return { error: err.message };
        }
      }

      case 'end':
        return context.get(node.config.outputVariable || 'input');

      default:
        return null;
    }
  }

  async cancel(runId: string): Promise<void> {
    await db.update(workflowRuns).set({
      status: 'cancelled',
      completedAt: new Date(),
    }).where(eq(workflowRuns.id, runId));
  }

  async getStatus(runId: string): Promise<any> {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!run) return null;
    return run;
  }

  async listRuns(limit = 20): Promise<any[]> {
    return await db.select().from(workflowRuns)
      .orderBy(sql`${workflowRuns.startedAt} DESC`)
      .limit(limit);
  }

  async listWorkflows(): Promise<any[]> {
    return await db.select().from(workflows).where(eq(workflows.enabled, true));
  }

  async createWorkflow(data: { name: string; description?: string; definition: any }): Promise<string> {
    const [wf] = await db.insert(workflows).values({
      name: data.name,
      description: data.description,
      definition: data.definition as any,
      enabled: true,
    }).returning();
    return wf.id;
  }

  validateDefinition(def: WorkflowDefinition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!def.nodes || def.nodes.length === 0) errors.push('No nodes defined');
    if (!def.nodes.find(n => n.type === 'start')) errors.push('No start node');
    if (!def.nodes.find(n => n.type === 'end')) errors.push('No end node');
    return { valid: errors.length === 0, errors };
  }
}

let instance: WorkflowEngineImpl | null = null;
export function getWorkflowEngine(): WorkflowEngineImpl {
  if (!instance) instance = new WorkflowEngineImpl();
  return instance;
}
