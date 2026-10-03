// FIX REGRESSION SUITE — MFA one-time TOTP/recovery-code consumption
// (PRIVault_AI_Governance_Claude_Fix_Instructions.docx, Section 4)
//
// Split into its own file (own scratch database, own app instance) because it deliberately
// waits for real 30-second TOTP step boundaries — several minutes of genuine wall-clock time
// that would otherwise dominate the shared end-to-end suite's run budget. Real PostgreSQL,
// real Prisma client, real TOTP arithmetic throughout; skips itself if no Postgres is reachable.
//
// Root cause that was found and fixed: `reauthenticate()` (used by /auth/mfa/disable and
// /auth/mfa/recovery-codes) validated a submitted TOTP code but never recorded it as consumed,
// so the same 30-second code could be replayed against those endpoints — and because
// consumption state lives on the user row, a code used there could also still be used to sign
// in. Separately, the login path's own consumption was a non-atomic read-then-write, so two
// concurrent requests carrying the same code could both read the old "last used" value before
// either wrote the new one, and both would succeed.
//
// Fix: server/src/lib/mfaConsume.js — a single conditional UPDATE (`... WHERE mfaLastStep IS
// NULL OR mfaLastStep < $step`) used by every endpoint that accepts a code, so validation and
// consumption happen as one atomic database operation. Same pattern for recovery codes via
// `array_remove(...) WHERE code = ANY(...)`.
//
// Each numbered scenario below is one of the 7 the fix instructions require.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

const ADMIN_URL = process.env.E2E_ADMIN_URL || 'postgresql://privault:privault@127.0.0.1:5432/postgres';
const DB = 'privault_mfa_fix_a';
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

let mfaRegress; // { email, password, token, secret, recoveryCodes }
let governanceToken;

test('MFA fix — setup: log in as an admin and enrol a dedicated user in real TOTP', async (t) => {
  if (!need(t)) return;
  const gov = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'governance@abcbank.demo', password: 'Demo@1234' }) })).json();
  governanceToken = gov.token;

  const inv = await json(governanceToken, 'POST', '/users', { email: 'mfa.regress@abcbank.demo', name: 'MFA Regress', role: 'READ_ONLY' });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const accept = await fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: inv.body.invite.token, password: 'mfa regression suite passphrase 7' }) });
  assert.equal(accept.status, 200);
  const login1 = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'mfa.regress@abcbank.demo', password: 'mfa regression suite passphrase 7' }) })).json();
  mfaRegress = { email: 'mfa.regress@abcbank.demo', password: 'mfa regression suite passphrase 7', token: login1.token };

  const setup = await json(mfaRegress.token, 'POST', '/auth/mfa/setup');
  const totp = require('../src/lib/totp');
  const en = await json(mfaRegress.token, 'POST', '/auth/mfa/enable', { code: totp.totp(setup.body.secret) });
  assert.equal(en.status, 200, JSON.stringify(en.body));
  mfaRegress.secret = setup.body.secret;
  mfaRegress.recoveryCodes = en.body.recoveryCodes;
});

test('MFA fix — scenario 1: a valid TOTP code cannot be used twice for sign-in', async (t) => {
  if (!need(t)) return;
  const code = await freshTotpCode(mfaRegress.secret); // distinct from the step /mfa/enable just consumed
  const step1 = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mfaRegress.email, password: mfaRegress.password }) })).json();
  const first = await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: step1.mfaToken, code }) });
  assert.equal(first.status, 200, 'first use of a fresh code succeeds');
  mfaRegress.token = (await first.json()).token;

  const step2 = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mfaRegress.email, password: mfaRegress.password }) })).json();
  const replay = await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: step2.mfaToken, code }) });
  assert.equal(replay.status, 401, 'the exact same code, presented again against a fresh login step, is rejected');
});

test('MFA fix — scenario 2: a code used for reauthentication cannot be replayed against reauthentication or login', async (t) => {
  if (!need(t)) return;
  const code = await freshTotpCode(mfaRegress.secret); // distinct from scenario 1's code

  const regen1 = await json(mfaRegress.token, 'POST', '/auth/mfa/recovery-codes', { password: mfaRegress.password, code });
  assert.equal(regen1.status, 200, JSON.stringify(regen1.body));
  mfaRegress.recoveryCodes = regen1.body.recoveryCodes;

  const regen2 = await json(mfaRegress.token, 'POST', '/auth/mfa/recovery-codes', { password: mfaRegress.password, code });
  assert.equal(regen2.status, 400, 'the SAME code cannot be used again for a second reauthentication (this was the reported bug)');

  const step = await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mfaRegress.email, password: mfaRegress.password }) })).json();
  const crossUse = await fetch(`${base}/auth/mfa/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mfaToken: step.mfaToken, code }) });
  assert.equal(crossUse.status, 401, 'a code already consumed by reauthentication cannot then be used to sign in — one consumption record, shared everywhere');
});

test('MFA fix — scenario 3: two concurrent requests with the same code — exactly one succeeds', async (t) => {
  if (!need(t)) return;
  const code = await freshTotpCode(mfaRegress.secret); // distinct from scenario 2's code
  const fire = () => json(mfaRegress.token, 'POST', '/auth/mfa/recovery-codes', { password: mfaRegress.password, code });
  const [a, b] = await Promise.all([fire(), fire()]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 400], `exactly one of two concurrent identical requests must succeed, got ${JSON.stringify(statuses)}`);
  mfaRegress.recoveryCodes = (a.status === 200 ? a : b).body.recoveryCodes;
});

test('MFA fix — scenario 4: a wrong password does not consume a valid, unused TOTP code', async (t) => {
  if (!need(t)) return;
  const code = await freshTotpCode(mfaRegress.secret); // distinct from scenario 3's code
  const wrongPw = await json(mfaRegress.token, 'POST', '/auth/mfa/recovery-codes', { password: 'definitely-the-wrong-password', code });
  assert.equal(wrongPw.status, 400, 'wrong password is rejected');

  // The SAME code, now with the CORRECT password, must still work — proving the failed
  // attempt above did not burn it.
  const rightPw = await json(mfaRegress.token, 'POST', '/auth/mfa/recovery-codes', { password: mfaRegress.password, code });
  assert.equal(rightPw.status, 200, 'the same code still works once the password is correct — a wrong password never consumed it');
  mfaRegress.recoveryCodes = rightPw.body.recoveryCodes;
});

