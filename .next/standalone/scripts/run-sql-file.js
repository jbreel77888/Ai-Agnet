const fs = require('fs');
const { Pool } = require('pg');
const DB_URL = process.env.DATABASE_URL;
const SQL_PATH = process.argv[2];
if (!DB_URL || !SQL_PATH) {
  console.error('Usage: DATABASE_URL=... node run-sql-file.js <sql-path>');
  process.exit(1);
}
const sql = fs.readFileSync(SQL_PATH, 'utf8');
(async () => {
  const pool = new Pool({ connectionString: DB_URL, max: 1, connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    console.log('Connected. Executing', SQL_PATH);
    // Split on ; followed by newline (naive)
    const statements = sql
      .replace(/--[^\n]*/g, '')   // strip line comments
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s && s.length > 2);
    let ok = 0, failed = 0;
    for (const stmt of statements) {
      try {
        const r = await client.query(stmt);
        ok++;
        if (r.rows && r.rows.length > 0) {
          console.log(`✓ ${stmt.substring(0, 80).replace(/\s+/g, ' ')} → ${r.rows.length} rows`);
          // Print first 3 rows compactly
          r.rows.slice(0, 5).forEach(row => {
            console.log('   ', JSON.stringify(row).substring(0, 200));
          });
        } else {
          console.log(`✓ ${stmt.substring(0, 80).replace(/\s+/g, ' ')} → ${r.rowCount || 0} rows affected`);
        }
      } catch (e) {
        failed++;
        console.log(`✗ ${stmt.substring(0, 80).replace(/\s+/g, ' ')} → ${e.message}`);
      }
    }
    console.log(`\nDone: ${ok} succeeded, ${failed} failed`);
  } finally {
    client.release();
    await pool.end();
  }
})();
