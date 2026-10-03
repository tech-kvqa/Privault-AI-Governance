const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { analyzeImpact, generateRemediationActions, defaultDueDate } = require('../lib/dsarEngine');

const router = express.Router();
router.use(requireAuth);

const createSchema = z.object({
  dataSubjectIdentifier: z.string().min(1),
  purpose: z.string().min(1),
  aiSystemId: z.string().uuid().nullish(),
  processingActivity: z.string().optional(),
  dataCategory: z.string().optional(),
  legalBasis: z.string().optional(),
  status: z.enum(['GRANTED', 'WITHDRAWN', 'EXPIRED', 'PENDING', 'REJECTED', 'NOT_REQUIRED']).optional(),
  source: z.string().optional(),
  version: z.string().optional(),
  notice: z.string().optional(),
  isMinorDataSubject: z.boolean().optional(),
  parentalConsentVerified: z.boolean().optional(),
});

router.get('/', requirePermission('consent:read'), async (req, res) => {
  const consents = await prisma.consent.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { collectedAt: 'desc' },
    include: { aiSystem: { select: { id: true, name: true } } },
  });
  res.json({ consents });
});

router.post('/', requirePermission('consent:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  // DPDP Act, 2023 Section 9 — a minor's consent alone is not valid. This
  // is a real enforced rule, not just a UI hint: the API refuses to record
  // a minor's consent as GRANTED without parental verification also being
  // asserted true in the same request.
  const data = parsed.data;
  if (data.isMinorDataSubject && (data.status === undefined || data.status === 'GRANTED') && !data.parentalConsentVerified) {
    return res.status(400).json({
      error: 'DPDP Section 9: a minor data subject\'s consent cannot be recorded as Granted without parentalConsentVerified also being true.',
    });
  }

  const consent = await prisma.consent.create({
    data: {
      ...data,
      tenantId: req.auth.tenantId,
      createdById: req.auth.userId,
      verifiedById: data.parentalConsentVerified ? req.auth.userId : undefined,
      verifiedAt: data.parentalConsentVerified ? new Date() : undefined,
    },
  });

  await writeAudit({ req, action: 'CONSENT_CREATED', objectType: 'Consent', objectId: consent.id, newValue: consent });
  res.status(201).json({ consent });
});

// Section 10: "When consent is withdrawn: automatically create an AI
// remediation workflow." This creates a CONSENT_WITHDRAWAL DSAR, runs
// impact analysis immediately (reusing the same engine "Find Me in AI"
// uses), and generates remediation actions — the full pipeline, not just a
// status flip.
router.post('/:id/withdraw', requirePermission('consent:withdraw'), async (req, res) => {
  const consent = await prisma.consent.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!consent) return res.status(404).json({ error: 'Consent not found' });
  if (consent.status === 'WITHDRAWN') return res.status(400).json({ error: 'Consent is already withdrawn' });

  const updatedConsent = await prisma.consent.update({
    where: { id: consent.id },
    data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
  });

  const dsar = await prisma.dsar.create({
    data: {
      tenantId: req.auth.tenantId,
      dataSubjectIdentifier: consent.dataSubjectIdentifier,
      requestType: 'CONSENT_WITHDRAWAL',
      status: 'RECEIVED',
      dueDate: await defaultDueDate(req.auth.tenantId),
      notes: `Auto-created from consent withdrawal (purpose: "${consent.purpose}")`,
      triggeredByConsentId: consent.id,
      createdById: req.auth.userId,
    },
  });

  const impactRecords = await analyzeImpact(req.auth.tenantId, dsar.id, dsar.dataSubjectIdentifier);
  const actions = await generateRemediationActions(req.auth.tenantId, dsar.id, impactRecords);
  const updatedDsar = await prisma.dsar.update({ where: { id: dsar.id }, data: { status: 'REMEDIATION_PLANNED' } });

  await writeAudit({
    req,
    action: 'CONSENT_WITHDRAWN',
    objectType: 'Consent',
    objectId: consent.id,
    previousValue: { status: consent.status },
    newValue: { status: 'WITHDRAWN', triggeredDsarId: dsar.id },
  });

  res.json({ consent: updatedConsent, dsar: updatedDsar, impactRecordCount: impactRecords.length, actionCount: actions.length });
});

module.exports = router;
