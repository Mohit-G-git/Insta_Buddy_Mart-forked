#!/usr/bin/env node

require('dotenv').config({
  path: require('path').resolve(__dirname, '../.env')
})

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const migrationsDir = path.join(__dirname);

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('✓ Connected to PostgreSQL');

    // Create schema_migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        run_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✓ schema_migrations table ready');

    // Read all .sql files from migrations directory
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found.');
      await client.end();
      process.exit(0);
    }

    // Get list of already-run migrations
    const ranResult = await client.query(
      'SELECT filename FROM schema_migrations ORDER BY run_at ASC'
    );
    const ranMigrations = new Set(ranResult.rows.map(row => row.filename));

    // Find pending migrations
    const pendingMigrations = files.filter(file => !ranMigrations.has(file));

    if (pendingMigrations.length === 0) {
      console.log('All migrations have already been run.');
      await client.end();
      process.exit(0);
    }

    console.log(`\nPending migrations: ${pendingMigrations.length}`);
    console.log('-----------------------------------\n');

    // Run each pending migration
    for (const file of pendingMigrations) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        console.log(`→ Running ${file}...`);

        // Execute migration in a transaction
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');

        // Record the migration
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );

        console.log(`✓ ${file} completed successfully\n`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => { });
        console.error(`✗ ${file} failed:`);
        console.error(error.message);
        console.error('');
        throw error;
      }
    }

    console.log('-----------------------------------');
    console.log(`✓ All ${pendingMigrations.length} migration(s) completed successfully`);
    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Migration process failed:');
    console.error(error.message);
    await client.end().catch(() => { });
    process.exit(1);
  }
}

main();
