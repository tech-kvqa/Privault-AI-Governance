const crypto = require('crypto');

// TOTP (RFC 6238) over HOTP (RFC 4226), SHA-1, 30-second steps — what Google Authenticator, Microsoft
// Authenticator, Authy, 1Password etc. implement. No third-party code: ~60 lines, tested against the
// RFC's own test vectors.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secretBuf, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const stepOf = (timeMs, step = 30) => Math.floor(timeMs / 1000 / step);
const totp = (secretB32, timeMs = Date.now(), { step = 30, digits = 6 } = {}) => hotp(base32Decode(secretB32), stepOf(timeMs, step), digits);

const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * @returns {number|null} the 30-second step that matched, or null. A step <= lastUsedStep is refused so a
 * code that has already been used (or an older one) can never be replayed.
 */
function verifyTotp(secretB32, code, { timeMs = Date.now(), window = 1, lastUsedStep = null, digits = 6 } = {}) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d+$/.test(c) || c.length !== digits) return null;
  const secret = base32Decode(secretB32);
  const now = stepOf(timeMs);
  let matched = null;
  for (let s = now - window; s <= now + window; s++) {
    if (safeEqual(hotp(secret, s, digits), c) && matched === null) matched = s; // no early exit: constant work
  }
  if (matched === null) return null;
  if (lastUsedStep !== null && lastUsedStep !== undefined && matched <= lastUsedStep) return null;
  return matched;
}

function otpauthUri({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { base32Encode, base32Decode, generateSecret, hotp, totp, verifyTotp, stepOf, otpauthUri };
