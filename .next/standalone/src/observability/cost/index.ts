/**
 * Cost Tracker — records token usage and cost for every LLM call
 */
import { db } from '../../db/client';
import { costRecords, costBudgets, models, providers } from '../../db/schema';
import { eq, sql, and, gte, lte } from 'drizzle-orm';
import type { CostTracker } from './types';

export function createCostTracker(): CostTracker {
  const record = async (input: RecordCostInput): Promise<void> => {
    // Resolve model pricing
    let inputPricePer1k = 0;
    let outputPricePer1k = 0;
    let providerId = input.providerId;

    if (input.modelId) {
      const [model] = await db.select().from(models).where(eq(models.id, input.modelId)).limit(1);
      if (model) {
        inputPricePer1k = parseFloat(model.inputPricePer1k);
        outputPricePer1k = parseFloat(model.outputPricePer1k);
        providerId = providerId ?? model.providerId;
      }
    }

    const inputCost = (input.tokensInput / 1000) * inputPricePer1k;
    const outputCost = (input.tokensOutput / 1000) * outputPricePer1k;
    const totalCost = inputCost + outputCost;

    await db.insert(costRecords).values({
      userId: input.userId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      modelId: input.modelId,
      providerId,
      tokensInput: input.tokensInput,
      tokensOutput: input.tokensOutput,
      cost: totalCost.toFixed(6),
      currency: 'USD',
    });

    // Check budgets (async via event bus in real impl)
    await checkBudgets(input.userId, totalCost);
  };

  const checkBudgets = async (userId: string | undefined, costDelta: number): Promise<void> => {
    if (!userId) return;
    const budgets = await db.select().from(costBudgets)
      .where(and(
        eq(costBudgets.userId, userId),
        eq(costBudgets.enabled, true)
      ));

    for (const budget of budgets) {
      const newSpent = parseFloat(budget.spentUsd) + costDelta;
      const limit = parseFloat(budget.limitUsd);
      await db.update(costBudgets).set({
        spentUsd: newSpent.toFixed(2),
      }).where(eq(costBudgets.id, budget.id));

      if (newSpent >= limit) {
        // Trigger event (in real impl via EventBus)
        console.warn(`[cost] Budget ${budget.id} exceeded: $${newSpent.toFixed(2)} / $${limit.toFixed(2)}`);
      }
    }
  };

  const getSummary = async (opts: GetSummaryOpts) => {
    const conditions = [];
    if (opts.userId) conditions.push(eq(costRecords.userId, opts.userId));
    if (opts.from) conditions.push(gte(costRecords.recordedAt, opts.from));
    if (opts.to) conditions.push(lte(costRecords.recordedAt, opts.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db.select({
      totalCost: sql<string>`COALESCE(SUM(${costRecords.cost}), 0)`,
      totalInputTokens: sql<number>`COALESCE(SUM(${costRecords.tokensInput}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${costRecords.tokensOutput}), 0)`,
      requestCount: sql<number>`COUNT(*)`,
    }).from(costRecords).where(where);

    const row = rows[0];
    return {
      totalCost: parseFloat(row?.totalCost ?? '0'),
      totalInputTokens: Number(row?.totalInputTokens ?? 0),
      totalOutputTokens: Number(row?.totalOutputTokens ?? 0),
      requestCount: Number(row?.requestCount ?? 0),
      period: opts.period ?? 'all',
      from: opts.from,
      to: opts.to,
    };
  };

  const getBreakdown = async (opts: GetBreakdownOpts) => {
    const conditions = [];
    if (opts.userId) conditions.push(eq(costRecords.userId, opts.userId));
    if (opts.from) conditions.push(gte(costRecords.recordedAt, opts.from));
    if (opts.to) conditions.push(lte(costRecords.recordedAt, opts.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db.select({
      label: opts.by === 'model' ? models.name : providers.name,
      totalCost: sql<string>`COALESCE(SUM(${costRecords.cost}), 0)`,
      totalInputTokens: sql<number>`COALESCE(SUM(${costRecords.tokensInput}), 0)`,
      totalOutputTokens: sql<number>`COALESCE(SUM(${costRecords.tokensOutput}), 0)`,
      requestCount: sql<number>`COUNT(*)`,
    }).from(costRecords)
      .leftJoin(models, eq(costRecords.modelId, models.id))
      .leftJoin(providers, eq(costRecords.providerId, providers.id))
      .where(where)
      .groupBy(opts.by === 'model' ? models.name : providers.name);

    return rows.map(r => ({
      label: r.label ?? 'unknown',
      totalCost: parseFloat(r.totalCost ?? '0'),
      totalInputTokens: Number(r.totalInputTokens ?? 0),
      totalOutputTokens: Number(r.totalOutputTokens ?? 0),
      requestCount: Number(r.requestCount ?? 0),
    }));
  };

  const checkBudget = async (userId: string, scope: string): Promise<BudgetStatus> => {
    const budgets = await db.select().from(costBudgets)
      .where(and(eq(costBudgets.userId, userId), eq(costBudgets.scope, scope as any)));

    if (budgets.length === 0) {
      return { hasBudget: false, remainingUsd: Infinity, limitUsd: 0, spentUsd: 0 };
    }

    const budget = budgets[0];
    return {
      hasBudget: true,
      limitUsd: parseFloat(budget.limitUsd),
      spentUsd: parseFloat(budget.spentUsd),
      remainingUsd: parseFloat(budget.limitUsd) - parseFloat(budget.spentUsd),
    };
  };

  return {
    record,
    getSummary,
    getBreakdown,
    checkBudget,
  };
}

export interface RecordCostInput {
  userId?: string;
  sessionId?: string;
  agentId?: string;
  modelId?: string;
  providerId?: string;
  tokensInput: number;
  tokensOutput: number;
}

export interface GetSummaryOpts {
  userId?: string;
  from?: Date;
  to?: Date;
  period?: 'day' | 'week' | 'month' | 'all';
}

export interface GetBreakdownOpts {
  userId?: string;
  from?: Date;
  to?: Date;
  by: 'model' | 'provider' | 'agent';
}

export interface BudgetStatus {
  hasBudget: boolean;
  limitUsd: number;
  spentUsd: number;
  remainingUsd: number;
}
