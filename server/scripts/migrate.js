#!/usr/bin/env node
// Applies the committed Prisma migrations (prisma/migrations/*/migration.sql) with nothing but
// the `pg` driver — no Prisma engine, no downloads, so it works in Docker, on-prem and air-gapped
// installs. History is recorded in Prisma's own `_prisma_migrations` table, in Prisma's format
// (sha256 checksums), so `prisma migrate status/dev` on a developer machine stays consistent.
//
//   node scripts/migrate.js            apply anything pending
//   node scripts/migrate.js --status   show applied / pending, change nothing
//
// Each migration runs in ONE transaction together with its history row: a failure leaves no
// partial schema and no history row, so fixing and re-running is safe. An already-applied
// migration whose file has since been edited is refused (checksum mismatch).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'prisma', 'migrations');
const LOCK_ID = 72707369; // same advisory-lock id Prisma uses, so runners exclude each other
const statusOnly = process.argv.includes('--status');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function localMigrations() {
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+_/.test(d.name))
    .map((d) => d.name).sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(DIR, name, 'migration.sql'), 'utf8');
      return { name, sql, checksum: sha256(sql) };
    });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const applied = new Map(
      (await client.query('SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"')).rows
        .filter((r) => r.finished_at && !r.rolled_back_at).map((r) => [r.migration_name, r.checksum])
    );
    const local = localMigrations();

    for (const m of local) {
      if (applied.has(m.name) && applied.get(m.name) !== m.checksum) {
        throw new Error(`Migration ${m.name} was already applied but its file has changed. Never edit an applied migration — add a new one.`);
      }
    }
    const pending = local.filter((m) => !applied.has(m.name));
    if (statusOnly) {
      local.forEach((m) => console.log(`${applied.has(m.name) ? 'applied ' : 'PENDING '} ${m.name}`));
      console.log(pending.length ? `${pending.length} pending` : 'Database schema is up to date');
      return;
    }
    if (!pending.length) { console.log('No pending migrations — database is up to date'); return; }

    for (const m of pending) {
      process.stdout.write(`Applying ${m.name} ... `);
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query(
          'INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)',
          [crypto.randomUUID(), m.checksum, m.name]
        );
        await client.query('COMMIT');
        console.log('done');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.log('FAILED');
        throw e;
      }
    }
    console.log(`Applied ${pending.length} migration(s)`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end().catch(() => {});
  }
}

main().catch((e) => { console.error('Migration error:', e.message); process.exit(1); });
