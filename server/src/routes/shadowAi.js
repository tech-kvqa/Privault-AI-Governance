const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { parseUpload } = require('../lib/fileParse');
const { detectPii } = require('../lib/piiDetect');
const { evaluatePolicies } = require('../lib/policyEngine');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- Policies (Section 18) ----------

const policySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  requireExternalAi: z.boolean().optional(),
  requirePersonalData: z.boolean().optional(),
  categories: z.array(z.string()).optional(),
  action: z.enum(['ALLOW', 'WARN', 'BLOCK', 'REQUIRE_JUSTIFICATION', 'CREATE_INCIDENT']),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
});

router.get('/policies', requirePermission('policy:read'), async (req, res) => {
  const policies = await prisma.shadowAiPolicy.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { priority: 'asc' },
  });
  res.json({ policies });
});

router.post('/policies', requirePermission('policy:create'), async (req, res) => {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const policy = await prisma.shadowAiPolicy.create({
    data: { ...parsed.data, tenantId: req.auth.tenantId, createdById: req.auth.userId },
  });
  await writeAudit({ req, action: 'SHADOW_AI_POLICY_CREATED', objectType: 'ShadowAiPolicy', objectId: policy.id, newValue: policy });
  res.status(201).json({ policy });
});

router.put('/policies/:id', requirePermission('policy:create'), async (req, res) => {
  const parsed = policySchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const existing = await prisma.shadowAiPolicy.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!existing) return res.status(404).json({ error: 'Policy not found' });

  const updated = await prisma.shadowAiPolicy.update({ where: { id: existing.id }, data: parsed.data });
  await writeAudit({
    req, action: 'SHADOW_AI_POLICY_UPDATED', objectType: 'ShadowAiPolicy', objectId: updated.id,
    previousValue: existing, newValue: updated,
  });
  res.json({ policy: updated });
});

// ---------- Events (Section 17) ----------

const eventFieldsSchema = z.object({
  employeeIdentifier: z.string().min(1),
  application: z.string().min(1),
  destination: z.string().optional(),
  eventType: z.enum(['AI_WEBSITE_VISIT', 'FILE_UPLOAD_TO_AI', 'API_CALL_TO_AI', 'BROWSER_EXTENSION_DETECTED', 'UNAUTHORIZED_AGENT_DETECTED']),
  isExternalAi: z.coerce.boolean().optional(),
});

router.get('/events', requirePermission('shadow_ai:read'), async (req, res) => {
  const events = await prisma.shadowAiEvent.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { detectedAt: 'desc' },
    include: { matchedPolicy: { select: { id: true, name: true } } },
  });
  res.json({ events });
});

// Mode C event logging (Section 16's real client agents are out of scope
// for this backend). An optional file attachment is genuinely scanned by
// Phase 2's PII engine — `piiDetected`/`piiCategories` are never guessed.
router.post('/events', requirePermission('shadow_ai:create'), upload.single('file'), async (req, res) => {
  const parsed = eventFieldsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const fields = parsed.data;
  const isExternalAi = fields.isExternalAi ?? true;

  let piiDetected = false;
  let piiCategories = [];
  let recordCount = null;
  let fileName = null;

  if (req.file) {
    fileName = req.file.originalname;
    try {
      const { headers, rows } = parseUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
      const { findings } = detectPii(headers, rows);
      piiCategories = Array.from(new Set(findings.map((f) => f.category)));
      piiDetected = piiCategories.length > 0;
      recordCount = rows.length;
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }

  const policies = await prisma.shadowAiPolicy.findMany({ where: { tenantId: req.auth.tenantId, enabled: true } });
  const { policy, action } = evaluatePolicies({ isExternalAi, personalDataDetected: piiDetected, categories: piiCategories }, policies);

  const event = await prisma.shadowAiEvent.create({
    data: {
      tenantId: req.auth.tenantId,
      employeeIdentifier: fields.employeeIdentifier,
      application: fields.application,
      destination: fields.destination || null,
      eventType: fields.eventType,
      isExternalAi,
      fileName,
      piiDetected,
      piiCategories,
      recordCount,
      matchedPolicyId: policy?.id || null,
      recommendedAction: action,
      enforced: false,
      source: fileName ? 'MANUAL_UPLOAD' : 'USER_ENTERED',
      createdById: req.auth.userId,
    },
    include: { matchedPolicy: { select: { id: true, name: true } } },
  });

  await writeAudit({
    req,
    action: 'SHADOW_AI_EVENT_LOGGED',
    objectType: 'ShadowAiEvent',
    objectId: event.id,
    newValue: { application: event.application, piiDetected, recommendedAction: action },
  });

  // Section 18: a CREATE_INCIDENT policy action isn't just a log label — it
  // actually opens an Incident (Section 24), so the event feeds the real
  // incident workflow rather than dead-ending as a status string.
  let createdIncident = null;
  if (action === 'CREATE_INCIDENT') {
    createdIncident = await prisma.incident.create({
      data: {
        tenantId: req.auth.tenantId,
        shadowAiEventId: event.id,
        type: 'SHADOW_AI',
        status: 'DETECTED',
        severity: piiDetected ? 'HIGH' : 'MEDIUM',
        description: `Auto-created from Shadow AI event: ${fields.employeeIdentifier} used ${fields.application}${fileName ? ` (uploaded ${fileName})` : ''}. Matched policy: ${policy?.name || 'none'}.`,
        createdById: req.auth.userId,
      },
    });
    await writeAudit({
      req, action: 'INCIDENT_CREATED', objectType: 'Incident', objectId: createdIncident.id,
      newValue: { type: 'SHADOW_AI', shadowAiEventId: event.id }, reason: 'Auto-created by Shadow AI policy engine',
    });
  }

  res.status(201).json({
    event,
    incident: createdIncident,
    note: action === 'ALLOW'
      ? undefined
      : `Recommended action: ${action}. Enforcement (blocking the upload in real time) requires a browser extension or endpoint agent — not built in this deployment. This is logged as a recommendation only.`,
  });
});

router.get('/dashboard', requirePermission('shadow_ai:read'), async (req, res) => {
  const tenantId = req.auth.tenantId;
  const [total, withPii, blocked, warned] = await Promise.all([
    prisma.shadowAiEvent.count({ where: { tenantId } }),
    prisma.shadowAiEvent.count({ where: { tenantId, piiDetected: true } }),
    prisma.shadowAiEvent.count({ where: { tenantId, recommendedAction: 'BLOCK' } }),
    prisma.shadowAiEvent.count({ where: { tenantId, recommendedAction: 'WARN' } }),
  ]);
  res.json({ kpis: { totalEvents: total, eventsWithPii: withPii, recommendedBlocks: blocked, recommendedWarnings: warned } });
});

module.exports = router;
