const crypto = require('crypto');

// Opaque one-time tokens (invites, password resets, request-status tokens). Only the SHA-256 is stored.
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const safeEqualHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Human-friendly recovery codes: 10 hex chars as xxxxx-xxxxx
const newRecoveryCode = () => { const h = crypto.randomBytes(5).toString('hex'); return `${h.slice(0, 5)}-${h.slice(5)}`; };
const normalizeRecovery = (c) => String(c || '').trim().toLowerCase();

// Rights-request reference numbers: unambiguous alphabet, no 0/O/1/I.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newReference() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += REF_ALPHABET[b % REF_ALPHABET.length];
  return `DPR-${s}`;
}

module.exports = { newToken, hashToken, safeEqualHex, newRecoveryCode, normalizeRecovery, newReference };
