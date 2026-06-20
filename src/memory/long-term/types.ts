/**
 * Long-Term Memory interface (PostgreSQL + pgvector)
 */
import type {
  MemoryRecord, MemoryQuery, MemorySearchResult, FactType,
} from '../../../types';

export interface LongTermMemory {
  // Storage
  store(input: StoreMemoryInput): Promise<MemoryRecord>;
  storeFact(fact: string, type: FactType, opts?: StoreOpts): Promise<MemoryRecord>;
  storeEntity(entity: EntityInput): Promise<EntityRecord>;
  storeSummary(summary: SummaryInput): Promise<SummaryRecord>;

  // Retrieval
  search(query: MemoryQuery): Promise<MemorySearchResult[]>;
  searchByEntity(entityType: string, value: string): Promise<MemoryRecord[]>;
  searchSummaries(query: SummaryQuery): Promise<SummaryRecord[]>;
  getRecent(opts: GetRecentOpts): Promise<MemoryRecord[]>;

  // Management
  update(id: string, patch: Partial<MemoryRecord>): Promise<void>;
  delete(id: string): Promise<void>;
  forget(filter: MemoryFilter): Promise<number>;
  decay(): Promise<void>;

  // Stats
  stats(userId?: string): Promise<MemoryStats>;
}

export interface StoreMemoryInput {
  userId?: string;
  agentId?: string;
  sessionId?: string;
  fact: string;
  factType: FactType;
  importance?: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface StoreOpts {
  userId?: string;
  agentId?: string;
  sessionId?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface EntityInput {
  userId?: string;
  entityType: string;
  entityValue: string;
  canonical?: string;
  aliases?: string[];
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface EntityRecord {
  id: string;
  userId?: string;
  entityType: string;
  entityValue: string;
  canonical: string;
  aliases: string[];
  createdAt: Date;
}

export interface SummaryInput {
  sessionId: string;
  agentId?: string;
  summary: string;
  tokensSaved: number;
  coveredMessageIds: string[];
  embedding?: number[];
}

export interface SummaryRecord {
  id: string;
  sessionId: string;
  agentId?: string;
  summary: string;
  tokensSaved: number;
  createdAt: Date;
}

export interface SummaryQuery {
  text: string;
  userId?: string;
  topK?: number;
  minScore?: number;
}

export interface GetRecentOpts {
  userId?: string;
  limit?: number;
  factTypes?: FactType[];
}

export interface MemoryFilter {
  userId?: string;
  sessionId?: string;
  factType?: FactType;
  olderThan?: Date;
  importanceBelow?: number;
}

export interface MemoryStats {
  totalRecords: number;
  byType: Record<FactType, number>;
  totalEntities: number;
  totalSummaries: number;
  averageImportance: number;
  storageBytes: number;
}
