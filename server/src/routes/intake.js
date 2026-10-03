const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

const DAY = 24 * 60 * 60 * 1000;
// Never return the status-token hash or the requester's network hash.
const SELECT = {
  id: true, reference: true, requestType: true, requesterName: true, contactType: true, contactValue: true, dataSubjectIdentifier: true, details: true,
  isNominee: true, nomineeRelationship: true, status: true, publicMessage: true, receivedAt: true, verifiedAt: true, verificationMethod: true, verificationNote: true, dsarId: true,
  verifiedBy: { select: { id: true, name: true } },
};

router.get('/', requirePermission('intake:read'), async (req, res) => {
  const { status } = req.query;
  const items = await prisma.dsarIntake.findMany({
    where: { tenantId: req.auth.tenantId, ...(status ? { status: String(status) } : {}) },
    orderBy: { receivedAt: 'desc' }, select: SELECT,
  });
  res.json({ intakes: items });
});

const verifySchema = z.object({
  method: z.enum(['EMAIL_CALLBACK', 'PHONE_CALLBACK', 'DOCUMENT_CHECK', 'ACCOUNT_LOGIN', 'IN_PERSON', 'OTHER']),
  note: z.string().trim().min(10).max(1000),
  dataSubjectIdentifier: z.string().trim().min(1).max(200).optional(),
  actingNomineeId: z.string().uuid().optional(),
});

async function load(req, res) {
  const intake = await prisma.dsarIntake.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!intake) { res.status(404).json({ error: 'Request not found' }); return null; }
  if (intake.status === 'VERIFIED') { res.status(400).json({ error: 'This request has already been verified' }); return null; }
  if (intake.status === 'REJECTED') { res.status(400).json({ error: 'This request was already rejected' }); return null; }
  return intake;
}

// Verification is a human act: the reviewer records HOW they confirmed identity. Only then is a DSAR opened —
// with its response clock running from the date the request was RECEIVED, not the date it was verified.
router.post('/:id/verify', requirePermission('intake:manage'), async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Record how identity was verified (method, and a note of at least 10 characters)', details: parsed.error.flatten() });
  const intake = await load(req, res);
  if (!intake) return;

  const identifier = parsed.data.dataSubjectIdentifier || intake.dataSubjectIdentifier;
  if (!identifier) return res.status(400).json({ error: 'Record the identifier (email, customer ID…) that identifies this person in your systems' });
  if (parsed.data.actingNomineeId) {
    const nominee = await prisma.nominee.findFirst({ where: { id: parsed.data.actingNomineeId, tenantId: req.auth.tenantId } });
    if (!nominee || nominee.dataSubjectIdentifier.toLowerCase() !== identifier.toLowerCase()) return res.status(400).json({ error: 'That nominee is not registered for this data principal (DPDP s.14)' });
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { dsarResponseDays: true } });
  const dueDate = new Date(new Date(intake.receivedAt).getTime() + (tenant?.dsarResponseDays ?? 30) * DAY);

  const { dsar, updated } = await prisma.$transaction(async (tx) => {
    const d = await tx.dsar.create({
      data: {
        tenantId: req.auth.tenantId, dataSubjectIdentifier: identifier, requestType: intake.requestType, status: 'RECEIVED',
        notes: `Portal request ${intake.reference} from ${intake.requesterName}${intake.isNominee ? ' (nominee)' : ''}. ${intake.details || ''}`.trim(),
        dueDate, actingNomineeId: parsed.data.actingNomineeId || null, createdById: req.auth.userId,
      },
    });
    const i = await tx.dsarIntake.update({
      where: { id: intake.id },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: req.auth.userId, verificationMethod: parsed.data.method, verificationNote: parsed.data.note, dataSubjectIdentifier: identifier, dsarId: d.id },
      select: SELECT,
    });
    return { dsar: d, updated: i };
  });
  await writeAudit({ req, action: 'INTAKE_VERIFIED', objectType: 'DsarIntake', objectId: intake.id, newValue: { reference: intake.reference, method: parsed.data.method, dsarId: dsar.id }, reason: parsed.data.note });
  res.json({ intake: updated, dsar });
});

router.post('/:id/reject', requirePermission('intake:manage'), async (req, res) => {
  const parsed = z.object({ reason: z.string().trim().min(10).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Give the requester a reason (at least 10 characters) — they will see it' });
  const intake = await load(req, res);
  if (!intake) return;
  const updated = await prisma.dsarIntake.update({ where: { id: intake.id }, data: { status: 'REJECTED', publicMessage: parsed.data.reason, verifiedById: req.auth.userId, verifiedAt: new Date() }, select: SELECT });
  await writeAudit({ req, action: 'INTAKE_REJECTED', objectType: 'DsarIntake', objectId: intake.id, newValue: { reference: intake.reference }, reason: parsed.data.reason });
  res.json({ intake: updated });
});

router.post('/:id/request-info', requirePermission('intake:manage'), async (req, res) => {
  const parsed = z.object({ message: z.string().trim().min(10).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Say what you need from the requester (at least 10 characters) — they will see it' });
  const intake = await load(req, res);
  if (!intake) return;
  const updated = await prisma.dsarIntake.update({ where: { id: intake.id }, data: { status: 'NEEDS_INFO', publicMessage: parsed.data.message }, select: SELECT });
  await writeAudit({ req, action: 'INTAKE_INFO_REQUESTED', objectType: 'DsarIntake', objectId: intake.id, newValue: { reference: intake.reference }, reason: parsed.data.message });
  res.json({ intake: updated });
});

module.exports = router;
