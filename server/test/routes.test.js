// Route-level tests: real Express routers, real auth/RBAC middleware, real
// HTTP requests — with an in-memory stand-in for Prisma so no database is
// needed. These verify the *enforcement* claims (dual control, separation of
// duties, integrity checks, tenant isolation), not just the helper functions.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

process.env.JWT_SECRET = 'test-secret';
require('express-async-errors');

const { makeDb } = require('./helpers/fakeDb');
const { issueToken } = require('./helpers/auth');
const db = makeDb();
const prismaPath = require.resolve('../src/lib/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };

const express = require('express');
const jwt = require('jsonwebtoken');
const app = express();
app.use(express.json());
for (const [mount, file] of [
  ['/emergency', 'emergency'], ['/evidence', 'evidence'], ['/vendors', 'vendors'],
  ['/consents', 'consents'], ['/incidents', 'incidents'], ['/webhooks', 'webhooks'],
]) app.use(mount, require(path.join('../src/routes', file)));
app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));

let server, base;
const users = {};
async function seed() {
  for (const [key, role, tenantId] of [
    ['sec', 'SECURITY_ADMIN', 't1'], ['gov', 'AI_GOVERNANCE_ADMIN', 't1'], ['owner', 'AI_SYSTEM_OWNER', 't1'],
    ['po', 'PRIVACY_OFFICER', 't1'], ['aud', 'AUDITOR', 't1'], ['inc', 'INCIDENT_MANAGER', 't1'], ['other', 'AI_GOVERNANCE_ADMIN', 't2'],
  ]) {
    const u = await db.user.create({ data: { id: `user-${key}`, tenantId, role, email: `${key}@x`, name: key, isActive: true } });
    users[key] = { ...u, token: await issueToken(db, u) };
  }
}
test.before(async () => {
  await seed();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (who, method, url, body, form) => fetch(base + url, {
  method,
  headers: { Authorization: `Bearer ${users[who].token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: form || (body ? JSON.stringify(body) : undefined),
});

// ---------- dual control ----------
test('emergency: stopping a PRODUCTION system needs a second, different approver', async () => {
  const sys = await db.aiSystem.create({ data: { tenantId: 't1', name: 'Loan AI', status: 'PRODUCTION' } });
  const body = { actionType: 'STOP_AI_SYSTEM', reason: 'Vendor reported a scoring regression' };

  const r1 = await call('sec', 'POST', `/emergency/ai-systems/${sys.id}/actions`, body);
  const a = (await r1.json()).action;
  assert.equal(r1.status, 201);
  assert.equal(a.status, 'PENDING_APPROVAL');
  assert.equal((await db.aiSystem.findFirst({ where: { id: sys.id } })).status, 'PRODUCTION', 'nothing executed yet');

  assert.equal((await call('sec', 'POST', `/emergency/actions/${a.id}/approve`, {})).status, 403, 'requester cannot self-approve');
  assert.equal((await call('inc', 'POST', `/emergency/actions/${a.id}/approve`, {})).status, 403, 'role without emergency:approve cannot approve');
  assert.equal((await call('other', 'POST', `/emergency/actions/${a.id}/approve`, {})).status, 404, 'other tenant cannot see it');
  assert.equal((await db.aiSystem.findFirst({ where: { id: sys.id } })).status, 'PRODUCTION');

  const ok = await call('gov', 'POST', `/emergency/actions/${a.id}/approve`, {});
  assert.equal(ok.status, 200);
  assert.equal((await db.aiSystem.findFirst({ where: { id: sys.id } })).status, 'SUSPENDED');
  assert.equal((await call('gov', 'POST', `/emergency/actions/${a.id}/approve`, {})).status, 400, 'cannot approve twice');
});

test('emergency: non-Production stop runs immediately; infrastructure actions are never claimed as executed', async () => {
  const stage = await db.aiSystem.create({ data: { tenantId: 't1', name: 'Staging AI', status: 'ASSESSMENT' } });
  const r = await call('sec', 'POST', `/emergency/ai-systems/${stage.id}/actions`, { actionType: 'STOP_AI_SYSTEM', reason: 'Testing kill switch on staging' });
  assert.equal((await r.json()).action.status, 'EXECUTED');
  assert.equal((await db.aiSystem.findFirst({ where: { id: stage.id } })).status, 'SUSPENDED');

  const prod = await db.aiSystem.create({ data: { tenantId: 't1', name: 'Prod AI 2', status: 'PRODUCTION' } });
  const r2 = await call('sec', 'POST', `/emergency/ai-systems/${prod.id}/actions`, { actionType: 'ROLLBACK_MODEL', reason: 'Rolling back the model version' });
  const j = await r2.json();
  assert.equal(j.action.status, 'REQUIRES_INTEGRATION');
  assert.match(j.note, /INTEGRATION REQUIRED/);
  assert.equal((await db.aiSystem.findFirst({ where: { id: prod.id } })).status, 'PRODUCTION', 'state untouched');

  const short = await call('sec', 'POST', `/emergency/ai-systems/${prod.id}/actions`, { actionType: 'STOP_AI_SYSTEM', reason: 'too short' });
  assert.equal(short.status, 400, 'reason under 10 chars is refused');
});

// ---------- evidence ----------
const upload = (who, name, content, extra = {}) => {
  const f = new FormData();
  f.append('title', extra.title || 'Access review');
  f.append('file', new Blob([content]), name);
  return call(who, 'POST', '/evidence', null, f);
};

test('evidence: hash at upload, separation of duties, integrity-checked download, tamper detection', async () => {
  const content = 'quarterly access review — signed off';
  const r = await upload('owner', 'review.txt', content);
  assert.equal(r.status, 201);
  const ev = (await r.json()).evidence;
  assert.equal(ev.sha256, crypto.createHash('sha256').update(content).digest('hex'));
  assert.equal(ev.content, undefined, 'file bytes never come back from upload/list');

  const list = await (await call('aud', 'GET', '/evidence')).json();
  assert.equal(list.evidence[0].content, undefined, 'list never exposes file bytes');

  assert.equal((await call('owner', 'POST', `/evidence/${ev.id}/review`, { status: 'ACCEPTED' })).status, 403, 'uploader cannot review own evidence');
  assert.equal((await call('po', 'POST', `/evidence/${ev.id}/review`, { status: 'REJECTED' })).status, 400, 'rejection needs a note');
  assert.equal((await call('po', 'POST', `/evidence/${ev.id}/review`, { status: 'ACCEPTED' })).status, 200);

  const dl = await call('aud', 'GET', `/evidence/${ev.id}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await dl.text(), content);
  assert.equal((await (await call('aud', 'POST', `/evidence/${ev.id}/verify`)).json()).intact, true);

  db._tables.evidence.find((e) => e.id === ev.id).content = Buffer.from('silently altered');
  assert.equal((await call('aud', 'GET', `/evidence/${ev.id}/download`)).status, 409, 'download refused after tampering');
  assert.equal((await (await call('aud', 'POST', `/evidence/${ev.id}/verify`)).json()).intact, false);
});

test('evidence: role and file-type restrictions', async () => {
  assert.equal((await upload('aud', 'x.txt', 'hi')).status, 403, 'auditor can view but not upload');
  assert.equal((await upload('owner', 'malware.exe', 'MZ')).status, 400, 'executables refused');
  assert.equal((await upload('owner', 'page.html', '<script>alert(1)</script>')).status, 400, 'html refused');
});

// ---------- vendors & tenant isolation ----------
test('vendors: a signed DPA needs a date; other tenants cannot touch it', async () => {
  const bad = await call('gov', 'POST', '/vendors', { name: 'Acme AI', dpaSigned: true });
  assert.equal(bad.status, 400);
  const ok = await call('gov', 'POST', '/vendors', { name: 'Acme AI', dpaSigned: true, dpaSignedAt: '2026-01-15T00:00:00.000Z' });
  assert.equal(ok.status, 201);
  const v = (await ok.json()).vendor;
  assert.equal((await call('other', 'PUT', `/vendors/${v.id}`, { riskTier: 'LOW' })).status, 404, 'tenant isolation');
  assert.equal((await call('aud', 'POST', '/vendors', { name: 'Nope' })).status, 403, 'auditor cannot manage vendors');
  assert.equal((await call('other', 'GET', '/vendors')).status, 200);
  assert.equal((await (await call('other', 'GET', '/vendors')).json()).vendors.length, 0, 'other tenant sees none');
});

// ---------- DPDP rules ----------
test('DPDP s.9: a minor\'s consent cannot be Granted without parental verification', async () => {
  const base = { dataSubjectIdentifier: 'kid@x', purpose: 'Youth savings', isMinorDataSubject: true };
  assert.equal((await call('po', 'POST', '/consents', base)).status, 400);
  assert.equal((await call('po', 'POST', '/consents', { ...base, status: 'GRANTED' })).status, 400);
  const ok = await call('po', 'POST', '/consents', { ...base, parentalConsentVerified: true });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).consent.verifiedById, 'user-po', 'who verified is recorded');
  assert.equal((await call('po', 'POST', '/consents', { ...base, status: 'PENDING' })).status, 201, 'a pending minor consent may be recorded');
});

test('DPDP s.8(6): a personal-data breach cannot be closed until both notifications are recorded', async () => {
  const r = await call('inc', 'POST', '/incidents', { type: 'PII_LEAKAGE', description: 'Logs exposed', isPersonalDataBreach: true });
  const inc = (await r.json()).incident;
  assert.equal(inc.dpbNotificationRequired, true);
  for (let i = 0; i < 5; i++) assert.equal((await call('inc', 'POST', `/incidents/${inc.id}/advance`, {})).status, 200);
  const blocked = await call('inc', 'POST', `/incidents/${inc.id}/advance`, {});
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /8\(6\)/);

  await call('inc', 'POST', `/incidents/${inc.id}/breach-notification`, { dpbNotified: true });
  assert.equal((await call('inc', 'POST', `/incidents/${inc.id}/advance`, {})).status, 400, 'Board alone is not enough');
  await call('inc', 'POST', `/incidents/${inc.id}/breach-notification`, { principalsNotified: true });
  const closed = await call('inc', 'POST', `/incidents/${inc.id}/advance`, {});
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).incident.status, 'CLOSED');

  const plain = (await (await call('inc', 'POST', '/incidents', { type: 'SHADOW_AI', description: 'not a breach' })).json()).incident;
  assert.equal((await call('inc', 'POST', `/incidents/${plain.id}/breach-notification`, { dpbNotified: true })).status, 400, 'only breaches take breach notifications');
});

// ---------- webhooks ----------
test('webhooks: SSRF targets refused, secret shown once and never listed', async () => {
  assert.equal((await call('gov', 'POST', '/webhooks', { url: 'https://127.0.0.1/hook' })).status, 400);
  assert.equal((await call('gov', 'POST', '/webhooks', { url: 'https://169.254.169.254/latest' })).status, 400);
  assert.equal((await call('gov', 'POST', '/webhooks', { url: 'http://8.8.8.8/hook' })).status, 400, 'http refused');
  const r = await call('gov', 'POST', '/webhooks', { url: 'https://8.8.8.8/hook', events: ['DPIA_APPROVED'] });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.match(j.signingSecret, /^whsec_/);
  const list = await (await call('gov', 'GET', '/webhooks')).json();
  assert.equal(list.endpoints.length, 1);
  assert.equal(list.endpoints[0].secretEncrypted, undefined, 'secret never returned again');
  assert.equal(JSON.stringify(list).includes(j.signingSecret), false);
  assert.equal((await call('owner', 'GET', '/webhooks')).status, 403);
  assert.equal((await call('other', 'GET', '/webhooks')).status, 200);
  assert.equal((await (await call('other', 'GET', '/webhooks')).json()).endpoints.length, 0, 'tenant isolation');
});
