const { appendAudit } = require('../lib/auditChain');

// Writes a tamper-evident audit event (hash-chained; see lib/auditChain.js). Called after a successful write —
// never before, so a failed write never leaves a false audit trail entry.
async function writeAudit({ req, action, objectType, objectId, previousValue, newValue, reason }) {
  return appendAudit({
    tenantId: req.auth.tenantId, userId: req.auth.userId, role: req.auth.role,
    action, objectType, objectId, previousValue, newValue, source: 'app', reason, ipAddress: req.ip,
  });
}

module.exports = { writeAudit };
