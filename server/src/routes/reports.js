const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { toCsv } = require('../lib/csv');

const router = express.Router();
router.use(requireAuth);

function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

const REPORTS = {
  // Section 41: AI Inventory Report
  'ai-inventory': async (tenantId) => {
    const rows = await prisma.aiSystem.findMany({ where: { tenantId } });
    return toCsv(rows, [
      { label: 'Name', value: 'name' }, { label: 'Status', value: 'status' },
      { label: 'Risk', value: 'riskClassification' }, { label: 'DPIA Status', value: 'dpiaStatus' },
      { label: 'Business Function', value: 'businessFunction' }, { label: 'Vendor', value: 'vendor' },
      { label: 'Automated Decisions', value: 'automatedDecisionUsage' }, { label: 'Human Oversight', value: 'humanOversight' },
      { label: 'Created', value: (r) => r.createdAt.toISOString() },
    ]);
  },
  // Section 41: AI Risk Report
  'ai-risk': async (tenantId) => {
    const rows = await prisma.aiSystem.findMany({ where: { tenantId } });
    return toCsv(rows, [
      { label: 'Name', value: 'name' }, { label: 'Risk', value: 'riskClassification' },
      { label: 'Rationale', value: 'riskRationale' }, { label: 'Last Assessed', value: (r) => r.lastAssessmentAt?.toISOString() || '' },
    ]);
  },
  // Section 41: Shadow AI Report
  'shadow-ai': async (tenantId) => {
    const rows = await prisma.shadowAiEvent.findMany({ where: { tenantId }, include: { matchedPolicy: true } });
    return toCsv(rows, [
      { label: 'Employee', value: 'employeeIdentifier' }, { label: 'Application', value: 'application' },
      { label: 'Type', value: 'eventType' }, { label: 'PII Detected', value: 'piiDetected' },
      { label: 'Categories', value: (r) => r.piiCategories.join('; ') }, { label: 'Recommended Action', value: 'recommendedAction' },
      { label: 'Matched Policy', value: (r) => r.matchedPolicy?.name || '' }, { label: 'Detected', value: (r) => r.detectedAt.toISOString() },
    ]);
  },
  // Section 41: AI DSAR Report
  dsar: async (tenantId) => {
    const rows = await prisma.dsar.findMany({ where: { tenantId }, include: { _count: { select: { actions: true } } } });
    return toCsv(rows, [
      { label: 'Data Subject', value: 'dataSubjectIdentifier' }, { label: 'Type', value: 'requestType' },
      { label: 'Status', value: 'status' }, { label: 'Actions', value: (r) => r._count.actions },
      { label: 'Submitted', value: (r) => r.submittedAt.toISOString() }, { label: 'Closed', value: (r) => r.closedAt?.toISOString() || '' },
    ]);
  },
  // Section 41: AI Incident Report
  incidents: async (tenantId) => {
    const rows = await prisma.incident.findMany({ where: { tenantId }, include: { aiSystem: true } });
    return toCsv(rows, [
      { label: 'Type', value: 'type' }, { label: 'Severity', value: 'severity' }, { label: 'Status', value: 'status' },
      { label: 'AI System', value: (r) => r.aiSystem?.name || '' }, { label: 'Description', value: 'description' },
      { label: 'Detected', value: (r) => r.detectedAt.toISOString() }, { label: 'Closed', value: (r) => r.closedAt?.toISOString() || '' },
    ]);
  },
  // DPDP s.8(6): personal data breach register (who was notified, and when)
  'dpdp-breach-register': async (tenantId) => {
    const rows = await prisma.incident.findMany({ where: { tenantId, isPersonalDataBreach: true }, include: { aiSystem: true } });
    return toCsv(rows, [
      { label: 'Detected', value: (r) => r.detectedAt.toISOString() }, { label: 'Type', value: 'type' },
      { label: 'AI System', value: (r) => r.aiSystem?.name || '' }, { label: 'Severity', value: 'severity' },
      { label: 'Status', value: 'status' }, { label: 'Affected Data Principals', value: 'affectedDataSubjectCount' },
      { label: 'Board Notified At', value: (r) => r.dpbNotifiedAt?.toISOString() || 'NOT NOTIFIED' },
      { label: 'Principals Notified At', value: (r) => r.affectedPrincipalsNotifiedAt?.toISOString() || 'NOT NOTIFIED' },
      { label: 'Description', value: 'description' },
    ]);
  },
  // Section 41: AI Audit Evidence Report
  'audit-evidence': async (tenantId) => {
    const rows = await prisma.auditLog.findMany({ where: { tenantId }, orderBy: { timestamp: 'desc' }, take: 2000, include: { user: true } });
    return toCsv(rows, [
      { label: 'Timestamp', value: (r) => r.timestamp.toISOString() }, { label: 'Action', value: 'action' },
      { label: 'Object Type', value: 'objectType' }, { label: 'Object ID', value: 'objectId' },
      { label: 'User', value: (r) => r.user?.name || 'System' }, { label: 'Role', value: 'role' }, { label: 'Source', value: 'source' },
    ]);
  },
};

router.get('/:type', requirePermission('report:read'), async (req, res) => {
  const generator = REPORTS[req.params.type];
  if (!generator) {
    return res.status(404).json({ error: `Unknown report type. Available: ${Object.keys(REPORTS).join(', ')}` });
  }
  const csv = await generator(req.auth.tenantId);
  sendCsv(res, `${req.params.type}-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

module.exports = router;
