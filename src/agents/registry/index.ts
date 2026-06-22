/**
 * Agent Registry — loads agents from DB, manages instances
 */
import { db } from '../../db/client';
import { agents, models } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { BaseAgent, type BaseAgentConfig } from '../base';
import type { IAgent, AgentType } from '../../types';

class AgentRegistryImpl {
  private instances = new Map<string, IAgent>();
  private loadedAt = 0;
  private readonly CACHE_TTL_MS = 60_000;

  async loadFromDB(): Promise<void> {
    if (Date.now() - this.loadedAt < this.CACHE_TTL_MS && this.instances.size > 0) return;

    this.instances.clear();
    const allAgents = await db.select().from(agents).where(eq(agents.enabled, true));

    for (const row of allAgents) {
      const config: BaseAgentConfig = {
        id: row.id,
        slug: row.slug,
        type: row.type as AgentType,
        systemPrompt: row.systemPrompt || `You are a ${row.name} agent.`,
        defaultModelId: row.defaultModelId || undefined,
        temperature: parseFloat(row.temperature),
        maxTokens: row.maxTokens,
        topP: parseFloat(row.topP),
        enabled: row.enabled,
        canSpawnSubagents: row.canSpawnSubagents,
        maxSubagents: row.maxSubagents,
        handoffTargets: (row.handoffTargets as string[]) || [],
      };
      const agent = new BaseAgent(config);
      this.instances.set(row.slug, agent);
    }

    this.loadedAt = Date.now();
    console.log(`[agent-registry] Loaded ${this.instances.size} agents`);
  }

  get(slug: string): IAgent | undefined {
    return this.instances.get(slug);
  }

  list(filter?: { type?: AgentType; enabledOnly?: boolean }): IAgent[] {
    let result = Array.from(this.instances.values());
    if (filter?.type) result = result.filter(a => a.type === filter.type);
    return result;
  }

  register(agent: IAgent): void {
    this.instances.set(agent.slug, agent);
  }

  unregister(slug: string): void {
    this.instances.delete(slug);
  }

  selectBestFor(input: { task: string }): IAgent | undefined {
    let best: IAgent | undefined;
    let bestScore = 0;
    for (const agent of this.instances.values()) {
      const score = agent.canHandle(input);
      if (score > bestScore) { bestScore = score; best = agent; }
    }
    return best;
  }

  async reload(): Promise<void> {
    this.loadedAt = 0;
    await this.loadFromDB();
  }
}

let instance: AgentRegistryImpl | null = null;
export function getAgentRegistry(): AgentRegistryImpl {
  if (!instance) instance = new AgentRegistryImpl();
  return instance;
}
