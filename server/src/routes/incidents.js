const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

const WORKFLOW = ['DETECTED', 'CLASSIFIED', 'CONTAINED', 'INVESTIGATING', 'REMEDIATED', 'REVIEWED', 'CLOSED'];

router.get('/', requirePermission('incident:read'), async (req, res) => {
  const incidents = await prisma.incident.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { detectedAt: 'desc' },
    include: { aiSystem: { select: { id: true, name: true } }, shadowAiEvent: { select: { id: true, application: true } } },
  });
  res.json({ incidents });
});

const createSchema = z.object({
  aiSystemId: z.string().uuid().nullish(),
  type: z.enum([
    'PII_LEAKAGE', 'SHADOW_AI', 'UNAUTHORIZED_TRAINING', 'PROMPT_DATA_EXPOSURE', 'RAG_LEAKAGE',
    'MODEL_OUTPUT_PII', 'VENDOR_BREACH', 'UNAUTHORIZED_MODEL_ACCESS', 'DATA_POISONING', 'PRIVACY_CONTROL_FAILURE',
  ]),
  severity: z.enum(['UNCLASSIFIED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  description: z.string().min(1),
  isPersonalDataBreach: z.boolean().optional(),
  affectedDataSubjectCount: z.number().int().nonnegative().nullish(),
});

router.post('/', requirePermission('incident:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const incident = await prisma.incident.create({
    data: {
      ...parsed.data,
      // DPDP Section 8(6): any personal data breach requires notification.
      // If the creator flags this as a breach, notification-required
      // defaults on — it can be reviewed, never silently skipped.
      dpbNotificationRequired: parsed.data.isPersonalDataBreach ?? false,
      tenantId: req.auth.tenantId,
      createdById: req.auth.userId,
    },
  });
  await writeAudit({ req, action: 'INCIDENT_CREATED', objectType: 'Incident', objectId: incident.id, newValue: incident });
  res.status(201).json({ incident });
});

// Section 24's workflow is linear (Detect -> Classify -> Contain ->
// Investigate -> Remediate -> Review -> Close) — this enforces forward-only
// movement rather than letting the status jump around arbitrarily.
router.post('/:id/advance', requirePermission('incident:manage'), async (req, res) => {
  const parsed = z.object({ evidence: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

  const existing = await prisma.incident.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Incident not found' });

  const currentIndex = WORKFLOW.indexOf(existing.status);
  if (
    existing.isPersonalDataBreach && existing.dpbNotificationRequired &&
    WORKFLOW[currentIndex + 1] === 'CLOSED' &&
    (!existing.dpbNotifiedAt || !existing.affectedPrincipalsNotifiedAt)
  ) {
    return res.status(400).json({
      error: 'DPDP Section 8(6): a personal data breach cannot be closed until both the Data Protection Board and affected Data Principals have been recorded as notified.',
    });
  }
  if (currentIndex === WORKFLOW.length - 1) return res.status(400).json({ error: 'Incident is already closed' });
  const nextStatus = WORKFLOW[currentIndex + 1];

  const updated = await prisma.incident.update({
    where: { id: existing.id },
    data: {
      status: nextStatus,
      evidence: parsed.data.evidence ? `${existing.evidence || ''}\n[${nextStatus}] ${parsed.data.evidence}`.trim() : existing.evidence,
      closedAt: nextStatus === 'CLOSED' ? new Date() : null,
    },
  });

  await writeAudit({
    req, action: 'INCIDENT_ADVANCED', objectType: 'Incident', objectId: updated.id,
    previousValue: { status: existing.status }, newValue: { status: nextStatus },
  });
  res.json({ incident: updated });
});

// DPDP Act, 2023 Section 8(6) — records that the Data Protection Board of
// India and/or affected Data Principals were actually notified. Privault
// does NOT send these notifications itself (it has no channel into the
// Board or the customer's users) — this records that a human did, when,
// so the incident's compliance trail is real rather than implied.
router.post('/:id/breach-notification', requirePermission('incident:manage'), async (req, res) => {
  const parsed = z.object({
    dpbNotified: z.boolean().optional(),
    principalsNotified: z.boolean().optional(),
    affectedDataSubjectCount: z.number().int().nonnegative().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const existing = await prisma.incident.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Incident not found' });
  if (!existing.isPersonalDataBreach) {
    return res.status(400).json({ error: 'This incident is not flagged as a personal data breach' });
  }

  const now = new Date();
  const updated = await prisma.incident.update({
    where: { id: existing.id },
    data: {
      dpbNotifiedAt: parsed.data.dpbNotified ? (existing.dpbNotifiedAt || now) : existing.dpbNotifiedAt,
      affectedPrincipalsNotifiedAt: parsed.data.principalsNotified ? (existing.affectedPrincipalsNotifiedAt || now) : existing.affectedPrincipalsNotifiedAt,
      affectedDataSubjectCount: parsed.data.affectedDataSubjectCount ?? existing.affectedDataSubjectCount,
    },
  });

  await writeAudit({
    req, action: 'BREACH_NOTIFICATION_RECORDED', objectType: 'Incident', objectId: updated.id,
    previousValue: { dpbNotifiedAt: existing.dpbNotifiedAt, affectedPrincipalsNotifiedAt: existing.affectedPrincipalsNotifiedAt },
    newValue: { dpbNotifiedAt: updated.dpbNotifiedAt, affectedPrincipalsNotifiedAt: updated.affectedPrincipalsNotifiedAt },
  });
  res.json({ incident: updated });
});

module.exports = router;
