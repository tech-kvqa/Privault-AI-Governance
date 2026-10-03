// END-TO-END against a REAL PostgreSQL with the REAL Prisma client: creates a scratch database,
// applies the committed migrations, runs the real seed, starts the real app, and drives it over
// HTTP as different roles. Skipped automatically when no Postgres is reachable.
//   Needs a role that can CREATE DATABASE (E2E_ADMIN_URL, default: the privault dev role).
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const ADMIN_URL = process.env.E2E_ADMIN_URL || 'postgresql://privault:privault@127.0.0.1:5432/postgres';
const DB = 'privault_e2e';
const DB_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${DB}`);
const ROOT = path.join(__dirname, '..');

let up = false, server, base;
const tokens = {};

test.before(async () => {
  try {
    const admin = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();
    up = true;
  } catch { return; }

  const env = { ...process.env, DATABASE_URL: DB_URL, JWT_SECRET: 'e2e-secret' };
  execFileSync('node', ['scripts/migrate.js'], { cwd: ROOT, env, stdio: 'pipe' });
  execFileSync('node', ['prisma/seed.js'], { cwd: ROOT, env, stdio: 'pipe' });

  Object.assign(process.env, { DATABASE_URL: DB_URL, JWT_SECRET: 'e2e-secret', RATE_LIMIT_MAX: '100000', AUTH_RATE_LIMIT_MAX: '100000', WEBHOOK_ALLOW_PRIVATE: 'false' });
  const app = require('../src/index'); // real Prisma client, real routes
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  for (const who of ['admin', 'governance', 'privacy', 'dpo', 'owner', 'auditor', 'security', 'reviewer', 'readonly']) {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${who}@abcbank.demo`, password: 'Demo@1234' }) });
    const body = await r.json();
    if (body.mfaRequired) throw new Error(`unexpected MFA requirement for seeded user ${who}`);
    tokens[who] = body.token;
  }
});
test.after(async () => {
  if (server) server.close();
  if (up) { const prisma = require('../src/lib/prisma'); await prisma.$disconnect().catch(() => {}); }
});

const need = (t) => { if (!up) { t.skip('no PostgreSQL reachable for E2E'); return false; } return true; };
const call = (who, method, url, body, form) => fetch(base + url, {
  method,
  headers: { Authorization: `Bearer ${tokens[who]}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: form || (body ? JSON.stringify(body) : undefined),
});
const json = async (who, method, url, body) => { const r = await call(who, method, url, body); return { status: r.status, body: await r.json().catch(() => null) }; };

test('E2E: login works for every seeded role; bad credentials are rejected', async (t) => {
  if (!need(t)) return;
  for (const who of Object.keys(tokens)) assert.ok(tokens[who], `no token for ${who}`);
  const bad = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@abcbank.demo', password: 'wrong' }) });
  assert.equal(bad.status, 401);
  const me0 = await json('admin', 'GET', '/auth/me');
  assert.equal(me0.body.session.restricted, false);
  assert.ok(Array.isArray(me0.body.permissions) && me0.body.permissions.includes('*'));
  assert.equal((await fetch(`${base}/ai-systems`)).status, 401, 'no token, no data');
  const me = await json('dpo', 'GET', '/auth/me');
  assert.equal(me.body.user.role, 'DPO');
});

test('E2E: every module\'s read endpoints work against the real database and return the seeded data', async (t) => {
  if (!need(t)) return;
  const expectations = [
    ['/ai-systems', (b) => b.aiSystems.length === 6],
    ['/dashboard/kpis', (b) => b.kpis.aiSystems === 6 && b.kpis.shadowAiEvents >= 1 && b.kpis.openAiDsars >= 1 && b.kpis.aiPrivacyIncidents >= 1 && b.kpis.aiSystemsProcessingPersonalData >= 5 && Object.values(b.kpis).every((v) => typeof v === 'number')],
    ['/audit-logs', (b) => b.auditLogs.length > 5],
    ['/connectors', (b) => Array.isArray(b.connectors) && b.connectors.length >= 1],
    ['/data-discovery/assets', (b) => b.dataAssets.some((a) => a.name === 'loan_applications_sample.csv')],
    ['/data-map', (b) => b.nodes.length > 6 && b.edges.length >= 1],
    ['/consents', (b) => b.consents.length >= 3],
    ['/dsars', (b) => b.dsars.length >= 1],
    ['/rag/knowledge-bases', (b) => b.knowledgeBases[0].name === 'Support Policy KB'],
    ['/shadow-ai/events', (b) => b.events.length >= 1],
    ['/shadow-ai/policies', (b) => b.policies.length >= 2],
    ['/shadow-ai/dashboard', (b) => b.kpis.totalEvents >= 1],
    ['/dpias', (b) => b.dpias.length >= 1],
    ['/compliance', (b) => b.controls.length >= 1],
    ['/decisions', (b) => b.decisions.length >= 1],
    ['/appeals', (b) => b.appeals.length >= 1],
    ['/incidents', (b) => b.incidents.length >= 2],
    ['/emergency/actions', (b) => b.actions.length >= 2],
    ['/monitoring', (b) => typeof b.monitoring.openIncidents === 'number' && b.dpdp && b.governance],
    ['/nominees', (b) => b.nominees.length >= 1],
    ['/settings/dpdp', (b) => b.settings.dpoEmail === 'dpo@abcbank.demo' && b.sdfChecklist.length === 4],
    ['/vendors', (b) => b.vendors.length === 2],
    ['/evidence', (b) => b.evidence.length >= 1 && b.evidence[0].content === undefined],
    ['/webhooks', (b) => Array.isArray(b.endpoints)],
    ['/users', (b) => b.users.length === 9],
    ['/intake', (b) => b.intakes.length >= 1],
    ['/audit-logs/verify', (b) => b.ok === true && b.checked >= 5],
  ];
  for (const [url, ok] of expectations) {
    const r = await json('admin', 'GET', url);
    assert.equal(r.status, 200, `${url} -> ${r.status} ${JSON.stringify(r.body)}`);
    assert.ok(ok(r.body), `${url} returned unexpected data: ${JSON.stringify(r.body).slice(0, 300)}`);
  }
});

test('E2E: every report downloads as CSV with a header and rows', async (t) => {
  if (!need(t)) return;
  for (const type of ['ai-inventory', 'ai-risk', 'shadow-ai', 'dsar', 'incidents', 'audit-evidence', 'dpdp-breach-register']) {
    const r = await call('admin', 'GET', `/reports/${type}`);
    assert.equal(r.status, 200, type);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    const text = await r.text();
    assert.ok(text.split('\n').length >= 2, `${type} has no rows`);
  }
  assert.equal((await call('admin', 'GET', '/reports/nope')).status, 404);
});

// ------------------------------------------------------------------ write flows (real Prisma)
const mp = (fields, fileName, content, mime = 'text/plain') => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  f.append('file', new Blob([content], { type: mime }), fileName);
  return f;
};
const byName = async (who, url, key, name) => (await json(who, 'GET', url)).body[key].find((x) => x.name === name);
let kids, ats;

test('E2E: AI system lifecycle — create with DPDP flags, vendor-linked risk assessment, RBAC, archive', async (t) => {
  if (!need(t)) return;
  ats = (await json('admin', 'GET', '/vendors')).body.vendors.find((v) => v.name === 'ThirdPartyATS Inc.');
  const c = await json('governance', 'POST', '/ai-systems', {
    name: 'E2E Kids Recommender', purpose: 'test', personalDataCategories: ['Name'], automatedDecisionUsage: true, humanOversight: false,
    processesChildrensData: true, behavioralTrackingOrAds: true, vendorId: ats.id, retentionPeriodDays: 30,
  });
  assert.equal(c.status, 201, `create failed: ${JSON.stringify(c.body)}`);
  kids = c.body.aiSystem;

  const a = await json('governance', 'POST', `/ai-systems/${kids.id}/assess-risk`);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.ok(['HIGH', 'CRITICAL'].includes(a.body.assessment.classification));
  const keys = a.body.assessment.firedFactors.map((f) => f.key);
  for (const k of ['childrenNoSafeguard', 'vendorNoDpa', 'noHumanOversight']) assert.ok(keys.includes(k), `missing factor ${k}: ${keys}`);
  assert.match(a.body.aiSystem.riskRationale, /Section 9/);

  const one = await json('governance', 'GET', `/ai-systems/${kids.id}`);
  assert.equal(one.body.aiSystem.vendorRecord.name, 'ThirdPartyATS Inc.');
  assert.ok(one.body.auditTrail.length >= 2, 'creation and assessment are audited');

  assert.equal((await json('readonly', 'PUT', `/ai-systems/${kids.id}`, { status: 'PRODUCTION' })).status, 403);
  const blocked = await json('governance', 'PUT', `/ai-systems/${kids.id}`, { status: 'PRODUCTION' });
  assert.equal(blocked.status, 409, 'the production gate correctly blocks this system (no DPIA, no oversight, children+tracking)');
  assert.equal((await json('governance', 'PUT', `/ai-systems/${kids.id}`, { name: 'E2E Kids Recommender (renamed)' })).status, 200, 'an ungated field still updates freely');
  assert.equal((await json('governance', 'PUT', `/ai-systems/${kids.id}`, { vendorId: '00000000-0000-4000-8000-000000000000' })).status, 404, 'vendor must exist in tenant');
  const filtered = await json('governance', 'GET', '/ai-systems?risk=CRITICAL&status=PRODUCTION');
  assert.equal(filtered.status, 200);
  assert.equal((await json('governance', 'GET', '/ai-systems?q=e2e kids')).body.aiSystems.length, 1, 'case-insensitive search');
});

test('E2E: DPIA flow — pre-filled 17 sections, approval by DPO only, approved DPIA is immutable', async (t) => {
  if (!need(t)) return;
  const d = await json('owner', 'POST', '/dpias', { aiSystemId: kids.id });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  const dpia = d.body.dpia;
  assert.equal(Object.keys(dpia.sections).length, 17);
  assert.equal(dpia.sections['2_purpose'], 'test');
  assert.equal((await json('owner', 'POST', `/dpias/${dpia.id}/decide`, { approve: true })).status, 403);
  assert.equal((await json('governance', 'POST', `/dpias/${dpia.id}/submit`)).body.dpia.status, 'IN_REVIEW');
  assert.equal((await json('dpo', 'POST', `/dpias/${dpia.id}/decide`, { approve: true })).body.dpia.status, 'APPROVED');
  assert.equal((await json('governance', 'GET', `/ai-systems/${kids.id}`)).body.aiSystem.dpiaStatus, 'COMPLETED');
  assert.equal((await json('governance', 'PUT', `/dpias/${dpia.id}`, { sections: { '2_purpose': 'changed' } })).status, 400);
});

test('E2E: consent withdrawal drives DSAR → impact → real DELETE → attestation → close (and minor-consent rule)', async (t) => {
  if (!need(t)) return;
  const minor = await json('privacy', 'POST', '/consents', { dataSubjectIdentifier: 'kid@x.com', purpose: 'p', isMinorDataSubject: true });
  assert.equal(minor.status, 400);

  const consents = (await json('privacy', 'GET', '/consents')).body.consents;
  const ritika = consents.find((c) => c.dataSubjectIdentifier === 'ritika.gupta@abcbank.demo' && c.status === 'GRANTED');
  const w = await json('privacy', 'POST', `/consents/${ritika.id}/withdraw`);
  assert.equal(w.status, 200, JSON.stringify(w.body));
  assert.ok(w.body.impactRecordCount >= 1 && w.body.actionCount >= 2);
  assert.equal((await json('privacy', 'POST', `/consents/${ritika.id}/withdraw`)).status, 400, 'cannot withdraw twice');

  const dsar = (await json('privacy', 'GET', `/dsars/${w.body.dsar.id}`)).body.dsar;
  assert.equal(dsar.requestType, 'CONSENT_WITHDRAWAL');
  assert.ok(dsar.dueDate, 'due date auto-set from tenant window');
  const types = dsar.actions.map((a) => a.actionType);
  for (const x of ['DELETE', 'EXCLUDE', 'RETRAIN']) assert.ok(types.includes(x), `expected ${x} in ${types}`);

  assert.equal((await json('privacy', 'POST', `/dsars/${dsar.id}/close`)).status, 400, 'open actions block closing');
  for (const a of dsar.actions) {
    if (a.actionType === 'DELETE') {
      const ex = await json('privacy', 'POST', `/dsars/${dsar.id}/actions/${a.id}/execute`);
      assert.equal(ex.status, 200, JSON.stringify(ex.body));
      assert.ok(ex.body.deletedCount >= 1);
    } else {
      assert.equal((await json('privacy', 'POST', `/dsars/${dsar.id}/actions/${a.id}/execute`)).status, 400, 'integration actions cannot be executed');
      assert.equal((await json('privacy', 'POST', `/dsars/${dsar.id}/actions/${a.id}/attest`, { comments: 'short' })).status, 400);
      const at = await json('privacy', 'POST', `/dsars/${dsar.id}/actions/${a.id}/attest`, { comments: 'Excluded from the next training run in the ML pipeline; ticket ML-991' });
      assert.equal(at.body.action.status, 'MANUALLY_ATTESTED');
    }
  }
  assert.equal((await json('privacy', 'POST', `/dsars/${dsar.id}/close`)).body.dsar.status, 'CLOSED');

  const fm = await json('privacy', 'GET', '/find-me-in-ai?identifier=ritika.gupta@abcbank.demo');
  assert.equal(fm.body.foundIn.length, 0, 'removed from the index');
  assert.equal((await json('auditor', 'GET', '/find-me-in-ai?identifier=x')).status, 403, 'auditor cannot search data subjects');
});

test('E2E: Shadow AI — real PII scan of an attached file, CREATE_INCIDENT policy opens a real incident', async (t) => {
  if (!need(t)) return;
  const pol = await json('security', 'POST', '/shadow-ai/policies', { name: 'E2E incident on PII', action: 'CREATE_INCIDENT', priority: -5, requireExternalAi: true, requirePersonalData: true });
  assert.equal(pol.status, 201, JSON.stringify(pol.body));
  const csv = 'name,email\nAnita,anita@corp.example\nBala,bala@corp.example\nChitra,chitra@corp.example\n';
  const r = await call('security', 'POST', '/shadow-ai/events', null, mp({ employeeIdentifier: 'E2E User', application: 'SomeAI', eventType: 'FILE_UPLOAD_TO_AI', isExternalAi: 'true' }, 'customers.csv', csv, 'text/csv'));
  const body = await r.json();
  assert.equal(r.status, 201, JSON.stringify(body));
  assert.equal(body.event.piiDetected, true);
  assert.ok(body.event.piiCategories.includes('Email'));
  assert.equal(body.event.recommendedAction, 'CREATE_INCIDENT');
  assert.equal(body.event.enforced, false);
  assert.ok(body.incident && body.incident.type === 'SHADOW_AI');
  const inc = (await json('security', 'GET', '/incidents')).body.incidents.find((i) => i.id === body.incident.id);
  assert.equal(inc.shadowAiEvent.application, 'SomeAI');
  const dash = await json('security', 'GET', '/shadow-ai/dashboard');
  assert.ok(dash.body.kpis.eventsWithPii >= 2);
});

test('E2E: personal-data breach — cannot close until the Board and data principals are recorded as notified', async (t) => {
  if (!need(t)) return;
  const inc = (await json('security', 'POST', '/incidents', { type: 'PII_LEAKAGE', description: 'E2E breach', isPersonalDataBreach: true, affectedDataSubjectCount: 10 })).body.incident;
  assert.equal(inc.dpbNotificationRequired, true);
  for (let i = 0; i < 5; i++) assert.equal((await json('security', 'POST', `/incidents/${inc.id}/advance`, {})).status, 200);
  assert.equal((await json('security', 'POST', `/incidents/${inc.id}/advance`, {})).status, 400);
  await json('security', 'POST', `/incidents/${inc.id}/breach-notification`, { dpbNotified: true, principalsNotified: true });
  assert.equal((await json('security', 'POST', `/incidents/${inc.id}/advance`, {})).body.incident.status, 'CLOSED');
  const reg = await (await call('admin', 'GET', '/reports/dpdp-breach-register')).text();
  assert.match(reg, /E2E breach/);
});

test('E2E: decisions — human review needs reasons, single review only, appeals run to a decision', async (t) => {
  if (!need(t)) return;
  const sys = await byName('admin', '/ai-systems', 'aiSystems', 'Loan Decision Engine');
  const d = (await json('owner', 'POST', '/decisions', { aiSystemId: sys.id, dataSubjectIdentifier: 'zed@x.com', decision: 'Declined', riskLevel: 'HIGH' })).body.decision;
  assert.equal(d.reviewStatus, 'PENDING');
  assert.equal((await json('owner', 'POST', `/decisions/${d.id}/approve`)).status, 403, 'owners cannot review');
  assert.equal((await json('reviewer', 'POST', `/decisions/${d.id}/override`, {})).status, 400, 'override needs a reason');
  const o = await json('reviewer', 'POST', `/decisions/${d.id}/override`, { overrideReason: 'Income proof supplied', finalOutcome: 'Approved' });
  assert.equal(o.body.decision.reviewStatus, 'OVERRIDDEN');
  assert.equal((await json('reviewer', 'POST', `/decisions/${d.id}/approve`)).status, 400, 'already reviewed');

  const ap = (await json('governance', 'POST', '/appeals', { decisionId: d.id, dataSubjectIdentifier: 'zed@x.com', reason: 'Please reconsider' })).body.appeal;
  assert.equal((await json('governance', 'POST', `/appeals/${ap.id}/investigate`)).body.appeal.status, 'UNDER_INVESTIGATION');
  assert.equal((await json('governance', 'POST', `/appeals/${ap.id}/decide`, { outcome: 'Upheld the override' })).body.appeal.status, 'DECIDED');
});

test('E2E: dual-approval kill switch — requester cannot approve; a second person suspends the system', async (t) => {
  if (!need(t)) return;
  const pending = (await json('admin', 'GET', '/emergency/actions')).body.actions.find((a) => a.status === 'PENDING_APPROVAL');
  assert.ok(pending, 'seeded pending action');
  assert.equal((await json('governance', 'POST', `/emergency/actions/${pending.id}/approve`, {})).status, 403, 'requester');
  assert.equal((await json('reviewer', 'POST', `/emergency/actions/${pending.id}/approve`, {})).status, 403, 'no permission');
  const ok = await json('security', 'POST', `/emergency/actions/${pending.id}/approve`, { note: 'confirmed' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await byName('admin', '/ai-systems', 'aiSystems', 'Loan Decision Engine')).status, 'SUSPENDED');
  const loanSys = await byName('admin', '/ai-systems', 'aiSystems', 'Loan Decision Engine'); // now SUSPENDED, still a valid target
  const clean2 = (await json('governance', 'POST', '/ai-systems', { name: 'E2E Clean Prod Candidate', purpose: 'x' })).body.aiSystem;
  await json('governance', 'PUT', `/ai-systems/${clean2.id}`, { status: 'PRODUCTION' }); // no personal data -> no gate -> succeeds directly, no approval needed
  const fresh = await json('governance', 'POST', `/emergency/ai-systems/${clean2.id}/actions`, { actionType: 'STOP_AI_SYSTEM', reason: 'Clean system under review' });
  assert.equal(fresh.body.action.status, 'PENDING_APPROVAL', 'a Production system needs approval');
  assert.equal((await json('security', 'POST', `/emergency/actions/${fresh.body.action.id}/reject`, { note: 'not needed' })).body.action.status, 'REJECTED');
  assert.equal((await json('governance', 'GET', `/ai-systems/${clean2.id}`)).body.aiSystem.status, 'PRODUCTION', 'rejected → untouched');
  void loanSys;
});

test('E2E: evidence — hashed upload, separation of duties, integrity-checked download, tamper detected in the real DB', async (t) => {
  if (!need(t)) return;
  const content = 'E2E evidence body ' + Date.now();
  const up1 = await call('owner', 'POST', '/evidence', null, mp({ title: 'E2E evidence' }, 'note.txt', content));
  assert.equal(up1.status, 201, await up1.clone().text());
  const ev = (await up1.json()).evidence;
  assert.equal((await json('owner', 'POST', `/evidence/${ev.id}/review`, { status: 'ACCEPTED' })).status, 403);
  assert.equal((await json('privacy', 'POST', `/evidence/${ev.id}/review`, { status: 'ACCEPTED' })).body.evidence.reviewStatus, 'ACCEPTED');
  const dl = await call('auditor', 'GET', `/evidence/${ev.id}/download`);
  assert.equal(dl.status, 200);
  assert.equal(await dl.text(), content, 'bytes round-trip through the real bytea column');
  assert.equal((await json('auditor', 'POST', `/evidence/${ev.id}/verify`)).body.intact, true);

  const prisma = require('../src/lib/prisma');
  await prisma.evidence.update({ where: { id: ev.id }, data: { content: Buffer.from('tampered directly in the database') } });
  assert.equal((await call('auditor', 'GET', `/evidence/${ev.id}/download`)).status, 409);
  assert.equal((await json('auditor', 'POST', `/evidence/${ev.id}/verify`)).body.intact, false);
});

test('E2E: file scan + Find Me in AI — found via the index; a partial scan never yields Not found', async (t) => {
  if (!need(t)) return;
  const small = 'email,phone\nfind.me@corp.example,9876501234\nother@corp.example,9876501235\n';
  const s1 = await call('governance', 'POST', '/data-discovery/scan', null, mp({ aiSystemId: kids.id, relationship: 'TRAINED_ON' }, 'kids_small.csv', small, 'text/csv'));
  const b1 = await s1.json();
  assert.equal(s1.status, 201, JSON.stringify(b1));
  assert.equal(b1.scanComplete, true);
  assert.ok(b1.findings.some((f) => f.category === 'Email'));
  let fm = await json('privacy', 'GET', '/find-me-in-ai?identifier=find.me@corp.example');
  assert.equal(fm.body.aiSystems.find((x) => x.aiSystemId === kids.id).status, 'FOUND');
  assert.equal(fm.body.foundIn[0].value, 'find.me@corp.example', 'privacy officers see unmasked values');
  fm = await json('privacy', 'GET', '/find-me-in-ai?identifier=nobody@corp.example');
  assert.equal(fm.body.aiSystems.find((x) => x.aiSystemId === kids.id).status, 'NOT_FOUND', 'fully scanned, absent');

  let big = 'email\n';
  for (let i = 0; i < 2500; i++) big += `bulk${i}@corp.example\n`;
  const s2 = await call('governance', 'POST', '/data-discovery/scan', null, mp({ aiSystemId: kids.id }, 'kids_big.csv', big, 'text/csv'));
  const b2 = await s2.json();
  assert.equal(b2.scanComplete, false, 'over the scan limits');
  assert.match(b2.note, /partial/i);
  fm = await json('privacy', 'GET', '/find-me-in-ai?identifier=nobody@corp.example');
  const st = fm.body.aiSystems.find((x) => x.aiSystemId === kids.id);
  assert.equal(st.status, 'UNKNOWN');
  assert.match(st.reason, /partially scanned/);
});

test('E2E: RAG ingestion chunks a document for real; vendors and webhooks enforce their rules', async (t) => {
  if (!need(t)) return;
  const kb = (await json('admin', 'GET', '/rag/knowledge-bases')).body.knowledgeBases[0];
  const text = Array.from({ length: 6 }, (_, i) => `Section ${i}. ` + 'policy '.repeat(150)).join('\n\n');
  const r = await call('governance', 'POST', `/rag/knowledge-bases/${kb.id}/documents`, null, mp({}, 'policy.txt', text));
  const b = await r.json();
  assert.equal(r.status, 201, JSON.stringify(b));
  assert.ok(b.chunkCount >= 2);
  const chunks = (await json('governance', 'GET', `/rag/knowledge-bases/${kb.id}/documents/${b.document.id}/chunks`)).body.chunks;
  assert.equal(chunks.length, b.chunkCount);
  assert.ok(chunks.every((c) => c.embeddingStatus === 'NOT_CONFIGURED'));

  assert.equal((await json('governance', 'POST', '/vendors', { name: 'NoDate AI', dpaSigned: true })).status, 400);
  assert.equal((await json('governance', 'POST', '/vendors', { name: 'Dated AI', dpaSigned: true, dpaSignedAt: '2026-03-01T00:00:00.000Z' })).status, 201);

  assert.equal((await json('governance', 'POST', '/webhooks', { url: 'https://10.0.0.5/hook' })).status, 400, 'private address refused');
  const wh = await json('governance', 'POST', '/webhooks', { url: 'https://8.8.8.8/hook', events: ['NEVER_MATCHES'] });
  assert.equal(wh.status, 201, JSON.stringify(wh.body));
  assert.match(wh.body.signingSecret, /^whsec_/);
  assert.equal(JSON.stringify((await json('governance', 'GET', '/webhooks')).body).includes(wh.body.signingSecret), false);
});

test('E2E: DPDP settings, nominee-raised DSAR and audit trail', async (t) => {
  if (!need(t)) return;
  assert.equal((await json('dpo', 'PUT', '/settings/dpdp', { dpoEmail: 'not-an-email' })).status, 400);
  assert.equal((await json('readonly', 'PUT', '/settings/dpdp', { dsarResponseDays: 10 })).status, 403);
  assert.equal((await json('dpo', 'PUT', '/settings/dpdp', { dsarResponseDays: 20 })).status, 200);

  const nominee = (await json('privacy', 'GET', '/nominees')).body.nominees[0];
  const bad = await json('privacy', 'POST', '/dsars', { dataSubjectIdentifier: 'someone.else@x.com', requestType: 'ACCESS', actingNomineeId: nominee.id });
  assert.equal(bad.status, 400, 'nominee registered for a different data principal');
  const ok = await json('privacy', 'POST', '/dsars', { dataSubjectIdentifier: nominee.dataSubjectIdentifier, requestType: 'ACCESS', actingNomineeId: nominee.id });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const days = Math.round((new Date(ok.body.dsar.dueDate) - Date.now()) / 86400000);
  assert.ok(days === 20 || days === 19, `due date follows the tenant window (got ${days} days)`);

  const actions = new Set((await json('auditor', 'GET', '/audit-logs?limit=500')).body.auditLogs.map((l) => l.action));
  for (const a of ['AI_SYSTEM_CREATED', 'AI_SYSTEM_RISK_ASSESSED', 'DPIA_APPROVED', 'CONSENT_WITHDRAWN', 'REMEDIATION_ACTION_EXECUTED', 'EMERGENCY_ACTION_APPROVED', 'EVIDENCE_UPLOADED', 'DPDP_SETTINGS_UPDATED', 'DSAR_CREATED', 'INCIDENT_CREATED']) {
    assert.ok(actions.has(a), `audit trail is missing ${a}`);
  }
});

test('E2E: tenant isolation — a second tenant sees and can change nothing of the first', async (t) => {
  if (!need(t)) return;
  const prisma = require('../src/lib/prisma');
  const bcrypt = require('bcryptjs');
  const t2 = await prisma.tenant.create({ data: { name: 'Other Bank' } });
  await prisma.user.create({ data: { tenantId: t2.id, email: 'admin@otherbank.demo', name: 'Other Admin', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash('Other@1234', 10) } });
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@otherbank.demo', password: 'Other@1234' }) });
  tokens.other = (await login.json()).token;

  for (const [url, key] of [['/ai-systems', 'aiSystems'], ['/consents', 'consents'], ['/dsars', 'dsars'], ['/vendors', 'vendors'], ['/evidence', 'evidence'], ['/incidents', 'incidents'], ['/data-discovery/assets', 'dataAssets'], ['/shadow-ai/events', 'events'], ['/decisions', 'decisions']]) {
    const r = await json('other', 'GET', url);
    assert.equal(r.status, 200, url);
    assert.equal(r.body[key].length, 0, `${url} leaks another tenant's rows`);
  }
  const audit = (await json('other', 'GET', '/audit-logs')).body.auditLogs;
  assert.ok(audit.every((l) => l.action === 'LOGIN'), 'the other tenant only sees its own login events, none of the first tenant\'s activity');
  assert.equal((await json('other', 'GET', `/ai-systems/${kids.id}`)).status, 404);
  assert.equal((await json('other', 'PUT', `/ai-systems/${kids.id}`, { name: 'hijack' })).status, 404);
  assert.equal((await json('other', 'POST', `/ai-systems/${kids.id}/assess-risk`)).status, 404);
  assert.equal((await json('other', 'POST', '/dpias', { aiSystemId: kids.id })).status, 404);
  const consent = (await json('privacy', 'GET', '/consents')).body.consents[0];
  assert.equal((await json('other', 'POST', `/consents/${consent.id}/withdraw`)).status, 404);
  assert.equal((await json('other', 'GET', '/find-me-in-ai?identifier=find.me@corp.example')).body.foundIn.length, 0);
  assert.equal((await json('other', 'GET', '/settings/dpdp')).body.settings.dpoEmail, null, 'own settings, not the other tenant\'s');
});

test('E2E: create endpoints accept null for unselected optional fields, exactly as the UI posts them', async (t) => {
  if (!need(t)) return;
  const consent = await json('privacy', 'POST', '/consents', { dataSubjectIdentifier: 'nulls@x.com', purpose: 'p', aiSystemId: null, dataCategory: '', legalBasis: '', source: '', isMinorDataSubject: false, parentalConsentVerified: false });
  assert.equal(consent.status, 201, JSON.stringify(consent.body));
  const incident = await json('security', 'POST', '/incidents', { type: 'PII_LEAKAGE', aiSystemId: null, severity: 'MEDIUM', description: 'null fields', isPersonalDataBreach: false, affectedDataSubjectCount: null });
  assert.equal(incident.status, 201, JSON.stringify(incident.body));
  const kb = await json('governance', 'POST', '/rag/knowledge-bases', { name: 'Null KB', description: '', aiSystemId: null });
  assert.equal(kb.status, 201, JSON.stringify(kb.body));
  const control = await json('governance', 'POST', '/compliance', { framework: 'DPDP', requirement: 'r', control: 'c', controlType: 'LEGAL_REQUIREMENT', aiSystemId: null, evidenceNote: '' });
  assert.equal(control.status, 201, JSON.stringify(control.body));
  const dsar = await json('privacy', 'POST', '/dsars', { dataSubjectIdentifier: 'nulls@x.com', requestType: 'ACCESS', notes: '' });
  assert.equal(dsar.status, 201, JSON.stringify(dsar.body));
});


// ------------------------------------------------------------------ Phase 13: accounts, MFA, audit chain, gate, portal
test('E2E: audit chain is intact from a real seed run, and a direct SQL tamper is detected', async (t) => {
  if (!need(t)) return;
  const before = await json('auditor', 'GET', '/audit-logs/verify');
  assert.equal(before.body.ok, true, JSON.stringify(before.body));
  assert.ok(before.body.checked >= 5);

  const { Client } = require('pg');
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  const row = (await c.query('SELECT id, seq FROM audit_logs WHERE "tenantId" = $1 AND seq IS NOT NULL ORDER BY seq ASC LIMIT 1', ['00000000-0000-0000-0000-000000000001'])).rows[0];
  await c.query('ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update'); // bypass the DB-level guard, the way a superuser could
  await c.query(`UPDATE audit_logs SET action = 'TAMPERED' WHERE id = $1`, [row.id]);
  await c.query('ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update');
  await c.end();

  const after = await json('auditor', 'GET', '/audit-logs/verify');
  assert.equal(after.body.ok, false);
  assert.equal(after.body.brokenAtSeq, row.seq);
  assert.equal((await json('owner', 'GET', '/audit-logs/verify')).status, 403, 'read-only-ish roles cannot verify the chain');
});

test('E2E: append-only trigger refuses a direct UPDATE/DELETE at the database level (not just at the API)', async (t) => {
  if (!need(t)) return;
  const { Client } = require('pg');
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  await assert.rejects(c.query(`UPDATE audit_logs SET action = 'X' WHERE "tenantId" = '00000000-0000-0000-0000-000000000001' AND seq = (SELECT MIN(seq) FROM audit_logs WHERE "tenantId" = '00000000-0000-0000-0000-000000000001')`), /append-only/);
  await c.end();
});

let inviteToken, invitedUserId;
test('E2E: inviting a user — no email, a one-time link, privilege-escalation guard, cannot invite a duplicate', async (t) => {
  if (!need(t)) return;
  assert.equal((await json('reviewer', 'POST', '/users', { email: 'nope@abcbank.demo', name: 'Nope', role: 'READ_ONLY' })).status, 403, 'no user:manage permission');
  assert.equal((await json('privacy', 'POST', '/users', { email: 'wannabe@abcbank.demo', name: 'W', role: 'SUPER_ADMIN' })).status, 403, 'only a Super Admin can create a Super Admin');
  const dup = await json('governance', 'POST', '/users', { email: 'DPO@abcbank.demo', name: 'Dup', role: 'READ_ONLY' });
  assert.equal(dup.status, 409, 'case-insensitive duplicate email');

  const r = await json('governance', 'POST', '/users', { email: 'newhire@abcbank.demo', name: 'New Hire', role: 'HUMAN_REVIEWER' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.body.invite.token && r.body.invite.path.includes(r.body.invite.token));
  assert.equal(r.body.user.status, 'invited');
  inviteToken = r.body.invite.token; invitedUserId = r.body.user.id;

  assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'newhire@abcbank.demo', password: 'whatever-it-is-not-active-1234' }) })).status, 401, 'invited but not yet active cannot sign in');
});

test('E2E: accepting an invite enforces the password policy, is single-use, and then the account can sign in', async (t) => {
  if (!need(t)) return;
  const weak = await fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: inviteToken, password: 'short' }) });
  assert.equal(weak.status, 400);

  const ok = await fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: inviteToken, password: 'correct horse battery staple 42' }) });
  assert.equal(ok.status, 200, JSON.stringify(await ok.clone().json()));
  const again = await fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: inviteToken, password: 'another correct horse battery 99' }) });
  assert.equal(again.status, 400, 'a used invite token cannot be reused');

  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'newhire@abcbank.demo', password: 'correct horse battery staple 42' }) });
  assert.equal(login.status, 200);
  tokens.newhire = (await login.json()).token;
  assert.equal((await json('newhire', 'GET', '/decisions')).status, 200);
});

test('E2E: account lockout after repeated failures, and it clears on a correct password', async (t) => {
  if (!need(t)) return;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'newhire@abcbank.demo', password: 'wrong-one-' + i }) });
    assert.equal(r.status, 401);
  }
  const stillWrong = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'newhire@abcbank.demo', password: 'correct horse battery staple 42' }) });
  assert.equal(stillWrong.status, 401, 'locked out even with the correct password');

  const prisma = require('../src/lib/prisma');
  await prisma.user.update({ where: { id: invitedUserId }, data: { lockedUntil: new Date(Date.now() - 1000), failedLoginCount: 0 } }); // fast-forward the lock
  const now = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'newhire@abcbank.demo', password: 'correct horse battery staple 42' }) });
  assert.equal(now.status, 200);
});

test('E2E: MFA enrolment (real TOTP), a wrong code fails, sign-in requires it after, a recovery code works once', async (t) => {
  if (!need(t)) return;
  const totp = require('../src/lib/totp');
  const setup = await json('newhire', 'POST', '/auth/mfa/setup');
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  assert.equal((await json('newhire', 'POST', '/auth/mfa/enable', { code: '000000' })).status, 400);
  const en = await json('newhire', 'POST', '/auth/mfa/enable', { code: totp.totp(setup.body.secret) });
  assert.equal(en.status, 200, JSON.stringify(en.body));
  assert.equal(en.body.recoveryCodes.length, 10);

  const step1 = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'newhire@abcbank.demo', password: 'correct horse battery staple 42' }) });
  const s1 = await step1.json();
  assert.equal(s1.mfaRequired, true);
  assert.equal((await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: s1.mfaToken, code: totp.totp(setup.body.secret) }) })).status, 401, 'the same 30s code cannot be reused across a fresh login step');
  const recovery = en.body.recoveryCodes[0];
  const rc = await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: s1.mfaToken, recoveryCode: recovery }) });
  assert.equal(rc.status, 200);
  tokens.newhire = (await rc.json()).token;
  const again = await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: s1.mfaToken, recoveryCode: recovery }) });
  assert.equal(again.status, 401, 'a recovery code is single-use');
});

test('E2E: sessions — listed, logged out remotely, and revoked on password change', async (t) => {
  if (!need(t)) return;
  const sessions = await json('newhire', 'GET', '/auth/sessions');
  assert.ok(sessions.body.sessions.length >= 1);
  const totp = require('../src/lib/totp');
  const setupLogin = async () => {
    const step1 = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'newhire@abcbank.demo', password: 'correct horse battery staple 42' }) })).json();
    const prisma = require('../src/lib/prisma');
    const u = await prisma.user.findUnique({ where: { id: invitedUserId } });
    const { decryptSecret } = require('../src/lib/secrets');
    const r = await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: step1.mfaToken, code: totp.totp(decryptSecret(u.mfaSecretEncrypted), Date.now() + 30_000) }) });
    return (await r.json()).token;
  };
  const otherToken = await setupLogin();
  tokens.newhire2 = otherToken;
  assert.equal((await json('newhire2', 'GET', '/auth/me')).status, 200);
  const listed = await json('newhire', 'GET', '/auth/sessions');
  assert.ok(listed.body.sessions.length >= 2);
  const other = listed.body.sessions.find((s) => !s.current);
  await call('newhire', 'DELETE', `/auth/sessions/${other.id}`);
  assert.equal((await json('newhire2', 'GET', '/auth/me')).status, 401, 'revoked session cannot be used');

  const cp = await json('newhire', 'POST', '/auth/change-password', { currentPassword: 'correct horse battery staple 42', newPassword: 'another totally different phrase 7' });
  assert.equal(cp.status, 200, JSON.stringify(cp.body));
  assert.equal((await json('newhire', 'GET', '/auth/me')).status, 200, 'the session used to change the password stays valid');
});

test('E2E: an admin resets another user\'s password and can revoke all of their sessions', async (t) => {
  if (!need(t)) return;
  const rp = await json('governance', 'POST', `/users/${invitedUserId}/reset-password`);
  assert.equal(rp.status, 201);
  const finish = await fetch(`${base}/auth/reset-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: rp.body.reset.token, password: 'yet another passphrase entirely 9' }) });
  assert.equal(finish.status, 200);
  assert.equal((await json('newhire', 'GET', '/auth/me')).status, 401, 'resetting the password revokes existing sessions');

  const revoke = await json('governance', 'POST', `/users/${invitedUserId}/revoke-sessions`);
  assert.equal(revoke.status, 200);
  assert.equal((await json('governance', 'PUT', `/users/${invitedUserId}`, { isActive: false })).status, 200);
  const dead = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'newhire@abcbank.demo', password: 'yet another passphrase entirely 9' }) });
  assert.equal(dead.status, 401, 'deactivated user cannot sign in');
});

test('E2E: organisation-wide MFA requirement restricts an unenrolled session to /auth/* only', async (t) => {
  if (!need(t)) return;
  try {
    assert.equal((await json('readonly', 'PUT', '/users/policy', { requireMfa: true })).status, 403);
    const on = await json('governance', 'PUT', '/users/policy', { requireMfa: true });
    assert.equal(on.status, 200, JSON.stringify(on.body));

    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'readonly@abcbank.demo', password: 'Demo@1234' }) });
    const lb = await login.json();
    assert.equal(lb.mfaSetupRequired, true);
    tokens.readonly = lb.token;
    const blocked = await json('readonly', 'GET', '/ai-systems');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'MFA_ENROLLMENT_REQUIRED');
    assert.equal((await json('readonly', 'GET', '/auth/me')).status, 200, 'auth endpoints remain usable to complete enrolment');
    assert.equal((await json('readonly', 'POST', '/auth/mfa/disable', { password: 'Demo@1234', code: '000000' })).status, 403, 'cannot turn off MFA the org requires');

    const totp = require('../src/lib/totp');
    const setup = await json('readonly', 'POST', '/auth/mfa/setup');
    await json('readonly', 'POST', '/auth/mfa/enable', { code: totp.totp(setup.body.secret) });
    assert.equal((await json('readonly', 'GET', '/ai-systems')).status, 200, 'unblocked once enrolled');

    // Turning the requirement on restricted governance's OWN session too (they hadn't enrolled either) —
    // by design (Section 26-style: the policy applies to everyone, including whoever set it). The only way
    // out is the same self-service enrolment path just proven above; confirm it here before relying on
    // `tokens.governance` again for the rest of the suite.
    assert.equal((await json('governance', 'GET', '/ai-systems')).status, 403, "turning the policy on restricted the admin's own session too");
    const govSetup = await json('governance', 'POST', '/auth/mfa/setup');
    assert.equal(govSetup.status, 200, 'MFA setup remains reachable while restricted');
    await json('governance', 'POST', '/auth/mfa/enable', { code: totp.totp(govSetup.body.secret) });
    assert.equal((await json('governance', 'GET', '/ai-systems')).status, 200, 'self-recovery: enrolling unblocks the same session with no new login');
  } finally {
    await json('governance', 'PUT', '/users/policy', { requireMfa: false }); // always restore, even if an assertion above failed
  }
});

test('E2E: production gate blocks unsafe transitions and a documented override is audited', async (t) => {
  if (!need(t)) return;
  const risky = await json('governance', 'POST', '/ai-systems', { name: 'Gate Test System', purpose: 'x', personalDataCategories: ['Email'], automatedDecisionUsage: true, humanOversight: false });
  assert.equal(risky.status, 201);
  const sys = risky.body.aiSystem;

  const gate = await json('governance', 'GET', `/ai-systems/${sys.id}/production-gate`);
  assert.ok(gate.body.gate.blockers.some((b) => b.code === 'DPIA_NOT_APPROVED'));
  assert.ok(gate.body.gate.blockers.some((b) => b.code === 'NO_HUMAN_OVERSIGHT'));
  assert.equal(gate.body.canOverride, true, 'AI Governance Admin can override');

  const blocked = await json('governance', 'PUT', `/ai-systems/${sys.id}`, { status: 'PRODUCTION' });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.ok(blocked.body.blockers.length >= 2);
  assert.equal((await json('governance', 'GET', `/ai-systems/${sys.id}`)).body.aiSystem.status, 'PROPOSED', 'unchanged after a blocked attempt');

  const noReason = await json('governance', 'PUT', `/ai-systems/${sys.id}`, { status: 'PRODUCTION', gateOverrideReason: 'short' });
  assert.equal(noReason.status, 400, 'override reason is validated (min 20 chars) before the gate even runs');

  const owner = await json('owner', 'PUT', `/ai-systems/${sys.id}`, { status: 'PRODUCTION', gateOverrideReason: 'Business justification for immediate launch despite open items' });
  assert.equal(owner.status, 409, 'AI System Owner has no override permission, so this is still blocked, not overridden');

  const override = await json('governance', 'PUT', `/ai-systems/${sys.id}`, { status: 'PRODUCTION', gateOverrideReason: 'Business justification for immediate launch despite open items' });
  assert.equal(override.status, 200, JSON.stringify(override.body));
  assert.equal(override.body.aiSystem.status, 'PRODUCTION');
  const trail = (await json('governance', 'GET', `/ai-systems/${sys.id}`)).body.auditTrail;
  assert.ok(trail.some((l) => l.action === 'AI_SYSTEM_GATE_OVERRIDDEN'));

  const clean = await json('governance', 'POST', '/ai-systems', { name: 'Clean System', purpose: 'x' });
  assert.equal((await json('governance', 'PUT', `/ai-systems/${clean.body.aiSystem.id}`, { status: 'PRODUCTION' })).status, 200, 'a system with no personal data and no automated decisions needs no DPIA');
});

test('E2E: public portal — submit, honeypot is silently accepted, status lookup needs the exact token, staff verify -> real DSAR with the correct due date', async (t) => {
  if (!need(t)) return;
  const info = await (await fetch(`${base}/public/abc-bank/info`)).json();
  assert.equal(info.dpo.email, 'dpo@abcbank.demo');
  assert.ok(info.requestTypes.some((x) => x.value === 'DELETION'));

  const honeypot = await fetch(`${base}/public/abc-bank/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ website: 'http://spam.example', requestType: 'DELETION', requesterName: 'Bot', contactType: 'EMAIL', contactValue: 'bot@example.com' }) });
  assert.equal(honeypot.status, 201, 'bots are told it "worked" so they move on');
  assert.equal((await json('privacy', 'GET', '/intake')).body.intakes.some((i) => i.requesterName === 'Bot'), false, 'nothing from the honeypot path is actually stored');

  const bad = await fetch(`${base}/public/abc-bank/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'DELETION', requesterName: 'X', contactType: 'EMAIL', contactValue: 'not-an-email' }) });
  assert.equal(bad.status, 400);

  const submit = await fetch(`${base}/public/abc-bank/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'DELETION', requesterName: 'Portal Test Person', contactType: 'EMAIL', contactValue: 'portal.test@example.com', dataSubjectIdentifier: 'portal.test@example.com', details: 'Please delete my data.' }),
  });
  const sub = await submit.json();
  assert.equal(submit.status, 201, JSON.stringify(sub));
  assert.match(sub.reference, /^DPR-/);

  const wrongToken = await fetch(`${base}/public/abc-bank/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: sub.reference, token: 'not-the-token' }) });
  assert.equal(wrongToken.status, 404, 'wrong token reveals nothing, not even that the reference exists');
  const status1 = await (await fetch(`${base}/public/abc-bank/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: sub.reference, token: sub.statusToken }) })).json();
  assert.equal(status1.state, 'RECEIVED');

  const list = await json('privacy', 'GET', '/intake');
  const intake = list.body.intakes.find((i) => i.reference === sub.reference);
  assert.ok(intake);
  assert.equal((await json('privacy', 'POST', `/intake/${intake.id}/verify`, { method: 'EMAIL_CALLBACK', note: 'sh' })).status, 400, 'verification note must be at least 10 characters');
  const verify = await json('privacy', 'POST', `/intake/${intake.id}/verify`, { method: 'EMAIL_CALLBACK', note: 'Called the number on file and confirmed identity by callback.' });
  assert.equal(verify.status, 200, JSON.stringify(verify.body));
  assert.equal(verify.body.dsar.dataSubjectIdentifier, 'portal.test@example.com');
  const receivedDay = new Date(intake.receivedAt).toDateString();
  const dueDay = new Date(verify.body.dsar.dueDate);
  assert.ok((dueDay - new Date(receivedDay)) / 86400000 >= 20, 'the response clock starts at receipt, not at verification');

  const status2 = await (await fetch(`${base}/public/abc-bank/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: sub.reference, token: sub.statusToken }) })).json();
  assert.equal(status2.state, 'IN_PROGRESS');
  assert.equal((await json('privacy', 'POST', `/intake/${intake.id}/verify`, { method: 'OTHER', note: 'trying again after verification' })).status, 400, 'an already-verified intake cannot be verified twice');
});

test('E2E: portal rejects the nominee mismatch the DSAR API also rejects', async (t) => {
  if (!need(t)) return;
  const nominee = (await json('privacy', 'GET', '/nominees')).body.nominees[0];
  const submit = await fetch(`${base}/public/abc-bank/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'ACCESS', requesterName: 'Someone Else', contactType: 'EMAIL', contactValue: 'else@example.com', dataSubjectIdentifier: 'not-the-nominees-person@example.com', isNominee: true, nomineeRelationship: 'Friend' }),
  });
  const sub = await submit.json();
  const intake = (await json('privacy', 'GET', '/intake')).body.intakes.find((i) => i.reference === sub.reference);
  const bad = await json('privacy', 'POST', `/intake/${intake.id}/verify`, { method: 'DOCUMENT_CHECK', note: 'Checked ID document at the branch counter.', actingNomineeId: nominee.id });
  assert.equal(bad.status, 400);

  const rej = await json('privacy', 'POST', `/intake/${intake.id}/reject`, { reason: 'Could not confirm this request maps to a registered nominee relationship.' });
  assert.equal(rej.status, 200);
  const status = await (await fetch(`${base}/public/abc-bank/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference: sub.reference, token: sub.statusToken }) })).json();
  assert.equal(status.state, 'NOT_ACCEPTED');
  assert.match(status.message, /registered nominee/);
});

test('E2E: the portal is tenant-scoped by slug and cannot see or act on another organisation\'s data', async (t) => {
  if (!need(t)) return;
  const prisma = require('../src/lib/prisma');
  await prisma.tenant.update({ where: { id: (await prisma.tenant.findFirst({ where: { name: 'Other Bank' } })).id }, data: { slug: 'other-bank' } });
  assert.equal((await fetch(`${base}/public/no-such-org/info`)).status, 404);
  const otherInfo = await (await fetch(`${base}/public/other-bank/info`)).json();
  assert.equal(otherInfo.dpo, null, 'Other Bank never configured a DPO contact');
  assert.equal((await json('other', 'GET', '/intake')).body.intakes.length, 0, 'tenant isolation holds for intake too');
});
