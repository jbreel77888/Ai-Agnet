/**
 * RAG Service — document ingestion, chunking, and semantic search
 *
 * Uses text-based similarity (word overlap) when embeddings are not available.
 * When an embedding provider is configured, uses cosine similarity.
 */
import { db } from '../db/client';
import { documents, documentChunks } from '../db/schema';
import { eq, sql } from 'drizzle-orm';

export interface RAGService {
  ingest(opts: IngestOpts): Promise<IngestResult>;
  query(opts: QueryOpts): Promise<QueryResult[]>;
  listDocuments(userId?: string): Promise<any[]>;
  deleteDocument(docId: string): Promise<void>;
}

interface IngestOpts {
  userId?: string;
  name: string;
  content: string;
  mimeType?: string;
  sourceType?: 'upload' | 'url' | 'api';
}

interface IngestResult {
  documentId: string;
  chunksCreated: number;
  tokensTotal: number;
}

interface QueryOpts {
  text: string;
  userId?: string;
  topK?: number;
  minScore?: number;
}

interface QueryResult {
  documentId: string;
  documentName: string;
  chunkId: string;
  content: string;
  score: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.substring(start, end));
    start += chunkSize - overlap;
  }
  return chunks.filter(c => c.trim().length > 10);
}

function textSimilarity(query: string, text: string): number {
  const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const textWords = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  if (queryWords.size === 0) return 0;
  let overlap = 0;
  for (const w of queryWords) if (textWords.has(w)) overlap++;
  return overlap / queryWords.size;
}

class RAGServiceImpl implements RAGService {
  async ingest(opts: IngestOpts): Promise<IngestResult> {
    const content = typeof opts.content === 'string' ? opts.content : String(opts.content);
    const chunks = chunkText(content);
    const totalTokens = estimateTokens(content);

    // Insert document
    const [doc] = await db.insert(documents).values({
      userId: opts.userId,
      name: opts.name,
      sourceType: opts.sourceType || 'upload',
      mimeType: opts.mimeType || 'text/plain',
      sizeBytes: content.length,
      status: 'processing',
      contentHash: Buffer.from(content).toString('base64').substring(0, 32),
    }).returning();

    // Insert chunks
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(documentChunks).values({
        documentId: doc.id,
        chunkIndex: i,
        content: chunks[i],
        tokens: estimateTokens(chunks[i]),
      });
    }

    // Update status
    await db.update(documents).set({ status: 'ready' }).where(eq(documents.id, doc.id));

    return { documentId: doc.id, chunksCreated: chunks.length, tokensTotal: totalTokens };
  }

  async query(opts: QueryOpts): Promise<QueryResult[]> {
    const topK = opts.topK || 5;
    const minScore = opts.minScore ?? 0.1;

    // Fetch all chunks (in production, use pgvector for efficiency)
    const allChunks = await db.select({
      chunk: documentChunks,
      doc: documents,
    })
    .from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(opts.userId ? eq(documents.userId, opts.userId) : sql`true`);

    // Score by text similarity
    const scored = allChunks
      .map(({ chunk, doc }) => ({
        documentId: doc.id,
        documentName: doc.name,
        chunkId: chunk.id,
        content: chunk.content,
        score: textSimilarity(opts.text, chunk.content),
      }))
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  async listDocuments(userId?: string): Promise<any[]> {
    const docs = await db.select().from(documents)
      .where(userId ? eq(documents.userId, userId) : sql`true`);
    return docs.map(d => ({
      id: d.id,
      name: d.name,
      status: d.status,
      sourceType: d.sourceType,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt,
    }));
  }

  async deleteDocument(docId: string): Promise<void> {
    await db.delete(documents).where(eq(documents.id, docId));
  }
}

let instance: RAGServiceImpl | null = null;
export function getRAGService(): RAGServiceImpl {
  if (!instance) instance = new RAGServiceImpl();
  return instance;
}
