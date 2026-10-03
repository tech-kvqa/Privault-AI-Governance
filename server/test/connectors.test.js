// End-to-end tests of the live PostgreSQL connector against a REAL Postgres
// (fixture: test/fixtures/setup-pg.sh). Skipped automatically when no Postgres
// is reachable, so `npm test` still passes on a machine without one.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.JWT_SECRET = 'test-secret';
require('express-async-errors');
process.env.CONNECTOR_ALLOW_PRIVATE = 'true'; // fixture DB is on 127.0.0.1

const { makeDb } = require('./helpers/fakeDb');
const { issueToken } = require('./helpers/auth');
const db = makeDb();
const prismaPath = require.resolve('../src/lib/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };

const express = require('express');
const jwt = require('jsonwebtoken');
const { Client } = require('pg');
const { withClient, testConnection } = require('../src/lib/pgScanner');
const { decryptSecret } = require('../src/lib/secrets');

const PG = { host: process.env.TEST_PG_HOST || '127.0.0.1', port: Number(process.env.TEST_PG_PORT || 5432), database: 'bank_demo', sslmode: 'disable' };
const scanner = { ...PG, user: 'scanner', password: 'scanner-pw' };

const app = express();
app.use(express.json());
for (const [mount, file] of [['/connectors', 'connectors'], ['/find-me-in-ai', 'findMeInAi'], ['/dsars', 'dsars']]) {
  app.use(mount, require(path.join('../src/routes', file)));
}
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

let server, base, pgUp = false;
const users = {};
test.before(async () => {
  try {
    const c = new Client({ ...scanner, ssl: false, connectionTimeoutMillis: 2000 });
    await c.connect(); await c.end(); pgUp = true;
  } catch { pgUp = false; }
  for (const [key, role] of [['gov', 'AI_GOVERNANCE_ADMIN'], ['po', 'PRIVACY_OFFICER'], ['dpo', 'DPO'], ['aud', 'AUDITOR']]) {
    const u = await db.user.create({ data: { id: `user-${key}`, tenantId: 't1', role, email: `${key}@x`, name: key, isActive: true } });
    users[key] = await issueToken(db, u);
  }
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (who, method, url, body) => fetch(base + url, {
  method,
  headers: { Authorization: `Bearer ${users[who]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const needPg = (t) => { if (!pgUp) { t.skip('no PostgreSQL reachable — run test/fixtures/setup-pg.sh'); return false; } return true; };

// ---------------------------------------------------------------- scanner lib
test('scanner: sessions are read-only — Postgres itself rejects a write', async (t) => {
  if (!needPg(t)) return;
  // `writer` HAS INSERT privilege; the only thing stopping it is the read-only session.
  await assert.rejects(
    withClient({ ...PG, user: 'writer', password: 'writer-pw' }, (c) => c.query("INSERT INTO branches (branch_code, region) VALUES ('X','Y')")),
    /read-only/i
  );
  const check = new Client({ ...scanner, ssl: false }); await check.connect();
  assert.equal((await check.query("SELECT count(*)::int AS n FROM branches WHERE branch_code = 'X'")).rows[0].n, 0);
  await check.end();
});

test('scanner: connection test reports identity and warns about superusers and missing TLS', async (t) => {
  if (!needPg(t)) return;
  const ok = await testConnection(scanner);
  assert.equal(ok.user, 'scanner');
  assert.equal(ok.readOnlySession, true);
  assert.ok(ok.warnings.some((w) => /TLS is disabled/.test(w)));
  assert.ok(!ok.warnings.some((w) => /SUPERUSER/.test(w)));
  const su = await testConnection({ ...PG, user: 'admin_role', password: 'admin-pw' });
  assert.ok(su.warnings.some((w) => /SUPERUSER/.test(w)));
});

test('scanner: errors are sanitised — the password never appears', async (t) => {
  if (!needPg(t)) return;
  const bad = 'hunter2-not-the-password';
  await assert.rejects(testConnection({ ...scanner, password: bad }), (e) => /Authentication failed/.test(e.message) && !e.message.includes(bad));
  await assert.rejects(testConnection({ ...scanner, port: 1 }), /refused|timed out|not found/i);
});

test('scanner: private hosts are refused unless explicitly allowed (SSRF guard)', async () => {
  process.env.CONNECTOR_ALLOW_PRIVATE = 'false';
  try {
    await assert.rejects(testConnection(scanner), /private, loopback/);
    await assert.rejects(testConnection({ ...scanner, host: '169.254.169.254' }), /private, loopback/);
  } finally { process.env.CONNECTOR_ALLOW_PRIVATE = 'true'; }
});

// ---------------------------------------------------------------- API end to end
let sysA, sysB, sysC, connectorId;
const pgBody = (over = {}) => ({ name: 'Core banking replica', type: 'DATABASE', config: { host: PG.host, port: PG.port, database: 'bank_demo', user: 'scanner', password: 'scanner-pw', sslmode: 'disable', ...over } });

test('API: creating a DB connector never returns or stores the password in clear; it starts NOT_CONFIGURED', async (t) => {
  if (!needPg(t)) return;
  sysA = await db.aiSystem.create({ data: { tenantId: 't1', name: 'Loan Decision Engine' } });
  sysB = await db.aiSystem.create({ data: { tenantId: 't1', name: 'Fraud AI (sampled data only)' } });
  sysC = await db.aiSystem.create({ data: { tenantId: 't1', name: 'Unscanned AI' } });

  const r = await call('gov', 'POST', '/connectors', pgBody());
  assert.equal(r.status, 201);
  const text = await r.text();
  assert.ok(!text.includes('scanner-pw'), 'password absent from response');
  const c = JSON.parse(text).connector;
  connectorId = c.id;
  assert.equal(c.status, 'NOT_CONFIGURED');
  const row = db._tables.connector.find((x) => x.id === c.id);
  assert.ok(!JSON.stringify(row.config).includes('scanner-pw'), 'not in config');
  assert.notEqual(row.credentialsEncrypted, 'scanner-pw');
  assert.equal(decryptSecret(row.credentialsEncrypted), 'scanner-pw');
  assert.equal((await (await call('aud', 'GET', '/connectors')).text()).includes('credentialsEncrypted'), false, 'never listed');
  assert.equal((await call('gov', 'POST', '/connectors', { name: 'x', type: 'DATABASE' })).status, 400, 'config required');
  assert.equal((await call('gov', 'POST', '/connectors', { name: 'x', type: 'VECTOR_DB' })).status, 201);
  assert.equal(db._tables.connector.find((x) => x.type === 'VECTOR_DB').status, 'NOT_CONFIGURED', 'unimplemented types never become CONNECTED');
});

test('API: cannot scan before a successful connection test; DPO lacks scan permission', async (t) => {
  if (!needPg(t)) return;
  assert.equal((await call('gov', 'POST', `/connectors/${connectorId}/scan`, {})).status, 400);
  assert.equal((await call('dpo', 'POST', `/connectors/${connectorId}/scan`, {})).status, 403);
  const t1 = await (await call('gov', 'POST', `/connectors/${connectorId}/test`)).json();
  assert.equal(t1.ok, true);
  assert.equal(db._tables.connector.find((x) => x.id === connectorId).status, 'CONNECTED');
});

let scan1;
test('API: real scan finds PII by method, reports completeness honestly, and stores only hashes', async (t) => {
  if (!needPg(t)) return;
  const r = await call('gov', 'POST', `/connectors/${connectorId}/scan`, { aiSystemId: sysA.id, sampleRows: 1000 });
  assert.equal(r.status, 200);
  scan1 = await r.json();
  const by = Object.fromEntries(scan1.tables.map((x) => [x.name, x]));

  assert.deepEqual(Object.keys(by).sort(), ['hr.employees', 'public.branches', 'public.cards', 'public.customers', 'public.web_logins']);
  assert.ok(['Email', 'Phone', 'PAN', 'Aadhaar'].every((c) => by['public.customers'].piiCategories.includes(c)), 'customers: ' + by['public.customers'].piiCategories);
  assert.ok(by['public.cards'].piiCategories.includes('Credit/Debit Card'));
  assert.deepEqual(by['public.branches'].piiCategories, []);
  assert.ok(by['hr.employees'].piiCategories.includes('Email'));

  assert.equal(by['public.customers'].complete, true);
  assert.equal(by['public.web_logins'].complete, false, '3000 rows > 1000 sample => incomplete');
  assert.equal(by['public.web_logins'].rowsScanned, 1000);
  assert.equal(scan1.tablesIncomplete, 1);

  const stored = db._tables.piiRecordValue;
  assert.ok(stored.length > 10);
  assert.ok(stored.every((v) => v.value.startsWith('hmac:')), 'every stored value is a keyed hash');
  assert.ok(!stored.some((v) => /@abcbank\.demo|ABCDE1234F|4111111111111111/.test(v.value)), 'no clear-text PII in the index');
  assert.ok(db._tables.dataAsset.every((a) => a.indexedAsHash && a.dataSourceType === 'CONNECTOR'));

  const linked = db._tables.lineageEdge.map((e) => db._tables.dataAsset.find((a) => a.id === e.sourceId).name).sort();
  assert.ok(!linked.includes('public.branches'), 'tables with no PII are not linked to the AI system');
  assert.ok(linked.includes('public.customers'));
});

test('API: re-scanning updates assets in place (stable ids, no duplicates, no stale index)', async (t) => {
  if (!needPg(t)) return;
  const idsBefore = db._tables.dataAsset.map((a) => a.id).sort();
  const valuesBefore = db._tables.piiRecordValue.length;
  const r = await call('gov', 'POST', `/connectors/${connectorId}/scan`, { aiSystemId: sysA.id, sampleRows: 1000 });
  assert.equal(r.status, 200);
  assert.deepEqual(db._tables.dataAsset.map((a) => a.id).sort(), idsBefore);
  assert.equal(db._tables.piiRecordValue.length, valuesBefore);
});

test('Find Me in AI: found via hash; NOT_FOUND only when every linked asset was fully scanned', async (t) => {
  if (!needPg(t)) return;
  // a system whose only linked data is a PARTIAL scan
  const partial = await db.dataAsset.create({ data: { tenantId: 't1', name: 'sampled.csv', aiSystemId: sysB.id, scanComplete: false } });

  const hit = await (await call('gov', 'GET', '/find-me-in-ai?identifier=Ritika.Gupta@abcbank.demo')).json();
  assert.ok(hit.foundIn.some((f) => f.dataAssetName === 'public.customers' && f.hashed === true));
  assert.ok(!JSON.stringify(hit).includes('hmac:'), 'raw hash values are not exposed');
  const s = Object.fromEntries(hit.aiSystems.map((x) => [x.name, x]));
  assert.equal(s['Loan Decision Engine'].status, 'FOUND');
  assert.equal(s['Fraud AI (sampled data only)'].status, 'UNKNOWN');
  assert.match(s['Fraud AI (sampled data only)'].reason, /partially scanned/);
  assert.equal(s['Unscanned AI'].status, 'UNKNOWN');
  assert.match(s['Unscanned AI'].reason, /No scanned data asset/);

  // The subtle case: user2999 really exists in web_logins, but beyond the sampled rows.
  // System A has fully-scanned tables AND the sampled web_logins, so absence must NOT be concluded.
  const miss = await (await call('gov', 'GET', '/find-me-in-ai?identifier=user2999@abcbank.demo')).json();
  assert.equal(miss.foundIn.length, 0, 'not indexed — it is past the sample');
  assert.equal(miss.aiSystems.find((x) => x.name === 'Loan Decision Engine').status, 'UNKNOWN', 'must not claim NOT_FOUND');

  // Once the sampled asset is gone from the picture, complete assets do support NOT_FOUND.
  const wl = db._tables.dataAsset.find((a) => a.name === 'public.web_logins');
  wl.scanComplete = true; // (simulating a full scan of that table)
  const now = await (await call('gov', 'GET', '/find-me-in-ai?identifier=nobody@nowhere.example')).json();
  assert.equal(now.aiSystems.find((x) => x.name === 'Loan Decision Engine').status, 'NOT_FOUND');
  wl.scanComplete = false;
  void partial;
});

test('DSAR erasure loop: DELETE clears Privault\'s index; a rescan reveals the source still holds the data', async (t) => {
  if (!needPg(t)) return;
  const id = 'sana.verma@abcbank.demo';
  const d = (await (await call('po', 'POST', '/dsars', { dataSubjectIdentifier: id, requestType: 'DELETION' })).json()).dsar;
  const analysis = await (await call('po', 'POST', `/dsars/${d.id}/analyze-impact`)).json();
  assert.ok(analysis.impactRecords.length >= 1);
  const del = analysis.actions.filter((a) => a.actionType === 'DELETE');
  assert.ok(del.length >= 1);

  for (const a of del) {
    const ex = await (await call('po', 'POST', `/dsars/${d.id}/actions/${a.id}/execute`)).json();
    assert.ok(ex.deletedCount >= 1);
    assert.match(ex.action.evidence, /Privault's index only/);
  }
  assert.equal((await (await call('gov', 'GET', `/find-me-in-ai?identifier=${id}`)).json()).foundIn.length, 0, 'gone from the index');

  // The customer's database still contains the row -> a rescan must surface it again.
  await call('gov', 'POST', `/connectors/${connectorId}/scan`, { aiSystemId: sysA.id, sampleRows: 1000 });
  assert.ok((await (await call('gov', 'GET', `/find-me-in-ai?identifier=${id}`)).json()).foundIn.length >= 1, 'source erasure not done -> visible again');
});

test('API: overlapping scans are refused; credential rotation forces a re-test and never leaks the new secret', async (t) => {
  if (!needPg(t)) return;
  const run = await db.connectorRun.create({ data: { tenantId: 't1', connectorId, status: 'RUNNING', startedAt: new Date() } });
  assert.equal((await call('gov', 'POST', `/connectors/${connectorId}/scan`, {})).status, 409);
  run.status = 'SUCCESS';

  const wrong = 'wrong-password-123';
  const rot = await call('gov', 'PUT', `/connectors/${connectorId}/credentials`, { password: wrong });
  assert.equal(rot.status, 200);
  assert.equal(db._tables.connector.find((x) => x.id === connectorId).status, 'NOT_CONFIGURED');
  const bad = await (await call('gov', 'POST', `/connectors/${connectorId}/test`)).json();
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Authentication failed/);
  assert.ok(!JSON.stringify(bad).includes(wrong));
  assert.equal((await call('gov', 'POST', `/connectors/${connectorId}/scan`, {})).status, 400, 'blocked until re-tested');

  await call('gov', 'PUT', `/connectors/${connectorId}/credentials`, { password: 'scanner-pw' });
  assert.equal((await (await call('gov', 'POST', `/connectors/${connectorId}/test`)).json()).ok, true);
});
