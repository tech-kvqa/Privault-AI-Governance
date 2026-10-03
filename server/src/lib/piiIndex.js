const crypto = require('crypto');

// Privacy by design (master spec Section 39): values read from a customer's
// live database are never copied into Privault in clear. They are stored as a
// keyed HMAC-SHA256 (per-tenant key derived from PII_INDEX_KEY / JWT_SECRET),
// so "Find Me in AI" can still answer "is this identifier present?" by hashing
// the search term the same way, without Privault holding a readable copy of
// the customer's personal data.
//
// Limits worth knowing: matching is EXACT after trim + lower-casing (a phone
// number written with a +91 prefix will not match one without); and whoever
// holds the key AND a candidate identifier can test membership, so keep
// PII_INDEX_KEY secret and separate from JWT_SECRET in production.
const HASH_PREFIX = 'hmac:';

const masterKey = () => process.env.PII_INDEX_KEY || process.env.JWT_SECRET || 'dev-only-insecure-key';
const tenantKey = (tenantId) => crypto.createHmac('sha256', masterKey()).update(`pii-index:${tenantId}`).digest();
const normalize = (v) => String(v).trim().toLowerCase();

function hashValue(tenantId, value) {
  return HASH_PREFIX + crypto.createHmac('sha256', tenantKey(tenantId)).update(normalize(value)).digest('hex');
}
const isHashed = (v) => typeof v === 'string' && v.startsWith(HASH_PREFIX);

// Prisma `where` fragment matching an identifier against both clear-text
// (uploaded-file) entries and hashed (connector) entries.
function matchWhere(tenantId, identifier) {
  return { OR: [{ value: { equals: normalize(identifier) } }, { value: hashValue(tenantId, identifier) }] };
}

module.exports = { HASH_PREFIX, hashValue, isHashed, matchWhere, normalize };
