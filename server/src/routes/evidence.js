const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

const ALLOWED = /\.(pdf|png|jpe?g|txt|csv|json|md|docx|xlsx|log)$/i;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Never select `content` in list/detail queries — file bytes only leave the
// database through the explicit download endpoint.
const SELECT = {
  id: true, title: true, description: true, controlId: true, aiSystemId: true, sourceType: true,
  fileName: true, mimeType: true, sizeBytes: true, sha256: true, validUntil: true,
  reviewStatus: true, reviewNote: true, reviewedAt: true, createdAt: true,
  control: { select: { id: true, requirement: true, framework: true } },
  aiSystem: { select: { id: true, name: true } },
  uploadedBy: { select: { id: true, name: true } },
  reviewer: { select: { id: true, name: true } },
};

router.get('/', requirePermission('evidence:read'), async (req, res) => {
  const { controlId, aiSystemId } = req.query;
  const items = await prisma.evidence.findMany({
    where: {
      tenantId: req.auth.tenantId,
      ...(controlId ? { controlId: String(controlId) } : {}),
      ...(aiSystemId ? { aiSystemId: String(aiSystemId) } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: SELECT,
  });
  const now = new Date();
  res.json({ evidence: items.map((e) => ({ ...e, expired: !!(e.validUntil && e.validUntil < now) })) });
});

const bodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  controlId: z.string().uuid().optional(),
  aiSystemId: z.string().uuid().optional(),
  validUntil: z.string().min(1).optional(),
});

router.post(
  '/',
  requirePermission('evidence:create'),
  (req, res, next) => upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 5MB limit' : err.message });
    next();
  }),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
    if (!ALLOWED.test(req.file.originalname)) {
      return res.status(400).json({ error: 'Unsupported file type. Allowed: pdf, png, jpg, txt, csv, json, md, docx, xlsx, log' });
    }
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    const d = parsed.data;

    if (d.controlId && !(await prisma.complianceControl.findFirst({ where: { id: d.controlId, tenantId: req.auth.tenantId } }))) {
      return res.status(404).json({ error: 'Compliance control not found' });
    }
    if (d.aiSystemId && !(await prisma.aiSystem.findFirst({ where: { id: d.aiSystemId, tenantId: req.auth.tenantId } }))) {
      return res.status(404).json({ error: 'AI system not found' });
    }
    let validUntil = null;
    if (d.validUntil) {
      validUntil = new Date(d.validUntil);
      if (Number.isNaN(validUntil.getTime())) return res.status(400).json({ error: 'validUntil is not a valid date' });
    }

    const item = await prisma.evidence.create({
      data: {
        tenantId: req.auth.tenantId, title: d.title, description: d.description,
        controlId: d.controlId, aiSystemId: d.aiSystemId, validUntil,
        sourceType: 'MANUAL_UPLOAD', fileName: req.file.originalname, mimeType: req.file.mimetype,
        sizeBytes: req.file.size, sha256: sha256(req.file.buffer), content: req.file.buffer,
        uploadedById: req.auth.userId,
      },
      select: SELECT,
    });
    await writeAudit({ req, action: 'EVIDENCE_UPLOADED', objectType: 'Evidence', objectId: item.id, newValue: { title: item.title, sha256: item.sha256, fileName: item.fileName } });
    res.status(201).json({ evidence: item });
  }
);

// Recomputes the hash from the stored bytes. The stored hash was computed at
// upload; a mismatch means the bytes changed since — corruption or tampering.
async function integrityCheck(tenantId, id) {
  const row = await prisma.evidence.findFirst({ where: { id, tenantId } });
  if (!row) return null;
  const computed = sha256(Buffer.from(row.content));
  return { row, storedHash: row.sha256, computedHash: computed, intact: computed === row.sha256 };
}

router.post('/:id/verify', requirePermission('evidence:read'), async (req, res) => {
  const r = await integrityCheck(req.auth.tenantId, req.params.id);
  if (!r) return res.status(404).json({ error: 'Evidence not found' });
  await writeAudit({ req, action: 'EVIDENCE_INTEGRITY_VERIFIED', objectType: 'Evidence', objectId: req.params.id, newValue: { intact: r.intact } });
  res.json({ intact: r.intact, storedHash: r.storedHash, computedHash: r.computedHash });
});

router.get('/:id/download', requirePermission('evidence:read'), async (req, res) => {
  const r = await integrityCheck(req.auth.tenantId, req.params.id);
  if (!r) return res.status(404).json({ error: 'Evidence not found' });
  if (!r.intact) {
    return res.status(409).json({ error: 'Integrity check failed: stored bytes no longer match the SHA-256 recorded at upload. Download refused.' });
  }
  await writeAudit({ req, action: 'EVIDENCE_DOWNLOADED', objectType: 'Evidence', objectId: req.params.id });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(r.row.fileName)}"`);
  res.send(Buffer.from(r.row.content)); // Prisma 6 returns Bytes as Uint8Array
});

// Separation of duties: whoever uploaded evidence cannot be the one who
// accepts it as satisfying a control.
router.post('/:id/review', requirePermission('evidence:review'), async (req, res) => {
  const parsed = z.object({ status: z.enum(['ACCEPTED', 'REJECTED']), note: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  if (parsed.data.status === 'REJECTED' && !parsed.data.note?.trim()) {
    return res.status(400).json({ error: 'A note is required when rejecting evidence' });
  }

  const existing = await prisma.evidence.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, select: { id: true, uploadedById: true, reviewStatus: true } });
  if (!existing) return res.status(404).json({ error: 'Evidence not found' });
  if (existing.uploadedById === req.auth.userId) {
    return res.status(403).json({ error: 'Separation of duties: you uploaded this evidence, so someone else must review it' });
  }

  const item = await prisma.evidence.update({
    where: { id: existing.id },
    data: { reviewStatus: parsed.data.status, reviewNote: parsed.data.note || null, reviewerId: req.auth.userId, reviewedAt: new Date() },
    select: SELECT,
  });
  await writeAudit({ req, action: `EVIDENCE_${parsed.data.status}`, objectType: 'Evidence', objectId: item.id, previousValue: { reviewStatus: existing.reviewStatus }, newValue: { reviewStatus: item.reviewStatus }, reason: parsed.data.note });
  res.json({ evidence: item });
});

module.exports = router;
