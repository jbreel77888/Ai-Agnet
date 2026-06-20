/**
 * Start embedded PostgreSQL and test connection
 *
 * Run: bun run scripts/start-postgres.ts
 */
import { startEmbeddedPostgres, getConnectionString } from '../src/db/embedded-postgres';

// Set LD_LIBRARY_PATH for ICU libraries (needed by embedded-postgres on Debian 13)
const pgLibPath = require('path').join(__dirname, '..', 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'lib');
const userLibPath = require('path').join(process.env.HOME || '/home/z', '.local', 'lib');
process.env.LD_LIBRARY_PATH = `${userLibPath}:${pgLibPath}:${process.env.LD_LIBRARY_PATH || ''}`;

async function main() {
  console.log('='.repeat(60));
  console.log('Starting Embedded PostgreSQL');
  console.log('='.repeat(60));

  const handle = await startEmbeddedPostgres();

  console.log('\n' + '='.repeat(60));
  console.log('PostgreSQL is ready!');
  console.log('='.repeat(60));
  console.log('Connection string:');
  console.log(handle.connectionString);
  console.log('\nAdd this to your .env:');
  console.log(`DATABASE_URL=${handle.connectionString}`);

  // Test the connection
  console.log('\nTesting connection...');
  const client = handle.instance.getPgClient(handle.database);
  await client.connect();
  try {
    const result = await client.query('SELECT version()');
    console.log('Server version:', result.rows[0].version);

    const extResult = await client.query(`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname IN ('uuid-ossp', 'vector', 'pg_trgm')
      ORDER BY extname;
    `);
    console.log('\nInstalled extensions:');
    for (const row of extResult.rows) {
      console.log(`  ✓ ${row.extname} ${row.extversion}`);
    }

    console.log('\n✓ PostgreSQL is ready to use');
  } finally {
    await client.end();
  }

  // Keep running until killed
  console.log('\nPostgreSQL is running. Send SIGTERM to stop.');

  // Wait forever (don't exit)
  await new Promise<void>((resolve) => {
    const stop = async () => {
      console.log('\nStopping PostgreSQL...');
      await handle.stop();
      resolve();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('SIGHUP', stop);
  });
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to start PostgreSQL:', err);
  process.exit(1);
});
