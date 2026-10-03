const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

// Section 52 — the schema keeps controlType (legal requirement / org policy
// / framework control / recommended practice) as a required, distinct
// field: the spec is explicit these must never be conflated, so there's no
// default that silently picks one.
const controlSchema = z.object({
  aiSystemId: z.string().uuid().nullish(),
  framework: z.enum(['DPDP', 'GDPR', 'ISO_27701', 'ISO_27001', 'ISO_42001', 'NIST_AI_RMF', 'ORG_POLICY']),
  requirement: z.string().min(1),
  control: z.string().min(1),
  controlType: z.enum(['LEGAL_REQUIREMENT', 'ORG_POLICY', 'FRAMEWORK_CONTROL', 'RECOMMENDED_PRACTICE']),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED', 'NOT_APPLICABLE']).optional(),
  evidenceNote: z.string().optional(),
  ownerId: z.string().uuid().nullish(),
  reviewDate: z.string().datetime().nullish(),
});

router.get('/', requirePermission('compliance:read'), async (req, res) => {
  const { framework, aiSystemId } = req.query;
  const controls = await prisma.complianceControl.findMany({
    where: {
      tenantId: req.auth.tenantId,
      ...(framework ? { framework: String(framework) } : {}),
      ...(aiSystemId ? { aiSystemId: String(aiSystemId) } : {}),
    },
    orderBy: { createdAt: 'desc' },
    include: { aiSystem: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } },
  });
  res.json({ controls });
});

router.post('/', requirePermission('compliance:manage'), async (req, res) => {
  const parsed = controlSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const control = await prisma.complianceControl.create({
    data: { ...parsed.data, tenantId: req.auth.tenantId, createdById: req.auth.userId },
  });
  await writeAudit({ req, action: 'COMPLIANCE_CONTROL_CREATED', objectType: 'ComplianceControl', objectId: control.id, newValue: control });
  res.status(201).json({ control });
});

router.put('/:id', requirePermission('compliance:manage'), async (req, res) => {
  const parsed = controlSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const existing = await prisma.complianceControl.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Control not found' });

  const updated = await prisma.complianceControl.update({ where: { id: existing.id }, data: parsed.data });
  await writeAudit({ req, action: 'COMPLIANCE_CONTROL_UPDATED', objectType: 'ComplianceControl', objectId: updated.id, previousValue: existing, newValue: updated });
  res.json({ control: updated });
});

module.exports = router;
