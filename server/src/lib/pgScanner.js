const dns = require('dns').promises;
const net = require('net');
const { Client } = require('pg');
const { isPrivateAddress } = require('./webhooks');

// Live, READ-ONLY PostgreSQL scanner (master spec Mode A).
//
// What makes it safe to point at a production database:
//  * Every session runs inside BEGIN READ ONLY and is opened with
//    default_transaction_read_only=on — a write is rejected by Postgres itself
//    (SQLSTATE 25006), not just by our code being careful.
//  * Only catalog-visible columns are read (information_schema shows only what
//    the connecting role may see), so a least-privilege role limits the scan.
//  * Bounded: statement timeout, max tables, max sampled rows per table, and
//    values truncated to 200 chars. It reads the FIRST N rows of each table (not
//    a random sample) — a table that is larger than N is reported as
//    INCOMPLETE and can never support an "absent" conclusion.
//  * SSRF: by default it refuses hosts that resolve to private/loopback
//    addresses. On-prem / internal databases set CONNECTOR_ALLOW_PRIVATE=true.
//  * Errors are sanitised (the password is scrubbed) before being surfaced.

const MAX_SAMPLE_ROWS = 2000;
const DEFAULT_SAMPLE_ROWS = 1000;
const MAX_TABLES = 200;
const SKIP_TYPES = new Set(['bytea']);

function userError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  e.userMessage = message;
  return e;
}

async function assertConnectableHost(host) {
  let addrs;
  try {
    addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  } catch { throw userError('Host not found'); }
  if (process.env.CONNECTOR_ALLOW_PRIVATE !== 'true' && addrs.some((a) => isPrivateAddress(a.address))) {
    throw userError('Host resolves to a private, loopback or link-local address. For on-premise / internal databases set CONNECTOR_ALLOW_PRIVATE=true on the server.');
  }
}

function describeError(e, password) {
  if (e.userMessage) return e.userMessage;
  const map = {
    ECONNREFUSED: 'Connection refused — check host and port',
    ENOTFOUND: 'Host not found',
    ETIMEDOUT: 'Connection timed out',
    '28P01': 'Authentication failed (wrong user or password)',
    '28000': 'Authentication failed',
    '3D000': 'Database does not exist',
    '42501': 'Permission denied',
    '57014': 'Query exceeded the statement timeout',
  };
  let m = map[e.code] || e.message || 'Unknown error';
  if (password) m = m.split(password).join('***');
  return m.slice(0, 200);
}

function clientFor(cfg) {
  const ssl = cfg.sslmode === 'disable' ? false : { rejectUnauthorized: cfg.sslmode === 'verify-full' };
  return new Client({
    host: cfg.host, port: cfg.port || 5432, database: cfg.database, user: cfg.user, password: cfg.password,
    ssl, connectionTimeoutMillis: 8000, statement_timeout: 30000, query_timeout: 35000,
    application_name: 'privault-scanner', options: '-c default_transaction_read_only=on',
  });
}

async function withClient(cfg, fn) {
  await assertConnectableHost(cfg.host);
  const c = clientFor(cfg);
  let connected = false;
  try {
    await c.connect();
    connected = true;
    await c.query('BEGIN READ ONLY');
    return await fn(c);
  } catch (e) {
    throw Object.assign(new Error(describeError(e, cfg.password)), { userMessage: describeError(e, cfg.password), status: e.status || 400 });
  } finally {
    if (connected) {
      try { await c.query('ROLLBACK'); } catch { /* connection may already be gone */ }
      // end() can hang if the socket already died; never let cleanup block the request.
      await Promise.race([c.end().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    }
    // A client that failed to connect must not be end()ed (pg never resolves it) — just drop the socket.
    try { c.connection?.stream?.destroy(); } catch { /* already closed */ }
  }
}

async function testConnection(cfg) {
  return withClient(cfg, async (c) => {
    const who = (await c.query('SELECT current_user AS "user", current_database() AS database, version() AS version')).rows[0];
    const ro = (await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only === 'on';
    const su = (await c.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0]?.rolsuper === true;
    const warnings = [];
    if (su) warnings.push('This role is a SUPERUSER. Connect with a dedicated least-privilege role that has SELECT only on the schemas to be scanned.');
    if (cfg.sslmode === 'disable') warnings.push('TLS is disabled — database traffic (including sampled personal data) crosses the network unencrypted.');
    else if (cfg.sslmode === 'require') warnings.push('TLS is on but the server certificate is not verified (sslmode=require). Use verify-full where possible.');
    return { user: who.user, database: who.database, serverVersion: who.version.split(' ').slice(0, 2).join(' '), readOnlySession: ro, warnings };
  });
}

const q = (id) => '"' + String(id).replace(/"/g, '""') + '"';

const COLUMNS_SQL = `
  SELECT table_schema, table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_schema NOT LIKE 'pg_toast%' AND table_schema NOT LIKE 'pg_temp%'
    AND ($1::text[] IS NULL OR table_schema = ANY($1::text[]))
  ORDER BY table_schema, table_name, ordinal_position`;

/**
 * Scans catalog-visible tables and hands each table's sampled rows to
 * `onTable` (nothing is retained here). Returns overall metadata.
 */
async function scanDatabase(cfg, { schemas = [], sampleRows = DEFAULT_SAMPLE_ROWS, maxTables = MAX_TABLES } = {}, onTable) {
  const limit = Math.max(1, Math.min(MAX_SAMPLE_ROWS, Math.floor(Number(sampleRows) || DEFAULT_SAMPLE_ROWS)));
  return withClient(cfg, async (c) => {
    const cols = await c.query(COLUMNS_SQL, [schemas.length ? schemas : null]);
    const tables = new Map();
    for (const r of cols.rows) {
      if (SKIP_TYPES.has(r.data_type)) continue;
      const key = `${r.table_schema}\u0000${r.table_name}`;
      if (!tables.has(key)) tables.set(key, { schema: r.table_schema, table: r.table_name, columns: [] });
      tables.get(key).columns.push(r.column_name);
    }
    const all = [...tables.values()];
    const selected = all.slice(0, maxTables);

    for (const t of selected) {
      try {
        await c.query('SAVEPOINT scan_table');
        const select = t.columns.map((col) => `left(${q(col)}::text, 200) AS ${q(col)}`).join(', ');
        const res = await c.query(`SELECT ${select} FROM ${q(t.schema)}.${q(t.table)} LIMIT ${limit}`);
        const est = await c.query('SELECT reltuples::bigint AS n FROM pg_class WHERE oid = to_regclass($1)', [`${q(t.schema)}.${q(t.table)}`]);
        await c.query('RELEASE SAVEPOINT scan_table');
        const n = est.rows[0] ? Number(est.rows[0].n) : -1;
        await onTable({
          schema: t.schema, table: t.table, columns: t.columns, rows: res.rows,
          rowsFetched: res.rows.length, estimatedRows: n >= 0 ? n : null,
          // We hit the end of the table only if fewer rows than the limit came back.
          reachedEnd: res.rows.length < limit,
        });
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT scan_table').catch(() => {});
        await onTable({ schema: t.schema, table: t.table, columns: t.columns, error: describeError(e, cfg.password) });
      }
    }
    return { tablesFound: all.length, tablesScanned: selected.length, tablesTruncated: all.length > selected.length, sampleRows: limit };
  });
}

module.exports = { testConnection, scanDatabase, withClient, describeError, MAX_SAMPLE_ROWS, DEFAULT_SAMPLE_ROWS, MAX_TABLES };
