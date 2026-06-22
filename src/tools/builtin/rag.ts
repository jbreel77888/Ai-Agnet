/**
 * RAG Tools — document ingestion and semantic query.
 * ─────────────────────────────────────────────────────────────────────────────
 * rag_ingest: takes text content (from upload, URL, or direct), chunks it,
 *   generates embeddings via OpenAI, and stores in document_chunks with
 *   pgvector embedding_vec column for fast similarity search.
 *
 * rag_query: takes a query, generates embedding, searches document_chunks
 *   using pgvector cosine similarity (HNSW indexed), returns top-K results.
 */
import type { ITool } from '../registry';
import type { ToolResult, ToolContext } from '../../types';
import { embedText, embedBatch, embeddingToPgVector } from '../../embeddings';

// ─────────────────────────────────────────────────────────────────────────────
// Chunking — splits text into overlapping chunks for better retrieval
// ─────────────────────────────────────────────────────────────────────────────
function chunkText(text: string, chunkSize = 1000, overlap = 200): string[] {
  if (!text || text.trim().length === 0) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    // Try to break at a sentence or paragraph boundary
    let chunk = text.substring(start, end);
    if (end < text.length) {
      // Look for a sentence boundary near the end
      const lastSentence = chunk.lastIndexOf('. ');
      if (lastSentence > chunkSize * 0.5) {
        chunk = text.substring(start, start + lastSentence + 1);
        start = start + lastSentence + 1 - overlap;
      } else {
        start = end - overlap;
      }
    } else {
      start = end;
    }
    if (chunk.trim().length > 20) {
      chunks.push(chunk.trim());
    }
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// rag_ingest tool
// ─────────────────────────────────────────────────────────────────────────────
export class RagIngestTool implements ITool {
  readonly name = 'rag_ingest';
  readonly description = 'Ingest a document into the RAG knowledge base. The text is chunked, embedded using OpenAI text-embedding-3-small, and stored for semantic search. Use this to build a knowledge base the agent can query later.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Document name (e.g., "API Docs", "User Manual")' },
      content: { type: 'string', description: 'The text content to ingest' },
      sourceType: { type: 'string', enum: ['upload', 'url', 'api'], default: 'api' },
      sourceUrl: { type: 'string', description: 'Optional: source URL if from web' },
      chunkSize: { type: 'integer', minimum: 200, maximum: 4000, default: 1000 },
    },
    required: ['name', 'content'],
    additionalProperties: false,
  };

  validate(args: any) {
    if (!args?.name) return { valid: false, errors: ['name is required'] };
    if (!args?.content) return { valid: false, errors: ['content is required'] };
    if (typeof args.content !== 'string') return { valid: false, errors: ['content must be a string'] };
    if (args.content.length > 500000) return { valid: false, errors: ['content too large (max 500KB)'] };
    return { valid: true };
  }

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
      try {
        // 1. Insert document record
        const docResult = await pool.query(
          `INSERT INTO documents (user_id, name, source_type, source_url, mime_type, size_bytes, status, content_hash)
           VALUES ($1, $2, $3, $4, 'text/plain', $5, 'processing', $6)
           RETURNING id`,
          [
            ctx.userId || null,
            args.name,
            args.sourceType || 'api',
            args.sourceUrl || null,
            args.content.length,
            args.content.substring(0, 32), // simple hash
          ]
        );
        const docId = docResult.rows[0].id;

        // 2. Chunk the text
        const chunks = chunkText(args.content, args.chunkSize || 1000, 200);
        if (chunks.length === 0) {
          await pool.query(`UPDATE documents SET status = 'failed' WHERE id = $1`, [docId]);
          return { success: false, error: { code: 'NO_CHUNKS', message: 'No valid chunks generated from content' } };
        }

        // 3. Generate embeddings in batches (max 100 per OpenAI API call)
        const embeddings = await embedBatch(chunks);

        // 4. Insert chunks with embeddings
        let embeddedCount = 0;
        for (let i = 0; i < chunks.length; i++) {
          const emb = embeddings[i];
          const embVecStr = emb ? embeddingToPgVector(emb) : null;
          try {
            await pool.query(
              `INSERT INTO document_chunks (document_id, chunk_index, content, tokens, embedding, embedding_vec)
               VALUES ($1, $2, $3, $4, $5, $6::vector)`,
              [
                docId,
                i,
                chunks[i],
                Math.ceil(chunks[i].length / 4), // ~4 chars per token
                emb ? JSON.stringify(emb) : null,
                embVecStr,
              ]
            );
            if (emb) embeddedCount++;
          } catch (insertErr: any) {
            console.warn(`[rag_ingest] Chunk ${i} insert failed:`, insertErr.message);
            // Try without vector
            await pool.query(
              `INSERT INTO document_chunks (document_id, chunk_index, content, tokens, embedding)
               VALUES ($1, $2, $3, $4, $5)`,
              [docId, i, chunks[i], Math.ceil(chunks[i].length / 4), emb ? JSON.stringify(emb) : null]
            ).catch(() => {});
          }
        }

        // 5. Update document status
        await pool.query(`UPDATE documents SET status = 'ready' WHERE id = $1`, [docId]);

        return {
          success: true,
          data: {
            documentId: docId,
            documentName: args.name,
            chunksCreated: chunks.length,
            chunksEmbedded: embeddedCount,
            embeddingModel: embeddedCount > 0 ? 'text-embedding-3-small' : null,
            tokensEstimated: chunks.reduce((sum, c) => sum + Math.ceil(c.length / 4), 0),
          },
        };
      } finally {
        await pool.end();
      }
    } catch (err: any) {
      return { success: false, error: { code: 'RAG_INGEST_ERROR', message: err.message } };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// rag_query tool
// ─────────────────────────────────────────────────────────────────────────────
export class RagQueryTool implements ITool {
  readonly name = 'rag_query';
  readonly description = 'Query the RAG knowledge base using SEMANTIC search. Finds the most relevant document chunks using vector similarity (cosine). Returns chunks with similarity scores. Use this to retrieve information from ingested documents.';
  readonly category = 'builtin';
  readonly schema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The question or topic to search for' },
      topK: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
      minScore: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
    },
    required: ['query'],
    additionalProperties: false,
  };

  validate(args: any) {
    if (!args?.query) return { valid: false, errors: ['query is required'] };
    if (typeof args.query !== 'string') return { valid: false, errors: ['query must be a string'] };
    if (args.query.length > 2000) return { valid: false, errors: ['query too long (max 2000 chars)'] };
    return { valid: true };
  }

  async execute(args: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      const topK = args.topK || 5;
      const minScore = args.minScore ?? 0.3;

      // Generate query embedding
      const queryEmbedding = await embedText(args.query);

      const { Pool } = require('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
      try {
        let results: any[];

        if (queryEmbedding) {
          // Semantic search using pgvector
          const vecStr = embeddingToPgVector(queryEmbedding);
          const res = await pool.query(
            `SELECT dc.id, dc.content, dc.tokens,
                    d.name AS document_name, d.id AS document_id,
                    1 - (dc.embedding_vec <=> $1::vector) AS score
             FROM document_chunks dc
             INNER JOIN documents d ON dc.document_id = d.id
             WHERE dc.embedding_vec IS NOT NULL
               AND d.status = 'ready'
               ${ctx.userId ? 'AND (d.user_id = $2 OR d.user_id IS NULL)' : ''}
             ORDER BY dc.embedding_vec <=> $1::vector
             LIMIT $${ctx.userId ? '3' : '2'}`,
            ctx.userId ? [vecStr, ctx.userId, topK] : [vecStr, topK]
          );
          results = res.rows.filter((r: any) => parseFloat(r.score) >= minScore);
        } else {
          // Fallback: keyword search
          const res = await pool.query(
            `SELECT dc.id, dc.content, dc.tokens,
                    d.name AS document_name, d.id AS document_id,
                    0.5 AS score
             FROM document_chunks dc
             INNER JOIN documents d ON dc.document_id = d.id
             WHERE d.status = 'ready'
               ${ctx.userId ? 'AND (d.user_id = $2 OR d.user_id IS NULL)' : ''}
               AND dc.content ILIKE '%' || $1 || '%'
             ORDER BY dc.chunk_index
             LIMIT $${ctx.userId ? '3' : '2'}`,
            ctx.userId ? [args.query, ctx.userId, topK] : [args.query, topK]
          );
          results = res.rows;
        }

        return {
          success: true,
          data: {
            results: results.map((r: any) => ({
              documentId: r.document_id,
              documentName: r.document_name,
              content: r.content,
              tokens: r.tokens,
              score: parseFloat(r.score),
            })),
            count: results.length,
            query: args.query,
            searchMode: queryEmbedding ? 'semantic' : 'keyword',
          },
        };
      } finally {
        await pool.end();
      }
    } catch (err: any) {
      return { success: false, error: { code: 'RAG_QUERY_ERROR', message: err.message } };
    }
  }
}
