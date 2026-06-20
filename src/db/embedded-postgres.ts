/**
 * Embedded PostgreSQL Setup & Lifecycle
 *
 * Downloads and runs PostgreSQL 18 as an embedded process.
 * No sudo, no Railway, no external dependencies.
 *
 * Usage:
 *   import { startEmbeddedPostgres } from './embedded-postgres';
 *   const { db, client } = await startEmbeddedPostgres();
 */

import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load .env if not already loaded
try {
  dotenv.config();
} catch {
  // dotenv not available — assume env is loaded by Next.js
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PG_DATA_DIR || path.join(process.cwd(), 'data', 'db');
const PORT = parseInt(process.env.PG_PORT || '5433', 10);
const DB_NAME = process.env.PG_DB_NAME || 'agent_platform';
const USER = process.env.PG_USER || 'postgres';
const PASSWORD = process.env.PG_PASSWORD || 'postgres';

let instance: EmbeddedPostgres | null = null;
let started = false;

export interface EmbeddedPostgresHandle {
  instance: EmbeddedPostgres;
  connectionString: string;
  port: number;
  database: string;
  stop: () => Promise<void>;
}

export async function startEmbeddedPostgres(): Promise<EmbeddedPostgresHandle> {
  if (started && instance) {
    return {
      instance,
      connectionString: getConnectionString(),
      port: PORT,
      database: DB_NAME,
      stop: stopEmbeddedPostgres,
    };
  }

  console.log(`[embedded-pg] Starting PostgreSQL on port ${PORT}...`);

  await fs.mkdir(DATA_DIR, { recursive: true });

  const pg = new EmbeddedPostgres({
    dataDir: DATA_DIR,
    port: PORT,
    username: USER,
    password: PASSWORD,
    persistent: true,
    debug: false,
  });

  // Check if already initialised
  let needsInit = true;
  try {
    const stat = await fs.stat(path.join(DATA_DIR, 'PG_VERSION'));
    if (stat.isFile()) needsInit = false;
  } catch {
    // not initialised
  }

  if (needsInit) {
    console.log('[embedded-pg] Initialising new cluster...');
    await pg.initialise();
  }

  await pg.start();
  console.log('[embedded-pg] PostgreSQL started ✓');

  // Create database if not exists
  try {
    await pg.createDatabase(DB_NAME);
    console.log(`[embedded-pg] Database "${DB_NAME}" created`);
  } catch (err: any) {
    if (!String(err?.message || '').includes('already exists')) {
      console.warn('[embedded-pg] createDatabase warning:', err.message);
    }
  }

  // Enable required extensions
  await enableExtensions(pg);

  instance = pg;
  started = true;

  return {
    instance: pg,
    connectionString: getConnectionString(),
    port: PORT,
    database: DB_NAME,
    stop: stopEmbeddedPostgres,
  };
}

async function enableExtensions(pg: EmbeddedPostgres): Promise<void> {
  const client = pg.getPgClient(DB_NAME);
  await client.connect();
  try {
    // uuid-ossp comes pre-installed usually
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    console.log('[embedded-pg] Extension "uuid-ossp" enabled ✓');

    // pg_trgm for fast text search
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm";');
      console.log('[embedded-pg] Extension "pg_trgm" enabled ✓');
    } catch (err: any) {
      console.warn('[embedded-pg] pg_trgm not available:', err.message);
    }

    // pgvector - may need to be installed separately
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS "vector";');
      console.log('[embedded-pg] Extension "vector" (pgvector) enabled ✓');
    } catch (err: any) {
      console.warn('[embedded-pg] pgvector not available in this build. Will use JSON storage for embeddings.');
      console.warn('[embedded-pg] To enable: install pgvector or use PostgreSQL with pgvector support.');
    }
  } finally {
    await client.end();
  }
}

export function getConnectionString(): string {
  return `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}`;
}

export async function stopEmbeddedPostgres(): Promise<void> {
  if (instance && started) {
    console.log('[embedded-pg] Stopping...');
    await instance.stop();
    started = false;
    instance = null;
    console.log('[embedded-pg] Stopped ✓');
  }
}

export function isRunning(): boolean {
  return started;
}
