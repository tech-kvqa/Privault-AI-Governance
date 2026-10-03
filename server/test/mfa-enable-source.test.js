const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('MFA enable uses atomic TOTP consumption', () => {
  const p = path.join(__dirname, '..', 'src', 'routes', 'auth.js');
  const s = fs.readFileSync(p, 'utf8');
  const start = s.indexOf("router.post('/mfa/enable'");
  const end = s.indexOf('// Reauthentication for sensitive MFA operations', start);
  assert.ok(start >= 0 && end > start, 'MFA enable route must exist');
  const block = s.slice(start, end);
  assert.match(block, /await consumeTotpStep\(/, 'MFA enable must use atomic TOTP consumption');
  assert.doesNotMatch(block, /const step = verifyTotp\(/, 'MFA enable must not use non-consuming direct TOTP verification');
});
