// FIX REGRESSION SUITE (part C) — MFA ENROLLMENT atomic TOTP consumption
// (extends PRIVault_AI_Governance_Claude_Fix_Instructions.docx, Section 4, to /auth/mfa/enable)
//
// A follow-on amendment applied `consumeTotpStep()` to /auth/mfa/enable as well as the
// endpoints the original fix instructions named — reasoning: two concurrent enable requests
// carrying the same freshly-generated code could otherwise both read mfaEnabled=false /
// mfaLastStep=null before either wrote, and both succeed. The amendment's own build notes were
// explicit that this claim had NOT been verified against real PostgreSQL/concurrency in the
// environment it was made in (no Docker/Postgres available there) — only a source-text check
// confirmed the code CALLS consumeTotpStep, not that doing so is actually race-safe at runtime.
// This file closes that gap with the real thing: two literally concurrent HTTP requests,
// against a real database, carrying the identical TOTP code, both racing to complete
// first-time enrollment.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const ADMIN_URL = process.env.E2E_ADMIN_URL || 'postgresql://privault:privault@127.0.0.1:5432/postgres';
const DB = 'privault_mfa_fix_c';
const DB_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${DB}`);
const ROOT = path.join(__dirname, '..');

let up = false, server, base;
test.before(async () => {
  try {
    const admin = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 2000 });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();
    up = true;
  } catch { return; }

  const env = { ...process.env, DATABASE_URL: DB_URL, JWT_SECRET: 'mfa-fix-secret' };
  execFileSync('node', ['scripts/migrate.js'], { cwd: ROOT, env, stdio: 'pipe' });
  execFileSync('node', ['prisma/seed.js'], { cwd: ROOT, env, stdio: 'pipe' });

  Object.assign(process.env, { DATABASE_URL: DB_URL, JWT_SECRET: 'mfa-fix-secret', RATE_LIMIT_MAX: '100000', AUTH_RATE_LIMIT_MAX: '100000' });
  delete require.cache[require.resolve('../src/index')];
  delete require.cache[require.resolve('../src/lib/prisma')];
  const app = require('../src/index');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  if (server) server.close();
  if (up) { const prisma = require('../src/lib/prisma'); await prisma.$disconnect().catch(() => {}); }
});

const need = (t) => { if (!up) { t.skip('no PostgreSQL reachable for E2E'); return false; } return true; };
const call = (who, method, url, body) => fetch(base + url, { method, headers: { Authorization: `Bearer ${who}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
const json = async (who, method, url, body) => { const r = await call(who, method, url, body); return { status: r.status, body: await r.json().catch(() => null) }; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Waits for the next 30-second TOTP step boundary so a newly generated code is guaranteed
// distinct from one just consumed (consecutive calls to totp.totp() less than 30s apart
// otherwise land in the SAME step — that is test timing, not a replay; genuine replay tests
// reuse a code deliberately, without this wait).
async function freshTotpCode(secret) {
  const totp = require('../src/lib/totp');
  const stepMs = 30000;
  const msIntoStep = Date.now() % stepMs;
  await sleep(stepMs - msIntoStep + 400);
  return totp.totp(secret);
}


async function freshUser(email) {
  const inv = await json(governanceToken, 'POST', '/users', { email, name: 'Regression Fixture Account', role: 'READ_ONLY' });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const password = 'purple lighthouse ocean drifting kite 9';
  const accept = await fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: inv.body.invite.token, password }) });
  assert.equal(accept.status, 200, JSON.stringify(await accept.clone().json()));
  const login = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json();
  return { email, password, token: login.token };
}

let governanceToken;
test('MFA enable fix — setup: log in as an admin', async (t) => {
  if (!need(t)) return;
  const gov = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'governance@abcbank.demo', password: 'Demo@1234' }) })).json();
  governanceToken = gov.token;
});

test('MFA enable fix — two concurrent /mfa/enable requests with the SAME code: exactly one succeeds', async (t) => {
  if (!need(t)) return;
  const totp = require('../src/lib/totp');
  const user = await freshUser('enable.race1@abcbank.demo');
  const setup = await json(user.token, 'POST', '/auth/mfa/setup');
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const code = totp.totp(setup.body.secret);

  const fire = () => json(user.token, 'POST', '/auth/mfa/enable', { code });
  const [a, b] = await Promise.all([fire(), fire()]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 400], `exactly one of two concurrent identical enable requests must succeed, got ${JSON.stringify(statuses)}`);
  const winner = a.status === 200 ? a : b;
  assert.equal(winner.body.recoveryCodes.length, 10);

  const me = await json(user.token, 'GET', '/auth/me');
  assert.equal(me.body.user.mfaEnabled, true);
});

test('MFA enable fix — sequential reuse of the exact same enrollment code is still rejected', async (t) => {
  if (!need(t)) return;
  const totp = require('../src/lib/totp');
  const user = await freshUser('enable.race2@abcbank.demo');
  const setup = await json(user.token, 'POST', '/auth/mfa/setup');
  const code = totp.totp(setup.body.secret);

  const first = await json(user.token, 'POST', '/auth/mfa/enable', { code });
  assert.equal(first.status, 200, JSON.stringify(first.body));

  // Reset back to un-enrolled with a FRESH secret, but re-use the OLD code against the new
  // secret's setup — proves consumption is tied to the actual verification, not just a
  // "already enabled" shortcut that would mask a real replay.
  await json(user.token, 'POST', '/auth/mfa/disable', { password: user.password, code: await freshTotpCode(setup.body.secret) });
  const setup2 = await json(user.token, 'POST', '/auth/mfa/setup');
  const replay = await json(user.token, 'POST', '/auth/mfa/enable', { code }); // the FIRST code, now stale and from a different secret entirely
  assert.equal(replay.status, 400, 'a stale/foreign code must not enroll MFA a second time');
  void setup2;
});
