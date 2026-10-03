const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

const schema = z.object({
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  dpaSigned: z.boolean().optional(),
  dpaSignedAt: z.string().datetime().nullable().optional(),
  securityReviewAt: z.string().datetime().nullable().optional(),
  securityReviewOutcome: z.string().nullable().optional(),
  isSubProcessor: z.boolean().optional(),
  riskTier: z.enum(['UNCLASSIFIED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  notes: z.string().nullable().optional(),
});

const toDates = (d) => ({
  ...d,
  dpaSignedAt: d.dpaSignedAt ? new Date(d.dpaSignedAt) : d.dpaSignedAt,
  securityReviewAt: d.securityReviewAt ? new Date(d.securityReviewAt) : d.securityReviewAt,
});

// A signed DPA is a recorded fact with a date, not a checkbox that can be
// ticked with no provenance.
function dpaProblem(d, existing) {
  const signed = d.dpaSigned ?? existing?.dpaSigned;
  const signedAt = d.dpaSignedAt !== undefined ? d.dpaSignedAt : existing?.dpaSignedAt;
  return signed && !signedAt ? 'Provide the date the data processing agreement was signed (dpaSignedAt)' : null;
}

router.get('/', requirePermission('vendor:read'), async (req, res) => {
  const vendors = await prisma.vendor.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { name: 'asc' },
    include: { aiSystems: { select: { id: true, name: true } } },
  });
  res.json({ vendors });
});

router.post('/', requirePermission('vendor:manage'), async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const problem = dpaProblem(parsed.data);
  if (problem) return res.status(400).json({ error: problem });

  const vendor = await prisma.vendor.create({
    data: { ...toDates(parsed.data), tenantId: req.auth.tenantId, createdById: req.auth.userId },
  });
  await writeAudit({ req, action: 'VENDOR_CREATED', objectType: 'Vendor', objectId: vendor.id, newValue: vendor });
  res.status(201).json({ vendor });
});

router.put('/:id', requirePermission('vendor:manage'), async (req, res) => {
  const parsed = schema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const existing = await prisma.vendor.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Vendor not found' });
  const problem = dpaProblem(parsed.data, existing);
  if (problem) return res.status(400).json({ error: problem });

  const vendor = await prisma.vendor.update({ where: { id: existing.id }, data: toDates(parsed.data) });
  await writeAudit({ req, action: 'VENDOR_UPDATED', objectType: 'Vendor', objectId: vendor.id, previousValue: existing, newValue: vendor });
  res.json({ vendor });
});

module.exports = router;
