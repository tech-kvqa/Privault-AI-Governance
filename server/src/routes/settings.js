const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

const FIELDS = {
  dpoName: true, dpoEmail: true, dpoPhone: true,
  significantDataFiduciary: true, independentAuditorName: true,
  lastComplianceAuditAt: true, nextComplianceAuditDueAt: true, dsarResponseDays: true,
};

router.get('/dpdp', requirePermission('settings:read'), async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { name: true, ...FIELDS } });
  // Section 10 obligations checklist, derived from what is actually recorded.
  const sdfChecklist = tenant.significantDataFiduciary ? [
    { item: 'Data Protection Officer appointed and contact published (Section 8(9) / 10)', done: !!(tenant.dpoName && tenant.dpoEmail) },
    { item: 'Independent data auditor appointed (Section 10)', done: !!tenant.independentAuditorName },
    { item: 'Periodic compliance audit recorded (Section 10)', done: !!tenant.lastComplianceAuditAt },
    { item: 'Periodic DPIA performed (Section 10)', done: (await prisma.dpia.count({ where: { tenantId: req.auth.tenantId, status: 'APPROVED' } })) > 0 },
  ] : [];
  res.json({ settings: tenant, sdfChecklist });
});

const updateSchema = z.object({
  dpoName: z.string().nullable().optional(),
  dpoEmail: z.string().email().nullable().optional(),
  dpoPhone: z.string().nullable().optional(),
  significantDataFiduciary: z.boolean().optional(),
  independentAuditorName: z.string().nullable().optional(),
  lastComplianceAuditAt: z.string().datetime().nullable().optional(),
  nextComplianceAuditDueAt: z.string().datetime().nullable().optional(),
  dsarResponseDays: z.number().int().min(1).max(365).optional(),
});

router.put('/dpdp', requirePermission('settings:manage'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const existing = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: FIELDS });
  const d = parsed.data;
  const updated = await prisma.tenant.update({
    where: { id: req.auth.tenantId },
    data: {
      ...d,
      lastComplianceAuditAt: d.lastComplianceAuditAt ? new Date(d.lastComplianceAuditAt) : d.lastComplianceAuditAt,
      nextComplianceAuditDueAt: d.nextComplianceAuditDueAt ? new Date(d.nextComplianceAuditDueAt) : d.nextComplianceAuditDueAt,
    },
    select: FIELDS,
  });
  await writeAudit({ req, action: 'DPDP_SETTINGS_UPDATED', objectType: 'Tenant', objectId: req.auth.tenantId, previousValue: existing, newValue: updated });
  res.json({ settings: updated });
});

module.exports = router;
