const bcrypt = require('bcryptjs');

// NIST SP 800-63B guidance: length matters more than composition rules; refuse known-bad passwords.
const MIN = 12;
const MAX = 128;
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'password12345', 'passw0rd1234',
  '123456789012', '1234567890123', 'qwertyuiop12', 'qwerty123456', 'qwertyuiopas', 'iloveyou1234', 'letmein12345',
  'welcome12345', 'welcome1234!', 'administrator', 'admin1234567', 'admin@123456', 'changeme1234', 'changeme12345',
  'abcdefghijkl', 'abc123456789', 'monkey123456', 'dragon123456', 'football1234', 'baseball1234', 'trustno1trustno1',
  'demo@1234demo', 'privault1234', 'privault12345', 'privault@123', 'india@123456', 'india123456', 'bank@1234567',
  'p@ssw0rd1234', 'p@ssword1234', 'pa$$w0rd1234', 'passwordpassword', 'passwordpassword1',
]);

/** @returns {string[]} human-readable problems; empty = acceptable */
function validatePassword(pw, { email, name } = {}) {
  const problems = [];
  const p = String(pw ?? '');
  if (p.length < MIN) problems.push(`Use at least ${MIN} characters`);
  if (p.length > MAX) problems.push(`Use at most ${MAX} characters`);
  const lower = p.toLowerCase();
  if (COMMON.has(lower)) problems.push('That password is too common');
  if (/^(.)\1+$/.test(p)) problems.push('Do not repeat a single character');
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(p) && p.length < 16) problems.push('Do not use a simple keyboard or number sequence');
  const local = email ? String(email).split('@')[0].toLowerCase() : '';
  if (local.length >= 4 && lower.includes(local)) problems.push('Do not include your email name in the password');
  const first = name ? String(name).split(/\s+/)[0].toLowerCase() : '';
  if (first.length >= 4 && lower.includes(first)) problems.push('Do not include your name in the password');
  return problems;
}

const hashPassword = (pw) => bcrypt.hash(pw, 12);
const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);
// Used to spend the same time on unknown accounts so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-just-for-timing', 12);

module.exports = { validatePassword, hashPassword, verifyPassword, DUMMY_HASH, MIN_LENGTH: MIN };
