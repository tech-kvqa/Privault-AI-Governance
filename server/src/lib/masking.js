// Section 39 — Privacy by Design: role-based PII visibility.
// e.g. normal user sees "ritika*****@company.com", DPO sees the full value.
const UNMASKED_ROLES = new Set(['SUPER_ADMIN', 'AI_GOVERNANCE_ADMIN', 'PRIVACY_OFFICER', 'DPO']);

const { isHashed } = require('./piiIndex');

function maskValue(value, category) {
  if (!value) return value;
  if (isHashed(value)) return 'hashed — not stored in clear';
  if (category === 'Email') {
    const [local, domain] = value.split('@');
    if (!domain) return maskGeneric(value);
    const visible = local.slice(0, Math.min(3, local.length));
    return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
  }
  return maskGeneric(value);
}

function maskGeneric(value) {
  if (value.length <= 4) return '*'.repeat(value.length);
  const visible = value.slice(0, 2);
  const tail = value.slice(-2);
  return `${visible}${'*'.repeat(Math.max(value.length - 4, 3))}${tail}`;
}

function canSeeUnmasked(role) {
  return UNMASKED_ROLES.has(role);
}

module.exports = { maskValue, canSeeUnmasked };
