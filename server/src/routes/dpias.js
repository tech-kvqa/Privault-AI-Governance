const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { buildDpiaTemplate } = require('../lib/dpiaTemplate');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('dpia:read'), async (req, res) => {
  const dpias = await prisma.dpia.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { createdAt: 'desc' },
    include: { aiSystem: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
  });
  res.json({ dpias });
});

router.get('/:id', requirePermission('dpia:read'), async (req, res) => {
  const dpia = await prisma.dpia.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { aiSystem: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
  });
  if (!dpia) return res.status(404).json({ error: 'DPIA not found' });
  res.json({ dpia });
});

router.post('/', requirePermission('dpia:create'), async (req, res) => {
  const parsed = z.object({ aiSystemId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const aiSystem = await prisma.aiSystem.findFirst({ where: { id: parsed.data.aiSystemId, tenantId: req.auth.tenantId } });
  if (!aiSystem) return res.status(404).json({ error: 'AI system not found' });

  const sections = buildDpiaTemplate(aiSystem);
  const dpia = await prisma.dpia.create({
    data: { tenantId: req.auth.tenantId, aiSystemId: aiSystem.id, sections, status: 'DRAFT', createdById: req.auth.userId },
  });

  await prisma.aiSystem.update({ where: { id: aiSystem.id }, data: { dpiaStatus: 'IN_PROGRESS' } });
  await writeAudit({ req, action: 'DPIA_CREATED', objectType: 'Dpia', objectId: dpia.id, newValue: { aiSystemId: aiSystem.id } });

  res.status(201).json({ dpia });
});

router.put('/:id', requirePermission('dpia:manage'), async (req, res) => {
  const parsed = z.object({ sections: z.record(z.any()).optional(), reviewDate: z.string().datetime().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const existing = await prisma.dpia.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'DPIA not found' });
  if (existing.status === 'APPROVED') return res.status(400).json({ error: 'Approved DPIAs are immutable — create a new one if the assessment needs to change' });

  const updated = await prisma.dpia.update({
    where: { id: existing.id },
    data: {
      sections: parsed.data.sections ? { ...existing.sections, ...parsed.data.sections } : undefined,
      reviewDate: parsed.data.reviewDate ? new Date(parsed.data.reviewDate) : undefined,
    },
  });
  await writeAudit({ req, action: 'DPIA_UPDATED', objectType: 'Dpia', objectId: updated.id });
  res.json({ dpia: updated });
});

router.post('/:id/submit', requirePermission('dpia:manage'), async (req, res) => {
  const existing = await prisma.dpia.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'DPIA not found' });

  const updated = await prisma.dpia.update({ where: { id: existing.id }, data: { status: 'IN_REVIEW' } });
  await writeAudit({ req, action: 'DPIA_SUBMITTED', objectType: 'Dpia', objectId: updated.id });
  res.json({ dpia: updated });
});

router.post('/:id/decide', requirePermission('dpia:approve'), async (req, res) => {
  const parsed = z.object({ approve: z.boolean(), reviewDate: z.string().datetime().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const existing = await prisma.dpia.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'DPIA not found' });

  const updated = await prisma.dpia.update({
    where: { id: existing.id },
    data: {
      status: parsed.data.approve ? 'APPROVED' : 'REJECTED',
      approvedById: parsed.data.approve ? req.auth.userId : null,
      approvedAt: parsed.data.approve ? new Date() : null,
      reviewDate: parsed.data.reviewDate ? new Date(parsed.data.reviewDate) : undefined,
    },
  });

  await prisma.aiSystem.update({
    where: { id: existing.aiSystemId },
    data: { dpiaStatus: parsed.data.approve ? 'COMPLETED' : 'REQUIRED_NOT_STARTED' },
  });

  await writeAudit({
    req, action: parsed.data.approve ? 'DPIA_APPROVED' : 'DPIA_REJECTED', objectType: 'Dpia', objectId: updated.id,
  });
  res.json({ dpia: updated });
});

module.exports = router;
