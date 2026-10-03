const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../src/lib/totp');
const { validatePassword } = require('../src/lib/password');
const tokens = require('../src/lib/tokens');
const chain = require('../src/lib/auditChain');
const { evaluateProductionGate } = require('../src/lib/productionGate');

// ---- TOTP: official RFC 6238 Appendix B test vectors (SHA-1, secret "12345678901234567890", 8 digits)
const RFC_SECRET = totp.base32Encode(Buffer.from('12345678901234567890'));
test('TOTP matches the RFC 6238 test vectors', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, expected] of vectors) assert.equal(totp.totp(RFC_SECRET, t * 1000, { digits: 8 }), expected, `T=${t}`);
});

test('TOTP: base32 round-trips; codes verify inside the window and not outside; replays are refused', () => {
  const secret = totp.generateSecret();
  assert.equal(secret.length, 32);
  assert.deepEqual(totp.base32Decode(secret), totp.base32Decode(totp.base32Encode(totp.base32Decode(secret))));
  const t0 = Date.UTC(2026, 8, 28, 10, 0, 0);
  const code = totp.totp(secret, t0);
  assert.match(code, /^\d{6}$/);
  const step = totp.verifyTotp(secret, code, { timeMs: t0 });
  assert.equal(step, totp.stepOf(t0));
  assert.notEqual(totp.verifyTotp(secret, code, { timeMs: t0 + 30_000 }), null, 'one step of clock drift is tolerated');
  assert.equal(totp.verifyTotp(secret, code, { timeMs: t0 + 5 * 30_000 }), null, 'five steps later is rejected');
  assert.equal(totp.verifyTotp(secret, code, { timeMs: t0, lastUsedStep: step }), null, 'the same code cannot be used twice');
  assert.equal(totp.verifyTotp(secret, '000000', { timeMs: t0 }), null);
  assert.equal(totp.verifyTotp(secret, 'abcdef', { timeMs: t0 }), null);
  assert.equal(totp.verifyTotp(secret, '12345', { timeMs: t0 }), null);
  assert.match(totp.otpauthUri({ secret, account: 'a@b.c', issuer: 'PRIVault' }), /^otpauth:\/\/totp\/PRIVault%3Aa%40b\.c\?secret=/);
});

// ---- passwords
test('Password policy: length and blocklist over composition rules', () => {
  assert.deepEqual(validatePassword('correct horse battery staple', { email: 'a@b.com' }), []);
  assert.ok(validatePassword('Short1!').some((p) => /at least 12/.test(p)));
  assert.ok(validatePassword('Password1234').some((p) => /too common/.test(p)));
  assert.ok(validatePassword('aaaaaaaaaaaa').some((p) => /repeat/.test(p)));
  assert.ok(validatePassword('ritika.gupta-secret-2026', { email: 'ritika.gupta@abcbank.demo' }).some((p) => /email/.test(p)));
  assert.ok(validatePassword('Kabir-loves-2026-cricket', { name: 'Kabir Singh' }).some((p) => /name/.test(p)));
  assert.ok(validatePassword('x'.repeat(200)).some((p) => /at most/.test(p)));
});

test('Tokens: opaque, unique, hash-comparable; reference numbers avoid ambiguous characters', () => {
  const a = tokens.newToken(), b = tokens.newToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  assert.ok(tokens.safeEqualHex(tokens.hashToken(a), tokens.hashToken(a)));
  assert.equal(tokens.safeEqualHex(tokens.hashToken(a), tokens.hashToken(b)), false);
  assert.match(tokens.newRecoveryCode(), /^[0-9a-f]{5}-[0-9a-f]{5}$/);
  for (let i = 0; i < 200; i++) assert.match(tokens.newReference(), /^DPR-[A-HJ-NP-Z2-9]{8}$/);
});

// ---- audit hash chain
function buildChain(n) {
  const rows = [];
  let prev = chain.GENESIS;
  for (let i = 1; i <= n; i++) {
    const r = { seq: i, prevHash: prev, tenantId: 't1', userId: 'u1', role: 'DPO', action: `ACT_${i}`, objectType: 'X', objectId: `o${i}`, previousValue: { a: i }, newValue: { b: { z: 1, y: [i, null] } }, source: 'app', reason: null, ipAddress: '10.0.0.1', timestamp: new Date(Date.UTC(2026, 8, 28, 10, 0, i)) };
    r.hash = chain.computeHash(r);
    rows.push(r); prev = r.hash;
  }
  return rows;
}
const run = (rows) => { const st = { expectedSeq: 1, prev: chain.GENESIS, checked: 0 }; for (const r of rows) { const bad = chain.checkRow(st, r); if (bad) return { ...bad, checked: st.checked }; } return { ok: true, checked: st.checked }; };

test('Audit chain: canonical hashing ignores key order and normalises dates/undefined', () => {
  assert.equal(chain.canonical({ b: 1, a: { d: 2, c: 3 } }), chain.canonical({ a: { c: 3, d: 2 }, b: 1 }));
  const base = { seq: 1, prevHash: chain.GENESIS, tenantId: 't', action: 'A', objectType: 'O', timestamp: new Date(0) };
  assert.equal(chain.computeHash({ ...base, newValue: { when: new Date(5), x: undefined } }), chain.computeHash({ ...base, newValue: { x: undefined, when: '1970-01-01T00:00:00.005Z' } }));
  assert.notEqual(chain.computeHash(base), chain.computeHash({ ...base, action: 'B' }));
});

test('Audit chain: an intact chain verifies; every kind of tampering is located', () => {
  const rows = buildChain(6);
  assert.deepEqual(run(rows), { ok: true, checked: 6 });

  const edited = structuredClone(rows); edited[2].newValue = { b: 'changed' };
  assert.equal(run(edited).brokenAtSeq, 3);
  assert.match(run(edited).reason, /modified/);

  const actor = structuredClone(rows); actor[3].role = 'READ_ONLY';
  assert.equal(run(actor).brokenAtSeq, 4, 'changing WHO did it is detected');

  const removed = rows.filter((r) => r.seq !== 3);
  assert.equal(run(removed).brokenAtSeq, 3);
  assert.match(run(removed).reason, /missing/);

  const reordered = [rows[0], rows[2], rows[1], ...rows.slice(3)];
  assert.ok(run(reordered).brokenAtSeq);

  const relinked = structuredClone(rows); relinked[4].prevHash = chain.GENESIS;
  assert.equal(run(relinked).brokenAtSeq, 5);

  // a careful forger who recomputes every later hash still cannot match an externally anchored head
  const forged = structuredClone(rows); forged[1].action = 'FORGED';
  let prev = forged[0].hash;
  for (let i = 1; i < forged.length; i++) { forged[i].prevHash = prev; forged[i].hash = chain.computeHash(forged[i]); prev = forged[i].hash; }
  assert.deepEqual(run(forged), { ok: true, checked: 6 }, 'internally consistent…');
  assert.notEqual(prev, rows[5].hash, '…but the head hash differs from the anchored one — that is why the head must be anchored externally');
});

// ---- production gate
test('Production gate: blocks the combinations the spec and DPDP forbid, warns on the rest, allows a clean system', () => {
  const clean = { personalDataCategories: [], sensitiveDataCategories: [], humanOversight: true, lastAssessmentAt: new Date() };
  assert.deepEqual(evaluateProductionGate(clean), { allowed: true, blockers: [], warnings: [] });

  const pd = { ...clean, personalDataCategories: ['Email'], retentionPeriodDays: 90 };
  assert.deepEqual(evaluateProductionGate(pd).blockers.map((b) => b.code), ['DPIA_NOT_APPROVED']);
  assert.equal(evaluateProductionGate(pd, { approvedDpia: true }).allowed, true);

  const bad = { ...pd, automatedDecisionUsage: true, humanOversight: false, processesChildrensData: true, behavioralTrackingOrAds: true, crossBorderRestrictedCountry: true };
  const codes = evaluateProductionGate(bad, { approvedDpia: true, vendor: { name: 'V', dpaSigned: false } }).blockers.map((b) => b.code).sort();
  assert.deepEqual(codes, ['CHILDREN_TRACKING', 'NO_HUMAN_OVERSIGHT', 'RESTRICTED_TRANSFER', 'VENDOR_NO_DPA']);

  const w = evaluateProductionGate({ ...clean, personalDataCategories: ['Email'], lastAssessmentAt: null }, { approvedDpia: true });
  assert.equal(w.allowed, true);
  assert.deepEqual(w.warnings.map((x) => x.code).sort(), ['NO_RETENTION_PERIOD', 'RISK_NOT_ASSESSED']);
  assert.equal(evaluateProductionGate({ ...clean, automatedDecisionUsage: true }, {}).blockers[0].code, 'DPIA_NOT_APPROVED', 'automated decisions need a DPIA even with no personal data recorded');
});
