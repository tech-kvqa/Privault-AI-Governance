const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

const createSchema = z.object({
  aiSystemId: z.string().uuid(),
  dataSubjectIdentifier: z.string().min(1),
  inputSummary: z.string().optional(),
  decision: z.string().min(1),
  modelVersion: z.string().optional(),
  riskLevel: z.enum(['UNCLASSIFIED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});

router.get('/', requirePermission('decision:read'), async (req, res) => {
  const { reviewStatus } = req.query;
  const decisions = await prisma.automatedDecision.findMany({
    where: { tenantId: req.auth.tenantId, ...(reviewStatus ? { reviewStatus: String(reviewStatus) } : {}) },
    orderBy: { decidedAt: 'desc' },
    include: {
      aiSystem: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
      _count: { select: { appeals: true } },
    },
  });
  res.json({ decisions });
});

router.get('/:id', requirePermission('decision:read'), async (req, res) => {
  const decision = await prisma.automatedDecision.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: {
      aiSystem: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
      appeals: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!decision) return res.status(404).json({ error: 'Decision not found' });
  res.json({ decision });
});

// Section 21 — logs an AI system's decision. In production this would be
// called by the AI system itself (an API integration); here it's a manual
// entry point matching this phase's Mode C pattern.
router.post('/', requirePermission('decision:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const system = await prisma.aiSystem.findFirst({ where: { id: parsed.data.aiSystemId, tenantId: req.auth.tenantId } });
  if (!system) return res.status(404).json({ error: 'AI system not found' });

  const decision = await prisma.automatedDecision.create({
    data: { ...parsed.data, tenantId: req.auth.tenantId, createdById: req.auth.userId },
  });
  await writeAudit({ req, action: 'AUTOMATED_DECISION_LOGGED', objectType: 'AutomatedDecision', objectId: decision.id, newValue: decision });
  res.status(201).json({ decision });
});

// Section 22 — Human Review Queue actions: Approve / Reject / Override / Escalate.
const reviewSchema = z.object({ overrideReason: z.string().optional(), finalOutcome: z.string().optional() });

function reviewHandler(newStatus, requireReason) {
  return async (req, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    if (requireReason && !parsed.data.overrideReason) {
      return res.status(400).json({ error: 'overrideReason is required for this action' });
    }

    const existing = await prisma.automatedDecision.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
    if (!existing) return res.status(404).json({ error: 'Decision not found' });
    if (existing.reviewStatus !== 'PENDING' && existing.reviewStatus !== 'ESCALATED') {
      return res.status(400).json({ error: `Decision already reviewed (status: ${existing.reviewStatus})` });
    }

    const updated = await prisma.automatedDecision.update({
      where: { id: existing.id },
      data: {
        reviewStatus: newStatus,
        reviewerId: req.auth.userId,
        reviewedAt: new Date(),
        overrideReason: parsed.data.overrideReason || null,
        finalOutcome: parsed.data.finalOutcome || (newStatus === 'OVERRIDDEN' ? parsed.data.overrideReason : existing.decision),
      },
    });

    await writeAudit({
      req, action: `AUTOMATED_DECISION_${newStatus}`, objectType: 'AutomatedDecision', objectId: updated.id,
      previousValue: { reviewStatus: existing.reviewStatus }, newValue: { reviewStatus: newStatus },
    });
    res.json({ decision: updated });
  };
}

router.post('/:id/approve', requirePermission('review:manage'), reviewHandler('APPROVED', false));
router.post('/:id/reject', requirePermission('review:manage'), reviewHandler('REJECTED', true));
router.post('/:id/override', requirePermission('review:manage'), reviewHandler('OVERRIDDEN', true));
router.post('/:id/escalate', requirePermission('review:manage'), reviewHandler('ESCALATED', false));

module.exports = router;
