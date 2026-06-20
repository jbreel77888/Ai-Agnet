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
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load .env if not already loaded
try {
  dotenv.config();
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PG_DATA_DIR || path.join(process.cwd(), 'data', 'db');
const PORT = parseInt(process.env.PG_PORT || '5433', 10);
const DB_NAME = process.env.PG_DB_NAME || 'agent_platform';
const USER = process.env.PG_USER || 'postgres';
const PASSWORD = process.env.PG_PASSWORD || 'postgres';

// Get the embedded postgres binary paths
const PG_ROOT = path.join(process.cwd(), 'node_modules', '@embedded-postgres', 'linux-x64', 'native');
const PG_BIN_DIR = path.join(PG_ROOT, 'bin');
const PG_LIB_DIR = path.join(PG_ROOT, 'lib');
const PG_BINARY = path.join(PG_BIN_DIR, 'postgres');
const INITDB_BINARY = path.join(PG_BIN_DIR, 'initdb');
const USER_LIB_DIR = path.join(process.env.HOME || '/home/z', '.local', 'lib');

let postgresProcess: any = null;
let started = false;

/**
 * Build LD_LIBRARY_PATH for child processes
 */
function getLdLibraryPath(): string {
  return `${USER_LIB_DIR}:${PG_LIB_DIR}:${process.env.LD_LIBRARY_PATH || ''}`;
}

/**
 * Ensure ICU library symlinks exist (Debian 13 doesn't have ICU 60 by default)
 * The embedded-postgres package ships ICU 60.2 but the binaries look for the .60 symlink
 */
async function ensureIcuSymlinks(): Promise<void> {
  try {
    await fs.mkdir(USER_LIB_DIR, { recursive: true });

    const icuLibs = [
      { src: 'libicuuc.so.60.2', link: 'libicuuc.so.60' },
      { src: 'libicui18n.so.60.2', link: 'libicui18n.so.60' },
      { src: 'libicudata.so.60.2', link: 'libicudata.so.60' },
    ];

    for (const { src, link } of icuLibs) {
      const srcPath = path.join(PG_LIB_DIR, src);
      const linkPath = path.join(USER_LIB_DIR, link);
      try {
        await fs.unlink(linkPath);
      } catch {}
      try {
        await fs.symlink(srcPath, linkPath);
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          console.warn(`[embedded-pg] Could not create symlink ${link}:`, err.message);
        }
      }
    }
  } catch (err: any) {
    console.warn('[embedded-pg] Could not ensure ICU symlinks:', err.message);
  }
}

/**
 * Check if PostgreSQL data directory is initialized
 */
async function isInitialized(): Promise<boolean> {
  try {
    await fs.access(path.join(DATA_DIR, 'PG_VERSION'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize the PostgreSQL cluster using initdb
 */
async function initializeCluster(): Promise<void> {
  console.log('[embedded-pg] Initializing new cluster...');

  // Write password to a temp file outside the data dir (initdb requires empty data dir)
  const os = require('os');
  const passwordFile = path.join(os.tmpdir(), `.pgpass_${Date.now()}_${process.pid}`);
  await fs.writeFile(passwordFile, `${PASSWORD}\n`, { mode: 0o600 });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(INITDB_BINARY, [
        `--pgdata=${DATA_DIR}`,
        `--auth=password`,
        `--username=${USER}`,
        `--pwfile=${passwordFile}`,
      ], {
        env: {
          ...process.env,
          LD_LIBRARY_PATH: getLdLibraryPath(),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        const msg = chunk.toString();
        stderr += msg;
        console.log(`[embedded-pg] initdb: ${msg.trim()}`);
      });
      child.stdout?.on('data', (chunk) => {
        console.log(`[embedded-pg] initdb: ${chunk.toString().trim()}`);
      });

      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`initdb failed (code ${code}): ${stderr}`));
      });
      child.on('error', reject);
    });
  } finally {
    // Clean up password file
    try {
      await fs.unlink(passwordFile);
    } catch {}
  }
}

/**
 * Start the postgres server process
 */
async function startServer(): Promise<void> {
  console.log(`[embedded-pg] Starting PostgreSQL on port ${PORT}...`);

  return new Promise((resolve, reject) => {
    postgresProcess = spawn(PG_BINARY, [
      '-D', DATA_DIR,
      '-p', PORT.toString(),
      '-h', '0.0.0.0',
    ], {
      env: {
        ...process.env,
        LD_LIBRARY_PATH: getLdLibraryPath(),
      },
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, 10000);

    postgresProcess.stdout?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) console.log(`[embedded-pg] ${msg}`);
      if (msg.includes('database system is ready to accept connections') && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    postgresProcess.stderr?.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) console.log(`[embedded-pg] ${msg}`);
      if (msg.includes('database system is ready to accept connections') && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve();
      }
    });

    postgresProcess.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    postgresProcess.on('close', (code: number) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`PostgreSQL exited with code ${code} before becoming ready`));
      }
    });
  });
}

export interface EmbeddedPostgresHandle {
  connectionString: string;
  port: number;
  database: string;
  stop: () => Promise<void>;
}

export async function startEmbeddedPostgres(): Promise<EmbeddedPostgresHandle> {
  if (started && postgresProcess) {
    return {
      connectionString: getConnectionString(),
      port: PORT,
      database: DB_NAME,
      stop: stopEmbeddedPostgres,
    };
  }

  // Ensure ICU libraries are accessible
  await ensureIcuSymlinks();

  // Ensure data dir exists with correct permissions (700 required by PostgreSQL)
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.chmod(DATA_DIR, 0o700);

  // Initialize if needed
  if (!(await isInitialized())) {
    await initializeCluster();
  }

  // Start the server
  await startServer();
  console.log('[embedded-pg] PostgreSQL started ✓');

  // Create database if not exists
  await createDatabaseIfNotExists();

  // Enable extensions
  await enableExtensions();

  started = true;

  return {
    connectionString: getConnectionString(),
    port: PORT,
    database: DB_NAME,
    stop: stopEmbeddedPostgres,
  };
}

async function createDatabaseIfNotExists(): Promise<void> {
  // Connect to default 'postgres' db and create our db
  const pg = require('pg');
  const client = new pg.Client({
    connectionString: `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/postgres`,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    try {
      await client.query(`CREATE DATABASE "${DB_NAME}"`);
      console.log(`[embedded-pg] Database "${DB_NAME}" created`);
    } catch (err: any) {
      if (err.message.includes('already exists')) {
        // OK
      } else {
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

async function enableExtensions(): Promise<void> {
  const pg = require('pg');
  const client = new pg.Client(getConnectionString());

  try {
    await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    console.log('[embedded-pg] Extension "uuid-ossp" enabled ✓');

    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
      console.log('[embedded-pg] Extension "pg_trgm" enabled ✓');
    } catch (err: any) {
      console.warn('[embedded-pg] pg_trgm not available:', err.message);
    }

    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS "vector"');
      console.log('[embedded-pg] Extension "vector" (pgvector) enabled ✓');
    } catch (err: any) {
      console.warn('[embedded-pg] pgvector not available — using JSON storage for embeddings.');
    }
  } finally {
    await client.end();
  }
}

export function getConnectionString(): string {
  return `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}`;
}

export async function stopEmbeddedPostgres(): Promise<void> {
  if (postgresProcess) {
    console.log('[embedded-pg] Stopping...');
    try {
      postgresProcess.kill('SIGTERM');
      await new Promise((resolve) => {
        postgresProcess.on('close', resolve);
        setTimeout(resolve, 5000);
      });
    } catch {}
    postgresProcess = null;
    started = false;
    console.log('[embedded-pg] Stopped ✓');
  }
}

export function isRunning(): boolean {
  return started && postgresProcess !== null;
}
