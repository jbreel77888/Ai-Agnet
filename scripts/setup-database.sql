-- ============================================================
-- Agent Platform — PostgreSQL Setup Script
-- Run this manually on your PostgreSQL instance (Railway, local, etc.)
-- ============================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";          -- for uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "vector";              -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS "pg_trgm";             -- fast text search

-- Verify extensions installed
SELECT extname, extversion FROM pg_extension WHERE extname IN ('uuid-ossp', 'vector', 'pg_trgm');

-- ============================================================
-- After running this script:
-- 1. Set DATABASE_URL in your environment
-- 2. Run: bun run db:generate
-- 3. Run: bun run db:migrate
-- ============================================================

-- Note: ivfflat indexes for memory_long, document_chunks, memory_entities
-- will be created automatically by Drizzle migrations.
-- For optimal performance after data load, run:
-- ANALYZE memory_long;
-- ANALYZE document_chunks;
