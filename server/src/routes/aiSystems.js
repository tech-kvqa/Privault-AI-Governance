const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { assessRisk } = require('../lib/riskEngine');
const { evaluateProductionGate, GATED_STATUSES } = require('../lib/productionGate');
const { can } = require('../middleware/rbac');

const router = express.Router();
router.use(requireAuth);

const aiSystemInput = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  businessOwner: z.string().optional().nullable(),
  technicalOwner: z.string().optional().nullable(),
  privacyOwner: z.string().optional().nullable(),
  aiGovernanceOwnerId: z.string().uuid().optional().nullable(),
  vendor: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  modelProvider: z.string().optional().nullable(),
  modelVersion: z.string().optional().nullable(),
  deploymentEnvironment: z.string().optional().nullable(),
  hostingLocation: z.string().optional().nullable(),
  processingLocation: z.string().optional().nullable(),
  purpose: z.string().optional().nullable(),
  businessFunction: z.string().optional().nullable(),
  userPopulation: z.string().optional().nullable(),
  dataSubjects: z.string().optional().nullable(),
  personalDataCategories: z.array(z.string()).optional(),
  sensitiveDataCategories: z.array(z.string()).optional(),
  trainingUsage: z.boolean().optional(),
  fineTuningUsage: z.boolean().optional(),
  ragUsage: z.boolean().optional(),
  automatedDecisionUsage: z.boolean().optional(),
  humanOversight: z.boolean().optional(),
  crossBorderProcessing: z.boolean().optional(),
  vendorId: z.string().uuid().nullable().optional(),
  retention: z.string().optional().nullable(),
  retentionPeriodDays: z.number().int().positive().optional().nullable(),
  dpiaStatus: z.enum(['NOT_REQUIRED', 'REQUIRED_NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE']).optional(),
  riskClassification: z.enum(['UNCLASSIFIED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  riskRationale: z.string().optional().nullable(),
  securityControls: z.string().optional().nullable(),
  processesChildrensData: z.boolean().optional(),
  behavioralTrackingOrAds: z.boolean().optional(),
  crossBorderRestrictedCountry: z.boolean().optional(),
  status: z.enum(['PROPOSED', 'ASSESSMENT', 'PENDING_APPROVAL', 'APPROVED', 'PRODUCTION', 'SUSPENDED', 'RETIRED']).optional(),
  approvalStatus: z.string().optional().nullable(),
  // Only honoured for roles with ai_system:gate_override; recorded in the audit trail.
  gateOverrideReason: z.string().trim().min(20).max(1000).optional(),
});

// Section 51 — moving a system into APPROVED / PRODUCTION is blocked while the gate has blockers.
async function runGate(req, res, merged, targetStatus, overrideReason) {
  const [approvedDpias, vendor] = await Promise.all([
    merged.id ? prisma.dpia.count({ where: { tenantId: req.auth.tenantId, aiSystemId: merged.id, status: 'APPROVED' } }) : 0,
    merged.vendorId ? prisma.vendor.findFirst({ where: { id: merged.vendorId, tenantId: req.auth.tenantId } }) : null,
  ]);
  const gate = evaluateProductionGate(merged, { approvedDpia: approvedDpias > 0, vendor });
  if (gate.allowed) return { proceed: true, gate, overridden: false };
  const canOverride = can(req.auth.role, 'ai_system:gate_override');
  if (overrideReason && canOverride) return { proceed: true, gate, overridden: true };
  res.status(409).json({
    error: `Production gate: this AI system cannot be moved to ${targetStatus} yet`,
    blockers: gate.blockers, warnings: gate.warnings, canOverride,
  });
  return { proceed: false };
}

// GET /ai-systems?status=&risk=&q=
router.get('/', requirePermission('ai_system:read'), async (req, res) => {
  const { status, risk, q } = req.query;
  const where = {
    tenantId: req.auth.tenantId,
    ...(status ? { status } : {}),
    ...(risk ? { riskClassification: risk } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: String(q) } },
            { businessFunction: { contains: String(q) } },
            { vendor: { contains: String(q) } },
          ],
        }
      : {}),
  };

  const systems = await prisma.aiSystem.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: { aiGovernanceOwner: { select: { id: true, name: true, email: true } }, vendorRecord: { select: { id: true, name: true, dpaSigned: true } } },
  });

  res.json({ aiSystems: systems });
});

router.get('/:id', requirePermission('ai_system:read'), async (req, res) => {
  const system = await prisma.aiSystem.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { aiGovernanceOwner: { select: { id: true, name: true, email: true } }, vendorRecord: { select: { id: true, name: true, dpaSigned: true } } },
  });
  if (!system) return res.status(404).json({ error: 'AI system not found' });

  const auditTrail = await prisma.auditLog.findMany({
    where: { tenantId: req.auth.tenantId, objectType: 'AiSystem', objectId: system.id },
    orderBy: { timestamp: 'desc' },
    take: 50,
    include: { user: { select: { name: true, email: true } } },
  });

  res.json({ aiSystem: system, auditTrail });
});

router.post('/', requirePermission('ai_system:create'), async (req, res) => {
  const parsed = aiSystemInput.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }


  if (parsed.data.vendorId) {
    const v = await prisma.vendor.findFirst({ where: { id: parsed.data.vendorId, tenantId: req.auth.tenantId } });
    if (!v) return res.status(404).json({ error: 'Vendor not found' });
  }

  const { gateOverrideReason, ...input } = parsed.data;
  let gateResult = { overridden: false };
  if (input.status && GATED_STATUSES.includes(input.status)) {
    gateResult = await runGate(req, res, input, input.status, gateOverrideReason);
    if (!gateResult.proceed) return;
  }

  const system = await prisma.aiSystem.create({
    data: {
      ...input,
      tenantId: req.auth.tenantId,
      createdById: req.auth.userId,
      dataSourceType: 'USER_ENTERED', // Phase 1: everything entered through this form is manual/user-entered
    },
  });

  if (gateResult.overridden) {
    await writeAudit({ req, action: 'AI_SYSTEM_GATE_OVERRIDDEN', objectType: 'AiSystem', objectId: system.id, newValue: { status: input.status, blockers: gateResult.gate.blockers.map((b) => b.code) }, reason: gateOverrideReason });
  }
  await writeAudit({
    req,
    action: 'AI_SYSTEM_CREATED',
    objectType: 'AiSystem',
    objectId: system.id,
    newValue: system,
  });

  res.status(201).json({ aiSystem: system });
});

router.put('/:id', requirePermission('ai_system:update'), async (req, res) => {
  const parsed = aiSystemInput.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }

  const existing = await prisma.aiSystem.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  });
  if (!existing) return res.status(404).json({ error: 'AI system not found' });

  if (parsed.data.vendorId) {
    const v = await prisma.vendor.findFirst({ where: { id: parsed.data.vendorId, tenantId: req.auth.tenantId } });
    if (!v) return res.status(404).json({ error: 'Vendor not found' });
  }

  const { gateOverrideReason, ...changes } = parsed.data;
  let gateResult = { overridden: false };
  if (changes.status && GATED_STATUSES.includes(changes.status) && existing.status !== changes.status) {
    gateResult = await runGate(req, res, { ...existing, ...changes }, changes.status, gateOverrideReason);
    if (!gateResult.proceed) return;
  }

  const updated = await prisma.aiSystem.update({
    where: { id: existing.id },
    data: changes,
  });

  if (gateResult.overridden) {
    await writeAudit({ req, action: 'AI_SYSTEM_GATE_OVERRIDDEN', objectType: 'AiSystem', objectId: updated.id, newValue: { status: changes.status, blockers: gateResult.gate.blockers.map((b) => b.code) }, reason: gateOverrideReason });
  }
  await writeAudit({
    req,
    action: 'AI_SYSTEM_UPDATED',
    objectType: 'AiSystem',
    objectId: updated.id,
    previousValue: existing,
    newValue: updated,
  });

  res.json({ aiSystem: updated });
});

router.post('/:id/archive', requirePermission('ai_system:archive'), async (req, res) => {
  const existing = await prisma.aiSystem.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
  });
  if (!existing) return res.status(404).json({ error: 'AI system not found' });

  const updated = await prisma.aiSystem.update({
    where: { id: existing.id },
    data: { status: 'RETIRED' },
  });

  await writeAudit({
    req,
    action: 'AI_SYSTEM_ARCHIVED',
    objectType: 'AiSystem',
    objectId: updated.id,
    previousValue: { status: existing.status },
    newValue: { status: updated.status },
    reason: req.body && req.body.reason,
  });

  res.json({ aiSystem: updated });
});

// Section 19 — computes classification + itemized rationale from real
// fields, never an opaque score. The manual riskClassification/riskRationale
// fields from Phase 1 remain editable as an override, but this endpoint is
// the "explain why" the spec requires.
router.post('/:id/assess-risk', requirePermission('risk:assess'), async (req, res) => {
  const existing = await prisma.aiSystem.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, include: { vendorRecord: true } });
  if (!existing) return res.status(404).json({ error: 'AI system not found' });

  const result = assessRisk(existing);
  const updated = await prisma.aiSystem.update({
    where: { id: existing.id },
    data: { riskClassification: result.classification, riskRationale: result.rationale, lastAssessmentAt: new Date() },
  });

  await writeAudit({
    req,
    action: 'AI_SYSTEM_RISK_ASSESSED',
    objectType: 'AiSystem',
    objectId: existing.id,
    previousValue: { riskClassification: existing.riskClassification },
    newValue: { riskClassification: result.classification, score: result.score },
  });

  res.json({ aiSystem: updated, assessment: result });
});

// What would block this system from going to Production right now.
router.get('/:id/production-gate', requirePermission('ai_system:read'), async (req, res) => {
  const system = await prisma.aiSystem.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!system) return res.status(404).json({ error: 'AI system not found' });
  const [approvedDpias, vendor] = await Promise.all([
    prisma.dpia.count({ where: { tenantId: req.auth.tenantId, aiSystemId: system.id, status: 'APPROVED' } }),
    system.vendorId ? prisma.vendor.findFirst({ where: { id: system.vendorId, tenantId: req.auth.tenantId } }) : null,
  ]);
  res.json({ gate: evaluateProductionGate(system, { approvedDpia: approvedDpias > 0, vendor }), canOverride: can(req.auth.role, 'ai_system:gate_override') });
});

module.exports = router;
