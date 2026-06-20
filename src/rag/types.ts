/**
 * RAG Service interface
 */
import type { JSONSchema } from '../../types';

export interface RAGService {
  ingest(opts: IngestOpts): Promise<IngestResult>;
  query(opts: QueryOpts): Promise<QueryResult[]>;
  getDocument(docId: string): Promise<Document | undefined>;
  listDocuments(opts?: ListDocsOpts): Promise<Document[]>;
  deleteDocument(docId: string): Promise<void>;
  reembedAll(modelName?: string): Promise<ReembedJob>;
}

export interface IngestOpts {
  userId?: string;
  name: string;
  sourceType: 'upload' | 'url' | 'api' | 'integration';
  sourceUrl?: string;
  mimeType?: string;
  content: Buffer | string;
  chunkStrategy?: ChunkStrategy;
  metadata?: Record<string, unknown>;
}

export interface ChunkStrategy {
  type: 'fixed' | 'sentence' | 'recursive' | 'semantic';
  chunkSize?: number;       // tokens
  chunkOverlap?: number;    // tokens
  separator?: string;
}

export interface IngestResult {
  document: Document;
  chunksCreated: number;
  tokensTotal: number;
  durationMs: number;
}

export interface Document {
  id: string;
  userId?: string;
  name: string;
  sourceType: 'upload' | 'url' | 'api' | 'integration';
  sourceUrl?: string;
  mimeType?: string;
  sizeBytes: number;
  contentHash?: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface QueryOpts {
  text: string;
  userId?: string;
  documentIds?: string[];
  topK?: number;
  minScore?: number;
  includeContent?: boolean;
}

export interface QueryResult {
  documentId: string;
  documentName: string;
  chunkId: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface ListDocsOpts {
  userId?: string;
  status?: Document['status'];
  limit?: number;
}

export interface ReembedJob {
  jobId: string;
  totalDocuments: number;
  estimatedDurationMs: number;
}
