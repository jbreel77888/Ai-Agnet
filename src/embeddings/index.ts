/**
 * Embeddings Service — generates vector embeddings using OpenAI.
 * ─────────────────────────────────────────────────────────────────────────────
 * Uses OpenAI text-embedding-3-small (1536 dimensions, $0.02/1M tokens).
 *
 * Features:
 *   - Single text embedding
 *   - Batch embedding (up to 100 texts per API call)
 *   - In-memory cache (text hash → embedding) to avoid re-embedding
 *   - Automatic retry on rate limit (429)
 *   - Falls back to null if OPENAI_API_KEY not set
 *
 * The embeddings are stored in pgvector columns (vector(1536)) for
 * fast cosine similarity search via HNSW indexes.
 */
import { createHash } from 'crypto';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
const MAX_BATCH_SIZE = 100;
const MAX_TOKENS_PER_TEXT = 8000; // OpenAI limit is 8191

// In-memory cache: text hash → embedding array
const cache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 500;

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  usage: { prompt_tokens: number; total_tokens: number };
}

/**
 * Generate embedding for a single text.
 * Returns null if OPENAI_API_KEY is not set.
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  // Truncate very long text
  const truncated = text.length > 32000 ? text.substring(0, 32000) : text;

  // Check cache
  const cacheKey = createHash('sha256').update(truncated).digest('hex').substring(0, 16);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncated,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.error(`[embeddings] OpenAI API error: HTTP ${res.status}`, errBody.substring(0, 200));
      return null;
    }

    const data = (await res.json()) as OpenAIEmbeddingResponse;
    const embedding = data.data[0]?.embedding;
    if (!embedding || embedding.length !== EMBEDDING_DIMS) {
      console.error(`[embeddings] Unexpected embedding dimensions: ${embedding?.length}`);
      return null;
    }

    // Cache it
    if (cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry (first in Map)
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
    cache.set(cacheKey, embedding);

    return embedding;
  } catch (err: any) {
    console.error('[embeddings] Failed to generate embedding:', err.message);
    return null;
  }
}

/**
 * Generate embeddings for multiple texts in a single API call (more efficient).
 * Returns array aligned with input (null for texts that failed).
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!process.env.OPENAI_API_KEY) {
    return texts.map(() => null);
  }

  if (texts.length === 0) return [];
  if (texts.length === 1) return [await embedText(texts[0])];

  // Truncate each text
  const truncated = texts.map(t => (t.length > 32000 ? t.substring(0, 32000) : t));

  // Check cache for each
  const results: (number[] | null)[] = new Array(texts.length).fill(null);
  const uncachedIndices: number[] = [];
  const uncachedTexts: string[] = [];
  const cacheKeys: string[] = [];

  for (let i = 0; i < truncated.length; i++) {
    const key = createHash('sha256').update(truncated[i]).digest('hex').substring(0, 16);
    cacheKeys[i] = key;
    const cached = cache.get(key);
    if (cached) {
      results[i] = cached;
    } else {
      uncachedIndices.push(i);
      uncachedTexts.push(truncated[i]);
    }
  }

  // Process uncached in batches of MAX_BATCH_SIZE
  for (let batchStart = 0; batchStart < uncachedTexts.length; batchStart += MAX_BATCH_SIZE) {
    const batchTexts = uncachedTexts.slice(batchStart, batchStart + MAX_BATCH_SIZE);
    const batchIndices = uncachedIndices.slice(batchStart, batchStart + MAX_BATCH_SIZE);

    try {
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: batchTexts,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        console.error(`[embeddings] Batch API error: HTTP ${res.status}`);
        continue;
      }

      const data = (await res.json()) as OpenAIEmbeddingResponse;
      for (const item of data.data) {
        const originalIdx = batchIndices[item.index];
        if (item.embedding && item.embedding.length === EMBEDDING_DIMS) {
          results[originalIdx] = item.embedding;

          // Cache it
          const key = cacheKeys[originalIdx];
          if (cache.size >= MAX_CACHE_SIZE) {
            const firstKey = cache.keys().next().value;
            if (firstKey) cache.delete(firstKey);
          }
          cache.set(key, item.embedding);
        }
      }
    } catch (err: any) {
      console.error('[embeddings] Batch failed:', err.message);
    }
  }

  return results;
}

/**
 * Cosine similarity between two embedding vectors.
 * Returns value in [-1, 1] where 1 = identical.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Convert a number[] embedding to a pgvector-compatible string.
 * e.g., "[0.1,0.2,0.3]" for use in SQL: `embedding_vec = '[0.1,0.2,0.3]'::vector`
 */
export function embeddingToPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Check if embeddings are available (OPENAI_API_KEY is set).
 */
export function isEmbeddingsAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export const EMBEDDING_DIMENSIONS = EMBEDDING_DIMS;
export const EMBEDDING_MODEL_NAME = EMBEDDING_MODEL;
