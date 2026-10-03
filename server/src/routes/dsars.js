const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { analyzeImpact, generateRemediationActions, defaultDueDate } = require('../lib/dsarEngine');
const { matchWhere } = require('../lib/piiIndex');

const router = express.Router();
router.use(requireAuth);

const createSchema = z.object({
  dataSubjectIdentifier: z.string().min(1),
  requestType: z.enum([
    'ACCESS', 'CORRECTION', 'DELETION', 'RESTRICTION', 'OBJECTION',
    'CONSENT_WITHDRAWAL', 'AI_PROCESSING_INQUIRY', 'AUTOMATED_DECISION_CHALLENGE',
  ]),
  dueDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  actingNomineeId: z.string().uuid().optional(),
});

router.get('/', requirePermission('dsar:read'), async (req, res) => {
  const dsars = await prisma.dsar.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { submittedAt: 'desc' },
    include: {
      assignedTo: { select: { id: true, name: true } },
      actingNominee: { select: { id: true, nomineeName: true } },
      _count: { select: { impactRecords: true, actions: true } },
    },
  });
  res.json({ dsars });
});

router.get('/:id', requirePermission('dsar:read'), async (req, res) => {
  const dsar = await prisma.dsar.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: {
      assignedTo: { select: { id: true, name: true } },
      impactRecords: {
        include: { dataAsset: { select: { id: true, name: true } }, aiSystem: { select: { id: true, name: true } } },
      },
      actions: {
        include: {
          dataAsset: { select: { id: true, name: true } },
          aiSystem: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true } },
          reviewer: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!dsar) return res.status(404).json({ error: 'DSAR not found' });
  res.json({ dsar });
});

router.post('/', requirePermission('dsar:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  if (parsed.data.actingNomineeId) {
    const nominee = await prisma.nominee.findFirst({ where: { id: parsed.data.actingNomineeId, tenantId: req.auth.tenantId } });
    if (!nominee) return res.status(404).json({ error: 'Nominee not found' });
    if (nominee.dataSubjectIdentifier.toLowerCase() !== parsed.data.dataSubjectIdentifier.toLowerCase()) {
      return res.status(400).json({ error: 'This nominee is not registered for the given data subject (DPDP Section 14)' });
    }
  }

  // Auto-set a due date from the tenant's configurable response window
  // (Tenant.dsarResponseDays) when the caller didn't supply one — see the
  // honesty note on that field: this is a configurable operational target,
  // not an assertion of the exact statutory number for every request type.
  const dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : await defaultDueDate(req.auth.tenantId);

  const dsar = await prisma.dsar.create({
    data: { ...parsed.data, dueDate, tenantId: req.auth.tenantId, status: 'RECEIVED', createdById: req.auth.userId },
  });

  await writeAudit({ req, action: 'DSAR_CREATED', objectType: 'Dsar', objectId: dsar.id, newValue: dsar });
  res.status(201).json({ dsar });
});

// Step: AI IMPACT DISCOVERY + REMEDIATION PLAN (Section 11)
router.post('/:id/analyze-impact', requirePermission('dsar:manage'), async (req, res) => {
  const dsar = await prisma.dsar.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!dsar) return res.status(404).json({ error: 'DSAR not found' });
  if (dsar.status !== 'RECEIVED') {
    return res.status(400).json({ error: `DSAR is already past the impact-analysis step (status: ${dsar.status})` });
  }

  const impactRecords = await analyzeImpact(req.auth.tenantId, dsar.id, dsar.dataSubjectIdentifier);
  const actions = await generateRemediationActions(req.auth.tenantId, dsar.id, impactRecords);

  const updated = await prisma.dsar.update({
    where: { id: dsar.id },
    data: { status: 'REMEDIATION_PLANNED' },
  });

  await writeAudit({
    req,
    action: 'DSAR_IMPACT_ANALYZED',
    objectType: 'Dsar',
    objectId: dsar.id,
    newValue: { impactRecordCount: impactRecords.length, actionCount: actions.length },
  });

  res.json({ dsar: updated, impactRecords, actions });
});

// Real, executable action: remove the matched PiiRecordValue rows from
// Privault's own detected-PII index (Section 12: "source deletion" is not
// this — this is the index Privault itself controls).
router.post('/:id/actions/:actionId/execute', requirePermission('dsar:manage'), async (req, res) => {
  const action = await prisma.remediationAction.findFirst({
    where: { id: req.params.actionId, dsarId: req.params.id, tenantId: req.auth.tenantId },
  });
  if (!action) return res.status(404).json({ error: 'Remediation action not found' });
  if (action.actionType !== 'DELETE') {
    return res.status(400).json({
      error: `${action.actionType} requires a live integration into the customer's environment and cannot be executed by Privault directly. Use the manual-attestation endpoint once it's been done outside Privault.`,
    });
  }
  if (action.status === 'COMPLETED' || action.status === 'MANUALLY_ATTESTED') {
    return res.status(400).json({ error: 'This action has already been completed' });
  }

  const dsar = await prisma.dsar.findFirst({ where: { id: action.dsarId, tenantId: req.auth.tenantId } });

  const deleted = await prisma.piiRecordValue.deleteMany({
    where: {
      tenantId: req.auth.tenantId,
      dataAssetId: action.dataAssetId,
      ...matchWhere(req.auth.tenantId, dsar.dataSubjectIdentifier),
    },
  });

  const updated = await prisma.remediationAction.update({
    where: { id: action.id },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      evidence: `Removed ${deleted.count} indexed value(s) matching "${dsar.dataSubjectIdentifier}" from data asset ${action.dataAssetId}. This removes them from Privault's index only; a later rescan will surface them again if the source system still holds them — use that to verify source erasure.`,
      reviewerId: req.auth.userId,
    },
  });

  await writeAudit({
    req,
    action: 'REMEDIATION_ACTION_EXECUTED',
    objectType: 'RemediationAction',
    objectId: action.id,
    previousValue: { status: action.status },
    newValue: { status: updated.status, deletedCount: deleted.count },
  });

  res.json({ action: updated, deletedCount: deleted.count });
});

const attestSchema = z.object({ comments: z.string().min(10) });

// Mode C manual evidence: for actions Privault can't execute itself
// (EXCLUDE, RETRAIN, EMBEDDING_DELETE, INDEX_REBUILD, MODEL_IMPACT_REVIEW),
// a human records what was actually done outside Privault. This is
// attestation, not automatic execution — the distinction is visible in the
// resulting status (MANUALLY_ATTESTED, never COMPLETED) and is never hidden
// from the DSAR record or its evidence.
router.post('/:id/actions/:actionId/attest', requirePermission('dsar:manage'), async (req, res) => {
  const parsed = attestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Provide at least 10 characters describing what was done and where (comments)' });
  }

  const action = await prisma.remediationAction.findFirst({
    where: { id: req.params.actionId, dsarId: req.params.id, tenantId: req.auth.tenantId },
  });
  if (!action) return res.status(404).json({ error: 'Remediation action not found' });
  if (action.actionType === 'DELETE') {
    return res.status(400).json({ error: 'DELETE actions are executed directly, not manually attested — use the execute endpoint.' });
  }

  const updated = await prisma.remediationAction.update({
    where: { id: action.id },
    data: {
      status: 'MANUALLY_ATTESTED',
      completedAt: new Date(),
      comments: parsed.data.comments,
      evidence: `Manually attested by ${req.auth.name} (${req.auth.role}): ${parsed.data.comments}`,
      reviewerId: req.auth.userId,
    },
  });

  await writeAudit({
    req,
    action: 'REMEDIATION_ACTION_ATTESTED',
    objectType: 'RemediationAction',
    objectId: action.id,
    previousValue: { status: action.status },
    newValue: { status: updated.status },
    reason: parsed.data.comments,
  });

  res.json({ action: updated });
});

router.post('/:id/close', requirePermission('dsar:manage'), async (req, res) => {
  const dsar = await prisma.dsar.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { actions: true },
  });
  if (!dsar) return res.status(404).json({ error: 'DSAR not found' });

  const open = dsar.actions.filter((a) => a.status !== 'COMPLETED' && a.status !== 'MANUALLY_ATTESTED');
  if (open.length) {
    return res.status(400).json({
      error: `${open.length} remediation action(s) are still open — every action must be completed or manually attested before closing a DSAR (Section 13).`,
      openActions: open.map((a) => ({ id: a.id, actionType: a.actionType, status: a.status })),
    });
  }

  const updated = await prisma.dsar.update({
    where: { id: dsar.id },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  await writeAudit({ req, action: 'DSAR_CLOSED', objectType: 'Dsar', objectId: dsar.id, newValue: { status: 'CLOSED' } });
  res.json({ dsar: updated });
});

module.exports = router;
