/**
 * Drizzle ORM Client
 *
 * Connects to PostgreSQL using DATABASE_URL.
 * Use this for all database operations.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  console.error('[db] Unexpected error on idle client', err);
});

export const db = drizzle(pool, { schema, logger: process.env.DB_LOG === 'true' });
export { schema };
export { pool as dbPool };

export type Database = typeof db;
