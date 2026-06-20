/**
 * Node.js-only instrumentation — runs once on server startup
 *
 * This file is dynamically imported from instrumentation.ts only when
 * running in Node.js runtime (NOT Edge).
 */

// Load .env first thing (before any other logic)
try {
  require('dotenv').config();
} catch {
  // dotenv not available
}

export async function registerNode(): Promise<void> {
  try {
    if (process.env.PG_AUTO_START === 'false' || process.env.NODE_ENV === 'production') {
      // Production mode: use external DATABASE_URL (Railway Postgres)
      console.log('[instrumentation:node] Production mode — using external DATABASE_URL');
      const dbUrl = process.env.DATABASE_URL;
      if (!dbUrl) {
        console.error('[instrumentation:node] DATABASE_URL not set!');
        return;
      }
      // Run migrations on external DB
      await applyMigrations(dbUrl);
      await seedInitialData(dbUrl);
    } else {
      // Development mode: use embedded PostgreSQL
      await startEmbeddedPostgres();
    }
  } catch (err) {
    console.error('[instrumentation:node] FATAL:', err);
    // In production, don't crash — let Next.js continue
    if (process.env.NODE_ENV === 'production') {
      console.error('[instrumentation:node] Continuing despite error (production mode)');
    }
  }
}

async function startEmbeddedPostgres(): Promise<void> {
  // Skip if explicitly disabled
  if (process.env.PG_AUTO_START === 'false') {
    console.log('[instrumentation:node] PG_AUTO_START=false, skipping embedded PG');
    return;
  }

  // Set LD_LIBRARY_PATH for ICU libs (Debian 13 compatibility)
  const path = require('path');
  const pgLibPath = path.join(process.cwd(), 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'lib');
  const userLibPath = path.join(process.env.HOME || '/home/z', '.local', 'lib');
  process.env.LD_LIBRARY_PATH = `${userLibPath}:${pgLibPath}:${process.env.LD_LIBRARY_PATH || ''}`;

  console.log('[instrumentation:node] Starting embedded PostgreSQL...');
  const { startEmbeddedPostgres } = await import('./db/embedded-postgres');
  const handle = await startEmbeddedPostgres();
  console.log(`[instrumentation:node] ✓ PostgreSQL ready at ${handle.connectionString}`);

  // ALWAYS set DATABASE_URL to embedded PG (overrides any stale env from sandbox)
  if (process.env.DATABASE_URL !== handle.connectionString) {
    console.log(`[instrumentation:node] Updating DATABASE_URL from "${process.env.DATABASE_URL}" to "${handle.connectionString}"`);
    process.env.DATABASE_URL = handle.connectionString;
  }

  // Always run migration logic (it handles reset + apply + verify)
  await applyMigrations(handle.connectionString);

  // Run seed data if needed (admin user, roles, permissions)
  await seedInitialData(handle.connectionString);

  // Verify final state
  const pg = require('pg');
  const verifyClient = new pg.Client(handle.connectionString);
  await verifyClient.connect();
  const result = await verifyClient.query('SELECT count(*) FROM pg_tables WHERE schemaname = $1', ['public']);
  const tableCount = parseInt(result.rows[0].count, 10);
  console.log(`[instrumentation:node] ✓ Final table count: ${tableCount}`);
  await verifyClient.end();
}

async function seedInitialData(connectionString: string): Promise<void> {
  const pg = require('pg');
  const client = new pg.Client(connectionString);
  await client.connect();

  try {
    // Check if already seeded
    const r = await client.query("SELECT count(*) FROM information_schema.tables WHERE table_name='users'");
    if (parseInt(r.rows[0].count, 10) === 0) {
      console.log('[instrumentation:node] Users table not found — skipping seed');
      return;
    }

    const usersCount = await client.query('SELECT count(*) FROM users');
    if (parseInt(usersCount.rows[0].count, 10) > 0) {
      console.log('[instrumentation:node] ✓ Seed data already present');
      return;
    }

    console.log('[instrumentation:node] Seeding initial data...');

    // Create roles
    for (const role of [
      { name: 'admin', description: 'Full system access' },
      { name: 'operator', description: 'Manage agents, tools, sessions' },
      { name: 'user', description: 'Use the platform only' },
    ]) {
      await client.query(
        `INSERT INTO roles (name, description, is_system) VALUES ($1, $2, true) ON CONFLICT (name) DO NOTHING`,
        [role.name, role.description]
      );
    }
    console.log('[instrumentation:node] ✓ Roles created');

    // Create default admin user (password: admin123)
    // Hash with scrypt
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync('admin123', salt, 64).toString('hex');
    const passwordHash = `scrypt$${salt}$${hash}`;

    await client.query(
      `INSERT INTO users (email, password_hash, name, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (email) DO NOTHING`,
      ['admin@agent-platform.local', passwordHash, 'System Admin']
    );

    // Assign admin role to admin user
    await client.query(`
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.id FROM users u, roles r
      WHERE u.email = 'admin@agent-platform.local' AND r.name = 'admin'
      ON CONFLICT DO NOTHING
    `);

    console.log('[instrumentation:node] ✓ Default admin user created:');
    console.log('    Email: admin@agent-platform.local');
    console.log('    Password: admin123');
    console.log('    ⚠️  Change password after first login!');
  } catch (err: any) {
    console.error('[instrumentation:node] Seed error:', err.message);
  } finally {
    await client.end();
  }
}

async function applyMigrations(connectionString: string): Promise<void> {
  const path = require('path');
  const fs = require('fs');
  const crypto = require('crypto');
  const pg = require('pg');

  const migrationsDir = path.join(process.cwd(), 'src', 'db', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.warn('[instrumentation:node] No migrations directory');
    return;
  }

  const sqlFiles = fs.readdirSync(migrationsDir).filter((f: string) => f.endsWith('.sql')).sort();
  if (sqlFiles.length === 0) {
    console.warn('[instrumentation:node] No SQL migration files');
    return;
  }

  const client = new pg.Client(connectionString);
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL UNIQUE,
        created_at bigint NOT NULL
      );
    `);

    // For dev: clear migrations table if PG_RESET_ON_START=true
    if (process.env.PG_RESET_ON_START === 'true') {
      console.log('[instrumentation:node] PG_RESET_ON_START=true — clearing schema...');
      // Drop all tables in public schema (including __drizzle_migrations)
      const tables = await client.query(`
        SELECT tablename FROM pg_tables WHERE schemaname='public'
      `);
      for (const row of tables.rows) {
        await client.query(`DROP TABLE IF EXISTS "${row.tablename}" CASCADE`);
      }
      console.log(`[instrumentation:node] Dropped ${tables.rows.length} tables`);

      // Recreate migrations tracking table
      await client.query(`
        CREATE TABLE __drizzle_migrations (
          id serial PRIMARY KEY,
          hash text NOT NULL UNIQUE,
          created_at bigint NOT NULL
        );
      `);
    } else {
      // Check for stale migrations: claims applied but few tables exist
      const tablesCheck = await client.query(`
        SELECT count(*) as c FROM pg_tables
        WHERE schemaname='public' AND tablename != '__drizzle_migrations'
      `);
      const actualTableCount = parseInt(tablesCheck.rows[0].c, 10);
      const migrationsCount = await client.query('SELECT count(*) as c FROM __drizzle_migrations');

      if (parseInt(migrationsCount.rows[0].c, 10) > 0 && actualTableCount < 10) {
        console.log(`[instrumentation:node] Migrations claim applied but only ${actualTableCount} tables exist — forcing re-apply`);
        await client.query('DELETE FROM __drizzle_migrations');
      }
    }

    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');
      const hash = crypto.createHash('sha256').update(sql).digest('hex');

      const existing = await client.query('SELECT id FROM __drizzle_migrations WHERE hash = $1', [hash]);
      if (existing.rows.length > 0) {
        console.log(`[instrumentation:node] ✓ ${file} already applied`);
        continue;
      }

      console.log(`[instrumentation:node] Applying: ${file}`);
      // Drizzle uses "--> statement-breakpoint" as separator
      // Remove the markers, then execute the entire SQL as one query
      // (PostgreSQL accepts multiple statements separated by ; in a single query)
      const cleanSql = sql.replace(/--> statement-breakpoint/g, '');
      let ok = 0, errors = 0;
      try {
        // Execute as a single multi-statement query
        await client.query(cleanSql);
        ok = cleanSql.split(';').filter(s => s.trim() && !s.trim().startsWith('--')).length;
        console.log(`[instrumentation:node] ✓ Applied all statements from ${file}`);
      } catch (e: any) {
        // If multi-statement fails, fall back to statement-by-statement
        console.log(`[instrumentation:node] Multi-statement failed (${e.message.substring(0, 60)}), trying one-by-one...`);
        const statements = cleanSql
          .split(';')
          .map((s: string) => s.trim())
          .filter((s: string) => s && !s.startsWith('--'));
        for (const stmt of statements) {
          try {
            await client.query(stmt);
            ok++;
          } catch (e2: any) {
            if (!e2.message.includes('already exists')) {
              errors++;
              if (errors <= 5) console.error(`  ✗ ${e2.message.substring(0, 100)}`);
            }
          }
        }
      }
      console.log(`[instrumentation:node] ✓ ${file}: ${ok} ok, ${errors} errors`);

      await client.query(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [hash, Date.now()]
      );
    }

    const r = await client.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'");
    console.log(`[instrumentation:node] ✓ Total tables: ${r.rows[0].count}`);
  } finally {
    await client.end();
  }
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollar = false;
  let dollarTag = '';
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    current += char;
    if (char === '$') {
      const rest = sql.substring(i);
      const m = rest.match(/^\$(\w*)\$/);
      if (m) {
        if (!inDollar) {
          inDollar = true;
          dollarTag = m[1];
          i += m[0].length;
          current += m[0].substring(1);
          continue;
        } else if (m[1] === dollarTag) {
          inDollar = false;
          dollarTag = '';
          i += m[0].length;
          current += m[0].substring(1);
          continue;
        }
      }
    }
    if (char === ';' && !inDollar) {
      statements.push(current.trim());
      current = '';
    }
    i++;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}
