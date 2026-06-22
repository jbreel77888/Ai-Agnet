/**
 * Run fix-railway-db.sql against the production Railway Postgres.
 * Reads DATABASE_URL from CLI arg or env.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DB_URL = process.argv[2] || process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('Usage: node run-sql-fix.js <DATABASE_URL>');
  process.exit(1);
}

const SQL_PATH = path.join(__dirname, 'fix-railway-db.sql');
let sql = fs.readFileSync(SQL_PATH, 'utf8');

// pg's query() doesn't support multi-statement transactions in one call,
// so we split on `;` followed by newline at depth 0 (naive but works for our script).
// We also strip comments and BEGIN/COMMIT (Pool auto-commits each statement).

// Strip block comments
sql = sql.replace(/--[^\n]*/g, '');
// Strip BEGIN/COMMIT
sql = sql.replace(/\bBEGIN\b/g, '').replace(/\bCOMMIT\b/g, '');
// Replace $$ ... $$ blocks are tricky to split — we'll just send the whole thing as a multi-statement query
// pg's `query` actually does support multiple statements when not using parameters

(async () => {
  const pool = new Pool({ connectionString: DB_URL, max: 1, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    console.log('Connected to DB. Executing fix-railway-db.sql...');
    // pg supports multi-statement queries when no parameters are used
    const result = await client.query(sql);
    console.log('✓ Script executed successfully');
    if (result && result.rows && result.rows.length > 0) {
      console.log('Last query rows:');
      console.log(JSON.stringify(result.rows.slice(-10), null, 2));
    }
  } catch (err) {
    console.error('✗ Script failed:', err.message);
    // Continue and try to run statements one-by-one for better error reporting
    console.log('\nFalling back to per-statement execution...');
    const statements = sql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s && s.length > 2);
    
    let ok = 0, failed = 0;
    for (const stmt of statements) {
      try {
        const r = await client.query(stmt);
        ok++;
        if (r.rows && r.rows.length > 0) {
          console.log(`✓ (${stmt.substring(0, 60).replace(/\n/g, ' ')}...) → ${r.rows.length} rows`);
        }
      } catch (e) {
        failed++;
        console.log(`✗ (${stmt.substring(0, 60).replace(/\n/g, ' ')}...) → ${e.message}`);
      }
    }
    console.log(`\nDone: ${ok} succeeded, ${failed} failed`);
  } finally {
    client.release();
    await pool.end();
  }
})();
