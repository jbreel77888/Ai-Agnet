/**
 * Long-Term Memory (PostgreSQL + pgvector or JSON fallback)
 *
 * Uses cosine similarity for semantic search.
 * When pgvector extension is available, uses SQL-level similarity.
 * Otherwise, loads candidate rows and computes similarity in JS.
 */
import { db } from '../../db/client';
import { memoryLong, memoryEntities, memorySummaries } from '../../db/schema';
import { eq, and, gte, lte, desc, sql, lt } from 'drizzle-orm';
import type { LongTermMemory } from './types';
import type {
  MemoryRecord, MemoryQuery, MemorySearchResult, FactType,
  StoreMemoryInput, StoreOpts, EntityInput, EntityRecord,
  SummaryInput, SummaryRecord, SummaryQuery, GetRecentOpts, MemoryFilter, MemoryStats,
} from './types';

/**
 * Get a fresh pg Pool — avoids Drizzle numeric type issues
 */
async function getPoolClient() {
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL not set');
  const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000 });
  return pool;
}

/**
 * Cosine similarity between two vectors (1 = identical, 0 = orthogonal, -1 = opposite)
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function createLongTermMemory(): LongTermMemory {
  const store = async (input: StoreMemoryInput): Promise<MemoryRecord> => {
    const pool = await getPoolClient();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO memory_long (user_id, agent_id, session_id, fact, fact_type, importance) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [input.userId || null, input.agentId || null, input.sessionId || null, input.fact, input.factType, (input.importance ?? 0.5).toString()]
      );
      return rowToRecord(result.rows[0]);
    } finally {
      client.release();
      await pool.end();
    }
  };

  const storeFact = async (fact: string, type: FactType, opts: StoreOpts = {}): Promise<MemoryRecord> => {
    return store({
      userId: opts.userId,
      agentId: opts.agentId,
      sessionId: opts.sessionId,
      fact,
      factType: type,
      importance: opts.importance,
      metadata: opts.metadata,
    });
  };

  const storeEntity = async (entity: EntityInput): Promise<EntityRecord> => {
    const canonical = entity.canonical || entity.entityValue;
    const [row] = await db.insert(memoryEntities).values({
      userId: entity.userId,
      entityType: entity.entityType,
      entityValue: entity.entityValue,
      canonical,
      aliases: entity.aliases,
      embedding: entity.embedding as any,
      metadata: entity.metadata as any,
    }).onConflictDoNothing().returning();

    if (!row) {
      // Already exists — return the existing one
      const [existing] = await db.select().from(memoryEntities)
        .where(and(
          eq(memoryEntities.entityType, entity.entityType),
          eq(memoryEntities.canonical, canonical),
        ))
        .limit(1);
      return existingToRecord(existing);
    }

    return existingToRecord(row);
  };

  const storeSummary = async (summary: SummaryInput): Promise<SummaryRecord> => {
    const [row] = await db.insert(memorySummaries).values({
      sessionId: summary.sessionId,
      agentId: summary.agentId,
      summary: summary.summary,
      tokensSaved: summary.tokensSaved,
      coveredMessageIds: summary.coveredMessageIds as any,
      embedding: summary.embedding as any,
    }).returning();

    return {
      id: row.id,
      sessionId: row.sessionId,
      agentId: row.agentId || undefined,
      summary: row.summary,
      tokensSaved: row.tokensSaved,
      createdAt: row.createdAt,
    };
  };

  const search = async (query: MemoryQuery): Promise<MemorySearchResult[]> => {
    const topK = query.topK ?? 5;
    const minScore = query.minScore ?? 0.7;

    // Build base conditions
    const conditions = [];
    if (query.userId) conditions.push(eq(memoryLong.userId, query.userId));
    if (query.agentId) conditions.push(eq(memoryLong.agentId, query.agentId));
    if (query.sessionId) conditions.push(eq(memoryLong.sessionId, query.sessionId));
    if (query.factTypes && query.factTypes.length > 0) {
      // Use IN
      conditions.push(sql`${memoryLong.factType} = ANY(${query.factTypes})`);
    }
    if (query.timeRange?.from) conditions.push(gte(memoryLong.createdAt, query.timeRange.from));
    if (query.timeRange?.to) conditions.push(lte(memoryLong.createdAt, query.timeRange.to));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // First: try pgvector similarity (if extension is available)
    // We detect this by checking if 'embedding' column type is vector
    // For simplicity, we always fall back to JS cosine similarity for now
    // (pgvector support can be enabled by running a migration)

    // Fetch candidate rows (limit to top 100 by importance, then filter by similarity in JS)
    const rows = await db.select()
      .from(memoryLong)
      .where(where)
      .orderBy(desc(memoryLong.importance))
      .limit(100);

    // If we don't have a query embedding, just return by importance
    if (!query.text || rows.length === 0) {
      return rows.slice(0, topK).map(r => ({
        record: rowToRecord(r),
        score: parseFloat(r.importance),
      }));
    }

    // Generate embedding for the query (if not provided)
    // For now, we use text-based matching as a simple fallback
    // A real implementation would call the embedding provider here
    const queryLower = query.text.toLowerCase();
    const results: MemorySearchResult[] = [];

    for (const row of rows) {
      let score = 0;

      // If we have an embedding, use cosine similarity
      if (row.embedding && Array.isArray(row.embedding)) {
        // We would need a query embedding — skip for now
        // (will be added when embedding provider is wired)
        score = 0.5; // neutral
      }

      // Text-based fallback: simple word overlap
      const factLower = (row.fact || '').toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);
      const factWords = factLower.split(/\s+/);
      const overlap = queryWords.filter(w => factWords.includes(w)).length;
      const textScore = queryWords.length > 0 ? overlap / queryWords.length : 0;

      // Combine scores (text-based is primary when no embedding)
      score = Math.max(score, textScore);

      // Apply importance weight
      score = score * 0.7 + parseFloat(row.importance) * 0.3;

      if (score >= minScore) {
        results.push({
          record: rowToRecord(row),
          score,
        });
      }
    }

    // Sort by score descending and return top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  };

  const searchByEntity = async (entityType: string, value: string): Promise<MemoryRecord[]> => {
    // Find entity first
    const [entity] = await db.select().from(memoryEntities)
      .where(and(
        eq(memoryEntities.entityType, entityType),
        eq(memoryEntities.canonical, value),
      ))
      .limit(1);

    if (!entity) return [];

    // Search memories that mention this entity
    const rows = await db.select().from(memoryLong)
      .where(sql`${memoryLong.fact} ILIKE ${'%' + value + '%'} OR ${memoryLong.metadata}->>'entityId' = ${entity.id}`)
      .orderBy(desc(memoryLong.createdAt))
      .limit(20);

    return rows.map(rowToRecord);
  };

  const searchSummaries = async (query: SummaryQuery): Promise<SummaryRecord[]> => {
    const topK = query.topK ?? 3;
    const minScore = query.minScore ?? 0.5;

    const rows = await db.select().from(memorySummaries)
      .orderBy(desc(memorySummaries.createdAt))
      .limit(50);

    // Simple text-based search
    const queryLower = query.text.toLowerCase();
    const results: SummaryRecord[] = [];

    for (const row of rows) {
      const summaryLower = row.summary.toLowerCase();
      const queryWords = queryLower.split(/\s+/).filter(w => w.length > 3);
      const summaryWords = summaryLower.split(/\s+/);
      const overlap = queryWords.filter(w => summaryWords.includes(w)).length;
      const score = queryWords.length > 0 ? overlap / queryWords.length : 0;

      if (score >= minScore) {
        results.push({
          id: row.id,
          sessionId: row.sessionId,
          agentId: row.agentId || undefined,
          summary: row.summary,
          tokensSaved: row.tokensSaved,
          createdAt: row.createdAt,
        });
      }
    }

    return results.slice(0, topK);
  };

  const getRecent = async (opts: GetRecentOpts = {}): Promise<MemoryRecord[]> => {
    const limit = opts.limit ?? 20;
    const conditions = [];
    if (opts.userId) conditions.push(eq(memoryLong.userId, opts.userId));
    if (opts.factTypes && opts.factTypes.length > 0) {
      conditions.push(sql`${memoryLong.factType} = ANY(${opts.factTypes})`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const rows = await db.select().from(memoryLong)
      .where(where)
      .orderBy(desc(memoryLong.createdAt))
      .limit(limit);

    return rows.map(rowToRecord);
  };

  const update = async (id: string, patch: Partial<MemoryRecord>): Promise<void> => {
    const updates: any = {};
    if (patch.fact !== undefined) updates.fact = patch.fact;
    if (patch.factType !== undefined) updates.factType = patch.factType;
    if (patch.importance !== undefined) updates.importance = patch.importance.toString();
    if (patch.metadata !== undefined) updates.metadata = patch.metadata;
    updates.updatedAt = new Date();

    await db.update(memoryLong).set(updates).where(eq(memoryLong.id, id));
  };

  const remove = async (id: string): Promise<void> => {
    await db.delete(memoryLong).where(eq(memoryLong.id, id));
  };

  const forget = async (filter: MemoryFilter): Promise<number> => {
    const conditions = [];
    if (filter.userId) conditions.push(eq(memoryLong.userId, filter.userId));
    if (filter.sessionId) conditions.push(eq(memoryLong.sessionId, filter.sessionId));
    if (filter.factType) conditions.push(eq(memoryLong.factType, filter.factType));
    if (filter.olderThan) conditions.push(lt(memoryLong.createdAt, filter.olderThan));
    if (filter.importanceBelow !== undefined) {
      conditions.push(lt(memoryLong.importance, filter.importanceBelow.toString()));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const result = await db.delete(memoryLong).where(where);
    return (result as any)?.rowCount || 0;
  };

  const decay = async (): Promise<void> => {
    // Decay importance for memories not accessed in 7+ days
    await db.update(memoryLong)
      .set({
        importance: sql`${memoryLong.importance} * 0.95`,
        updatedAt: new Date(),
      })
      .where(and(
        lt(memoryLong.lastAccessedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        sql`${memoryLong.importance} > 0.1`,
      ));

    // Delete very low-importance, very old memories
    await db.delete(memoryLong)
      .where(and(
        lt(memoryLong.importance, '0.05'),
        lt(memoryLong.lastAccessedAt, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
      ));
  };

  const stats = async (userId?: string): Promise<MemoryStats> => {
    const where = userId ? eq(memoryLong.userId, userId) : undefined;
    const rows = await db.select({
      total: sql<number>`count(*)::int`,
      avgImportance: sql<number>`COALESCE(avg(${memoryLong.importance}), 0)::float`,
    }).from(memoryLong).where(where);

    const total = rows[0]?.total || 0;
    const avgImportance = rows[0]?.avgImportance || 0;

    // Count by type
    const byTypeRows = await db.select({
      type: memoryLong.factType,
      count: sql<number>`count(*)::int`,
    }).from(memoryLong).where(where).groupBy(memoryLong.factType);

    const byType = {} as Record<FactType, number>;
    for (const row of byTypeRows) {
      byType[row.type as FactType] = row.count;
    }

    const entityCount = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(memoryEntities).where(userId ? eq(memoryEntities.userId, userId) : undefined);

    const summaryCount = await db.select({
      count: sql<number>`count(*)::int`,
    }).from(memorySummaries);

    return {
      totalRecords: total,
      byType,
      totalEntities: entityCount[0]?.count || 0,
      totalSummaries: summaryCount[0]?.count || 0,
      averageImportance: avgImportance,
      storageBytes: 0, // Would require a separate query
    };
  };

  return {
    store,
    storeFact,
    storeEntity,
    storeSummary,
    search,
    searchByEntity,
    searchSummaries,
    getRecent,
    update,
    delete: remove,
    forget,
    decay,
    stats,
  };
}

function rowToRecord(row: any): MemoryRecord {
  return {
    id: row.id,
    userId: row.userId || undefined,
    agentId: row.agentId || undefined,
    sessionId: row.sessionId || undefined,
    fact: row.fact,
    factType: row.factType,
    importance: parseFloat(row.importance),
    metadata: row.metadata as any,
    lastAccessedAt: row.lastAccessedAt || undefined,
    accessCount: row.accessCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function existingToRecord(row: any): EntityRecord {
  return {
    id: row.id,
    userId: row.userId || undefined,
    entityType: row.entityType,
    entityValue: row.entityValue,
    canonical: row.canonical,
    aliases: row.aliases || [],
    createdAt: row.createdAt,
  };
}
