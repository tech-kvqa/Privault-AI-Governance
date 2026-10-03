const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { appendAudit } = require('../lib/auditChain');
const { newToken, hashToken, safeEqualHex, newReference } = require('../lib/tokens');

// PUBLIC data-principal portal (no login). Design rules:
//  * A request is stored UNVERIFIED and nothing is searched, exported or erased until staff confirm who is
//    asking — otherwise anyone could file an erasure request in someone else's name.
//  * Nothing here ever reveals whether the organisation holds data about the requester.
//  * The requester gets a reference and a one-time status token so they can follow progress without an account.
//  * Spam controls: per-IP rate limits and a honeypot field. There is NO captcha and NO email/SMS delivery —
//    identity is verified by staff contacting the requester using the details they supplied.
const TYPES = {
  ACCESS: 'Access my personal data',
  CORRECTION: 'Correct my personal data',
  DELETION: 'Erase my personal data',
  CONSENT_WITHDRAWAL: 'Withdraw my consent',
  OBJECTION: 'Object to how my data is used',
  AI_PROCESSING_INQUIRY: 'Ask how AI systems use my data',
  AUTOMATED_DECISION_CHALLENGE: 'Challenge an automated decision about me',
  GRIEVANCE: 'Raise a grievance',
};

const slugOk = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const DAY = 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  requestType: z.enum(Object.keys(TYPES)),
  requesterName: z.string().trim().min(2).max(120),
  contactType: z.enum(['EMAIL', 'PHONE']),
  contactValue: z.string().trim().min(5).max(120),
  dataSubjectIdentifier: z.string().trim().max(200).optional(),
  details: z.string().trim().max(2000).optional(),
  isNominee: z.boolean().optional(),
  nomineeRelationship: z.string().trim().max(120).optional(),
}).superRefine((v, ctx) => {
  if (v.contactType === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contactValue)) ctx.addIssue({ code: 'custom', path: ['contactValue'], message: 'Enter a valid email address' });
  if (v.contactType === 'PHONE' && !/^\+?[0-9 ()-]{7,20}$/.test(v.contactValue)) ctx.addIssue({ code: 'custom', path: ['contactValue'], message: 'Enter a valid phone number' });
});

function createRouter({ submitLimit = Number(process.env.PUBLIC_RATE_LIMIT_MAX || 10), lookupLimit = Number(process.env.PUBLIC_LOOKUP_RATE_LIMIT_MAX || 60) } = {}) {
  const router = express.Router();
  const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: submitLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests from this network — please try again later' } });
  const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: lookupLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts — please try again later' } });

  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  async function tenantBySlug(req, res) {
    const slug = String(req.params.slug || '').toLowerCase();
    const tenant = slugOk.test(slug) ? await prisma.tenant.findUnique({ where: { slug } }) : null;
    if (!tenant) { res.status(404).json({ error: 'Organisation not found' }); return null; }
    return tenant;
  }

  router.get('/:slug/info', lookupLimiter, async (req, res) => {
    const t = await tenantBySlug(req, res);
    if (!t) return;
    res.json({
      organisation: t.name,
      slug: t.slug,
      dpo: t.dpoEmail || t.dpoName ? { name: t.dpoName, email: t.dpoEmail, phone: t.dpoPhone } : null, // published contact, DPDP s.8(9)
      responseDays: t.dsarResponseDays,
      requestTypes: Object.entries(TYPES).map(([value, label]) => ({ value, label })),
    });
  });

  const ipHash = (req) => crypto.createHmac('sha256', process.env.PII_INDEX_KEY || process.env.JWT_SECRET || 'dev').update(`ip:${req.ip}`).digest('hex').slice(0, 24);

  router.post('/:slug/requests', submitLimiter, async (req, res) => {
    const t = await tenantBySlug(req, res);
    if (!t) return;
    // Honeypot: a real person never fills the hidden field. Pretend success so bots move on; store nothing.
    if (req.body && req.body.website) return res.status(201).json({ reference: newReference(), statusToken: newToken(), receivedAt: new Date(), respondBy: new Date(Date.now() + t.dsarResponseDays * DAY) });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request', details: parsed.error.flatten() });
    const d = parsed.data;

    let reference;
    for (let i = 0; i < 5; i++) {
      const candidate = newReference();
      if (!(await prisma.dsarIntake.findFirst({ where: { tenantId: t.id, reference: candidate } }))) { reference = candidate; break; }
    }
    if (!reference) return res.status(503).json({ error: 'Please try again' });

    const statusToken = newToken();
    const intake = await prisma.dsarIntake.create({
      data: {
        tenantId: t.id, reference, requestType: d.requestType, requesterName: d.requesterName, contactType: d.contactType, contactValue: d.contactValue,
        dataSubjectIdentifier: d.dataSubjectIdentifier || null, details: d.details || null, isNominee: !!d.isNominee, nomineeRelationship: d.nomineeRelationship || null,
        statusTokenHash: hashToken(statusToken), ipHash: ipHash(req),
      },
    });
    await appendAudit({ tenantId: t.id, userId: null, role: 'DATA_PRINCIPAL', action: 'INTAKE_SUBMITTED', objectType: 'DsarIntake', objectId: intake.id, newValue: { reference, requestType: d.requestType }, source: 'portal', ipAddress: `hash:${ipHash(req)}` });

    res.status(201).json({
      reference, statusToken, receivedAt: intake.receivedAt, respondBy: new Date(new Date(intake.receivedAt).getTime() + t.dsarResponseDays * DAY),
      note: 'Keep your reference number and this status token — the token is shown only once. We will contact you using the details you gave to confirm your identity before acting on the request.',
    });
  });

  router.post('/:slug/status', lookupLimiter, async (req, res) => {
    const t = await tenantBySlug(req, res);
    if (!t) return;
    const parsed = z.object({ reference: z.string().trim().max(40), token: z.string().trim().max(200) }).safeParse(req.body);
    const none = () => res.status(404).json({ error: 'No request matches that reference and token' });
    if (!parsed.success) return none();
    const intake = await prisma.dsarIntake.findFirst({ where: { tenantId: t.id, reference: parsed.data.reference.toUpperCase() } });
    if (!intake || !safeEqualHex(intake.statusTokenHash, hashToken(parsed.data.token))) return none();

    const dsar = intake.dsarId ? await prisma.dsar.findUnique({ where: { id: intake.dsarId }, select: { status: true, dueDate: true, closedAt: true } }) : null;
    let state = 'RECEIVED';
    let summary = 'We have received your request. We will contact you to confirm your identity before we act on it.';
    if (intake.status === 'NEEDS_INFO') { state = 'NEEDS_INFORMATION'; summary = 'We need a little more information from you.'; }
    if (intake.status === 'REJECTED') { state = 'NOT_ACCEPTED'; summary = 'We could not accept this request.'; }
    if (intake.status === 'VERIFIED') {
      if (dsar?.status === 'CLOSED') { state = 'COMPLETED'; summary = 'Your request has been completed.'; } else { state = 'IN_PROGRESS'; summary = 'Your identity was confirmed and we are working on your request.'; }
    }
    res.json({
      reference: intake.reference, requestType: intake.requestType, requestLabel: TYPES[intake.requestType], receivedAt: intake.receivedAt,
      respondBy: dsar?.dueDate || new Date(new Date(intake.receivedAt).getTime() + t.dsarResponseDays * DAY),
      state, summary, message: intake.publicMessage || null, completedAt: dsar?.closedAt || null, organisation: t.name,
      dpo: t.dpoEmail ? { name: t.dpoName, email: t.dpoEmail, phone: t.dpoPhone } : null,
    });
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
