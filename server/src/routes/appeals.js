const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('appeal:read'), async (req, res) => {
  const appeals = await prisma.appeal.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      decision: { select: { id: true, decision: true, aiSystem: { select: { id: true, name: true } } } },
      reviewer: { select: { id: true, name: true } },
    },
  });
  res.json({ appeals });
});

const createSchema = z.object({
  decisionId: z.string().uuid(),
  dataSubjectIdentifier: z.string().min(1),
  reason: z.string().min(1),
  evidence: z.string().optional(),
});

router.post('/', requirePermission('appeal:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const decision = await prisma.automatedDecision.findFirst({ where: { id: parsed.data.decisionId, tenantId: req.auth.tenantId } });
  if (!decision) return res.status(404).json({ error: 'Decision not found' });

  const appeal = await prisma.appeal.create({
    data: { ...parsed.data, tenantId: req.auth.tenantId, createdById: req.auth.userId },
  });
  await writeAudit({ req, action: 'APPEAL_CREATED', objectType: 'Appeal', objectId: appeal.id, newValue: appeal });
  res.status(201).json({ appeal });
});

router.post('/:id/investigate', requirePermission('appeal:manage'), async (req, res) => {
  const existing = await prisma.appeal.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Appeal not found' });

  const updated = await prisma.appeal.update({
    where: { id: existing.id },
    data: { status: 'UNDER_INVESTIGATION', reviewerId: req.auth.userId },
  });
  await writeAudit({ req, action: 'APPEAL_UNDER_INVESTIGATION', objectType: 'Appeal', objectId: updated.id });
  res.json({ appeal: updated });
});

const decideSchema = z.object({ outcome: z.string().min(1) });
router.post('/:id/decide', requirePermission('appeal:manage'), async (req, res) => {
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provide an outcome describing the decision' });

  const existing = await prisma.appeal.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Appeal not found' });

  const updated = await prisma.appeal.update({
    where: { id: existing.id },
    data: { status: 'DECIDED', outcome: parsed.data.outcome, decidedAt: new Date(), reviewerId: req.auth.userId },
  });
  await writeAudit({ req, action: 'APPEAL_DECIDED', objectType: 'Appeal', objectId: updated.id, newValue: { outcome: parsed.data.outcome } });
  res.json({ appeal: updated });
});

module.exports = router;
