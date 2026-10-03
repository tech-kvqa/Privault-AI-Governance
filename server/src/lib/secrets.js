const crypto = require('crypto');

// AES-256-GCM encryption for secrets at rest (webhook signing secrets,
// connector database passwords). Key = SHA-256 of WEBHOOK_ENC_KEY, falling
// back to JWT_SECRET. Set a dedicated value in production; rotating it
// requires re-encrypting stored secrets (not automated).
function encKey() {
  const raw = process.env.WEBHOOK_ENC_KEY || process.env.JWT_SECRET || 'dev-only-insecure-key';
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decryptSecret(blob) {
  const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
