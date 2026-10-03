// Run with: npm test   (node's built-in test runner — no extra dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');

const { luhnValid, verhoeffValid } = require('../src/lib/checksums');
const { detectPii } = require('../src/lib/piiDetect');
const { assessRisk } = require('../src/lib/riskEngine');
const { evaluatePolicies } = require('../src/lib/policyEngine');
const { chunkText } = require('../src/lib/chunkText');
const { toCsv } = require('../src/lib/csv');
const { maskValue } = require('../src/lib/masking');
const wh = require('../src/lib/webhooks');
const { can, ROLE_PERMISSIONS } = require('../src/middleware/rbac');

test('Luhn / Verhoeff discriminate valid from invalid', () => {
  assert.equal(luhnValid('4111111111111111'), true);
  assert.equal(luhnValid('4111111111111112'), false);
  assert.equal(verhoeffValid('234123412346'), true);
  assert.equal(verhoeffValid('234123412347'), false);
  assert.equal(verhoeffValid('12345'), false);
});

test('PII engine: checksum-verified vs dictionary methods, and no false positives on plain text', () => {
  const rows = [
    { email: 'a@x.com', aadhaar: '234123412346', card: '4111111111111111', notes: 'hello' },
    { email: 'b@x.com', aadhaar: '234123412346', card: '4111111111111111', notes: 'world' },
  ];
  const { findings } = detectPii(['email', 'aadhaar', 'card', 'notes'], rows);
  const by = Object.fromEntries(findings.map((f) => [f.column, f]));
  assert.equal(by.email.category, 'Email');
  assert.equal(by.aadhaar.detectionMethod, 'CHECKSUM');
  assert.equal(by.card.category, 'Credit/Debit Card');
  assert.equal(by.notes, undefined);
});

test('PII engine rejects a 12-digit number that fails the Verhoeff checksum', () => {
  const { findings } = detectPii(['ref'], [{ ref: '123456789012' }, { ref: '123456789013' }]);
  assert.equal(findings.find((f) => f.category === 'Aadhaar'), undefined);
});

test('Risk engine: explains itself, and children + tracking outranks children alone', () => {
  const base = { personalDataCategories: [], sensitiveDataCategories: [], humanOversight: true, dpiaStatus: 'NOT_REQUIRED', vendor: 'In-house' };
  assert.equal(assessRisk(base).classification, 'UNCLASSIFIED');
  const kids = assessRisk({ ...base, processesChildrensData: true });
  const kidsTracked = assessRisk({ ...base, processesChildrensData: true, behavioralTrackingOrAds: true });
  assert.ok(kidsTracked.score > kids.score);
  assert.equal(kidsTracked.firedFactors.filter((f) => f.key.startsWith('children')).length, 1, 'children factors are mutually exclusive');
  assert.match(kidsTracked.rationale, /Section 9/);
});

test('Risk engine: vendor without a DPA fires; vendor with a DPA does not', () => {
  const base = { personalDataCategories: [], sensitiveDataCategories: [], humanOversight: true, dpiaStatus: 'NOT_REQUIRED' };
  assert.ok(assessRisk({ ...base, vendorRecord: { dpaSigned: false } }).firedFactors.some((f) => f.key === 'vendorNoDpa'));
  assert.ok(!assessRisk({ ...base, vendorRecord: { dpaSigned: true } }).firedFactors.some((f) => f.key === 'vendorNoDpa'));
});

test('Policy engine: priority order, first match wins, disabled policies ignored', () => {
  const policies = [
    { id: 'warn', requireExternalAi: true, requirePersonalData: false, categories: [], action: 'WARN', enabled: true, priority: 1 },
    { id: 'block', requireExternalAi: true, requirePersonalData: true, categories: [], action: 'BLOCK', enabled: true, priority: 0 },
    { id: 'off', requireExternalAi: false, requirePersonalData: false, categories: [], action: 'BLOCK', enabled: false, priority: -1 },
  ];
  assert.equal(evaluatePolicies({ isExternalAi: true, personalDataDetected: true, categories: ['Email'] }, policies).action, 'BLOCK');
  assert.equal(evaluatePolicies({ isExternalAi: true, personalDataDetected: false, categories: [] }, policies).action, 'WARN');
  assert.equal(evaluatePolicies({ isExternalAi: false, personalDataDetected: true, categories: [] }, policies).action, 'ALLOW');
});

test('Chunker: bounded chunks, no content lost', () => {
  const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ` + 'word '.repeat(60)).join('\n\n');
  const chunks = chunkText(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 900));
  for (let i = 0; i < 12; i++) assert.ok(chunks.join(' ').includes(`Paragraph ${i}.`));
});

test('CSV writer escapes commas, quotes and newlines', () => {
  const out = toCsv([{ a: 'x,y', b: 'say "hi"', c: 'l1\nl2' }], [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }, { label: 'C', value: 'c' }]);
  assert.equal(out, 'A,B,C\n"x,y","say ""hi""","l1\nl2"');
});

test('Masking hides most of an email local part', () => {
  const m = maskValue('ritika.gupta@abcbank.demo', 'Email');
  assert.ok(m.endsWith('@abcbank.demo') && m.startsWith('rit') && m.includes('*') && !m.includes('gupta'));
});

test('Webhook secrets: AES-GCM round-trips and detects tampering', () => {
  const secret = wh.generateSecret();
  const blob = wh.encryptSecret(secret);
  assert.notEqual(blob, secret);
  assert.equal(wh.decryptSecret(blob), secret);
  const parts = blob.split('.');
  parts[2] = Buffer.from('tampered').toString('base64');
  assert.throws(() => wh.decryptSecret(parts.join('.')));
});

test('Webhook signature is deterministic and depends on secret, timestamp and body', () => {
  const a = wh.signPayload('s', '100', '{"x":1}');
  assert.equal(a, wh.signPayload('s', '100', '{"x":1}'));
  assert.notEqual(a, wh.signPayload('s2', '100', '{"x":1}'));
  assert.notEqual(a, wh.signPayload('s', '101', '{"x":1}'));
  assert.notEqual(a, wh.signPayload('s', '100', '{"x":2}'));
  assert.match(a, /^sha256=[0-9a-f]{64}$/);
});

test('SSRF guard: private, loopback, link-local and metadata addresses are refused', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.16.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(wh.isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(wh.isPrivateAddress(ip), false, ip);
  await assert.rejects(wh.assertSafeUrl('https://127.0.0.1/hook'), /private/);
  await assert.rejects(wh.assertSafeUrl('https://169.254.169.254/latest/meta-data'), /private/);
  await assert.rejects(wh.assertSafeUrl('http://8.8.8.8/hook'), /https/);
  await assert.rejects(wh.assertSafeUrl('https://user:pw@8.8.8.8/hook'), /Credentials/);
  await assert.rejects(wh.assertSafeUrl('not a url'), /Invalid/);
  await assert.doesNotReject(wh.assertSafeUrl('https://8.8.8.8/hook'));
});

test('RBAC: separation of duties is reflected in the permission map', () => {
  assert.equal(can('AUDITOR', 'evidence:read'), true);
  assert.equal(can('AUDITOR', 'evidence:create'), false);
  assert.equal(can('AUDITOR', 'evidence:review'), false);
  assert.equal(can('HUMAN_REVIEWER', 'ai_system:update'), false);
  assert.equal(can('CUSTOMER_APPEAL_USER', 'ai_system:read'), false);
  assert.equal(can('SUPER_ADMIN', 'anything:at-all'), true);
  assert.equal(can('INCIDENT_MANAGER', 'emergency:execute'), true);
  assert.equal(can('INCIDENT_MANAGER', 'emergency:approve'), false, 'requesters and approvers are different roles by default');
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    assert.equal(new Set(perms).size, perms.length, `duplicate permission in ${role}`);
  }
});

test('Production config guard refuses placeholder or missing secrets, and accepts strong distinct ones', () => {
  const { assertProductionConfig } = require('../src/lib/config');
  const good = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://x', JWT_SECRET: 'a'.repeat(40), WEBHOOK_ENC_KEY: 'b'.repeat(40), PII_INDEX_KEY: 'c'.repeat(40) };
  assert.doesNotThrow(() => assertProductionConfig(good));
  assert.doesNotThrow(() => assertProductionConfig({ NODE_ENV: 'development' }), 'dev is not policed');
  assert.throws(() => assertProductionConfig({ ...good, JWT_SECRET: 'change-this-to-a-long-random-string' }), /JWT_SECRET/);
  assert.throws(() => assertProductionConfig({ ...good, WEBHOOK_ENC_KEY: undefined }), /WEBHOOK_ENC_KEY/);
  assert.throws(() => assertProductionConfig({ ...good, PII_INDEX_KEY: 'short' }), /PII_INDEX_KEY/);
  assert.throws(() => assertProductionConfig({ ...good, PII_INDEX_KEY: good.JWT_SECRET }), /different from JWT_SECRET/);
  assert.throws(() => assertProductionConfig({ ...good, DATABASE_URL: '' }), /DATABASE_URL/);
});
