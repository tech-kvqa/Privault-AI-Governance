const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

// Section 26 — the only action Privault can execute directly is its own
// AiSystem.status field. Everything else needs a live integration into the
// customer's infrastructure that this deployment doesn't have.
const REAL_ACTIONS = new Set(['STOP_AI_SYSTEM']);

const INCLUDE = {
  aiSystem: { select: { id: true, name: true, status: true } },
  executedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
};

router.get('/actions', requirePermission('emergency:read'), async (req, res) => {
  const actions = await prisma.emergencyAction.findMany({ where: { tenantId: req.auth.tenantId }, orderBy: { executedAt: 'desc' }, include: INCLUDE });
  res.json({ actions });
});

const actionSchema = z.object({
  actionType: z.enum(['STOP_AI_SYSTEM', 'DISABLE_API', 'REVOKE_CREDENTIAL', 'STOP_DATA_FEED', 'DISABLE_AGENT', 'DISABLE_RAG', 'ROLLBACK_MODEL', 'ISOLATE_SERVICE']),
  reason: z.string().min(10),
  ticketRef: z.string().optional(),
});

router.post('/ai-systems/:id/actions', requirePermission('emergency:execute'), async (req, res) => {
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request — reason must be at least 10 characters (Section 26 requires a documented reason)', details: parsed.error.flatten() });
  }
  const system = await prisma.aiSystem.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!system) return res.status(404).json({ error: 'AI system not found' });

  const isReal = REAL_ACTIONS.has(parsed.data.actionType);
  // Section 26 dual control: suspending a system that is live in Production is
  // high-impact, so it is only REQUESTED here and runs when a second, different
  // authorized person approves it.
  const needsApproval = isReal && system.status === 'PRODUCTION';
  let status;
  if (needsApproval) status = 'PENDING_APPROVAL';
  else status = isReal ? 'EXECUTED' : 'REQUIRES_INTEGRATION';

  if (isReal && !needsApproval) {
    await prisma.aiSystem.update({ where: { id: system.id }, data: { status: 'SUSPENDED' } });
  }

  const action = await prisma.emergencyAction.create({
    data: {
      tenantId: req.auth.tenantId, aiSystemId: system.id, actionType: parsed.data.actionType, status,
      reason: parsed.data.reason, ticketRef: parsed.data.ticketRef || null, executedById: req.auth.userId,
    },
    include: INCLUDE,
  });

  await writeAudit({
    req, action: needsApproval ? 'EMERGENCY_ACTION_REQUESTED' : 'EMERGENCY_ACTION_TRIGGERED', objectType: 'EmergencyAction', objectId: action.id,
    newValue: { actionType: action.actionType, status: action.status }, reason: parsed.data.reason,
  });

  let note;
  if (needsApproval) note = 'Dual approval required: this system is in Production, so a second authorized person must approve before it is suspended. Nothing has been changed yet.';
  else if (isReal) note = 'AI system status set to SUSPENDED.';
  else note = `CONTROL AVAILABLE — INTEGRATION REQUIRED. ${parsed.data.actionType} needs a live integration into the customer's infrastructure that this deployment doesn't have. Logged as requested but not executed.`;
  res.status(201).json({ action, note });
});

async function loadPending(req, res) {
  const action = await prisma.emergencyAction.findFirst({ where: { id: req.params.actionId, tenantId: req.auth.tenantId } });
  if (!action) { res.status(404).json({ error: 'Emergency action not found' }); return null; }
  if (action.status !== 'PENDING_APPROVAL') { res.status(400).json({ error: `Action is not awaiting approval (status: ${action.status})` }); return null; }
  return action;
}

router.post('/actions/:actionId/approve', requirePermission('emergency:approve'), async (req, res) => {
  const action = await loadPending(req, res);
  if (!action) return;
  if (action.executedById === req.auth.userId) {
    return res.status(403).json({ error: 'Dual control: the person who requested this action cannot also approve it' });
  }
  await prisma.aiSystem.update({ where: { id: action.aiSystemId }, data: { status: 'SUSPENDED' } });
  const updated = await prisma.emergencyAction.update({
    where: { id: action.id },
    data: { status: 'EXECUTED', approvedById: req.auth.userId, approvedAt: new Date(), decisionNote: req.body?.note || null },
    include: INCLUDE,
  });
  await writeAudit({ req, action: 'EMERGENCY_ACTION_APPROVED', objectType: 'EmergencyAction', objectId: action.id, previousValue: { status: 'PENDING_APPROVAL' }, newValue: { status: 'EXECUTED' } });
  res.json({ action: updated, note: 'Approved. AI system status set to SUSPENDED.' });
});

router.post('/actions/:actionId/reject', requirePermission('emergency:approve'), async (req, res) => {
  const action = await loadPending(req, res);
  if (!action) return;
  const updated = await prisma.emergencyAction.update({
    where: { id: action.id },
    data: { status: 'REJECTED', approvedById: req.auth.userId, approvedAt: new Date(), decisionNote: req.body?.note || null },
    include: INCLUDE,
  });
  await writeAudit({ req, action: 'EMERGENCY_ACTION_REJECTED', objectType: 'EmergencyAction', objectId: action.id, previousValue: { status: 'PENDING_APPROVAL' }, newValue: { status: 'REJECTED' }, reason: req.body?.note });
  res.json({ action: updated });
});

module.exports = router;
