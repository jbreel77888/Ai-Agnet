/**
 * Cost Tracker interface
 */
export interface CostTracker {
  record(input: {
    userId?: string;
    sessionId?: string;
    agentId?: string;
    modelId?: string;
    providerId?: string;
    tokensInput: number;
    tokensOutput: number;
  }): Promise<void>;

  getSummary(opts: {
    userId?: string;
    from?: Date;
    to?: Date;
    period?: 'day' | 'week' | 'month' | 'all';
  }): Promise<{
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    requestCount: number;
    period: string;
    from?: Date;
    to?: Date;
  }>;

  getBreakdown(opts: {
    userId?: string;
    from?: Date;
    to?: Date;
    by: 'model' | 'provider' | 'agent';
  }): Promise<Array<{
    label: string;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    requestCount: number;
  }>>;

  checkBudget(userId: string, scope: string): Promise<{
    hasBudget: boolean;
    limitUsd: number;
    spentUsd: number;
    remainingUsd: number;
  }>;
}
