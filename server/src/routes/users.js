const express = require('express');
const { z } = require('zod');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { hashPassword } = require('../lib/password');
const { newToken, hashToken } = require('../lib/tokens');

const router = express.Router();
router.use(requireAuth);

const ROLES = ['SUPER_ADMIN', 'AI_GOVERNANCE_ADMIN', 'PRIVACY_OFFICER', 'DPO', 'AI_SYSTEM_OWNER', 'DATA_OWNER', 'SECURITY_ADMIN', 'AUDITOR', 'HUMAN_REVIEWER', 'INCIDENT_MANAGER', 'READ_ONLY', 'CUSTOMER_APPEAL_USER'];
const INVITE_MS = 72 * 60 * 60 * 1000;
const RESET_MS = 24 * 60 * 60 * 1000;

// Never expose credential material.
const SELECT = { id: true, name: true, email: true, role: true, isActive: true, mfaEnabled: true, lastLoginAt: true, passwordChangedAt: true, lockedUntil: true, createdAt: true };
const status = (u) => (!u.isActive ? (u.passwordChangedAt ? 'deactivated' : 'invited') : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? 'locked' : 'active');

// Privilege-escalation guard: only a Super Admin may create, change, or act on Super Admin accounts.
const touchesSuperAdmin = (actorRole, ...roles) => actorRole !== 'SUPER_ADMIN' && roles.includes('SUPER_ADMIN');

async function otherActiveSuperAdmins(tenantId, excludeId) {
  return prisma.user.count({ where: { tenantId, role: 'SUPER_ADMIN', isActive: true, id: { not: excludeId } } });
}

router.get('/', requirePermission('user:read'), async (req, res) => {
  const users = await prisma.user.findMany({ where: { tenantId: req.auth.tenantId }, orderBy: { createdAt: 'asc' }, select: SELECT });
  res.json({ users: users.map((u) => ({ ...u, status: status(u) })) });
});

// ---- organisation security policy (before /:id so "policy" is not read as an id)
router.get('/policy', requirePermission('user:read'), async (req, res) => {
  const t = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { requireMfa: true } });
  const users = await prisma.user.findMany({ where: { tenantId: req.auth.tenantId, isActive: true }, select: { mfaEnabled: true } });
  res.json({ requireMfa: t.requireMfa, activeUsers: users.length, enrolled: users.filter((u) => u.mfaEnabled).length });
});

router.put('/policy', requirePermission('user:manage'), async (req, res) => {
  const parsed = z.object({ requireMfa: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const before = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { requireMfa: true } });
  await prisma.tenant.update({ where: { id: req.auth.tenantId }, data: { requireMfa: parsed.data.requireMfa } });
  let restricted = 0;
  if (parsed.data.requireMfa) {
    // Sessions that are already open for users who have not enrolled become restricted immediately.
    const r = await prisma.session.updateMany({ where: { tenantId: req.auth.tenantId, revokedAt: null, restricted: false, user: { mfaEnabled: false } }, data: { restricted: true } });
    restricted = r.count;
  } else {
    // Turning the requirement OFF must release any session it had restricted — otherwise those sessions
    // stay locked out of everything but /auth/* until their next login, even though the policy no longer applies.
    await prisma.session.updateMany({ where: { tenantId: req.auth.tenantId, revokedAt: null, restricted: true }, data: { restricted: false } });
  }
  await writeAudit({ req, action: 'SECURITY_POLICY_UPDATED', objectType: 'Tenant', objectId: req.auth.tenantId, previousValue: before, newValue: { requireMfa: parsed.data.requireMfa, sessionsRestricted: restricted } });
  res.json({ requireMfa: parsed.data.requireMfa, sessionsRestricted: restricted });
});

// ---- invite
const inviteSchema = z.object({ email: z.string().email().max(254), name: z.string().trim().min(1).max(120), role: z.enum(ROLES) });

router.post('/', requirePermission('user:manage'), async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const { name, role } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();
  if (touchesSuperAdmin(req.auth.role, role)) return res.status(403).json({ error: 'Only a Super Admin can create Super Admin accounts' });
  if (await prisma.user.findFirst({ where: { tenantId: req.auth.tenantId, email: { equals: email } } })) {
    return res.status(409).json({ error: 'A user with that email already exists in this organisation' });
  }

  // The account exists but cannot sign in until the invitation is accepted (isActive=false, unusable password).
  const user = await prisma.user.create({
    data: { tenantId: req.auth.tenantId, email, name, role, isActive: false, passwordHash: await hashPassword(crypto.randomBytes(24).toString('hex')) },
    select: SELECT,
  });
  const token = newToken();
  const expiresAt = new Date(Date.now() + INVITE_MS);
  await prisma.userToken.create({ data: { tenantId: req.auth.tenantId, userId: user.id, type: 'INVITE', tokenHash: hashToken(token), expiresAt, createdById: req.auth.userId } });
  await writeAudit({ req, action: 'USER_INVITED', objectType: 'User', objectId: user.id, newValue: { email, role } });
  res.status(201).json({
    user: { ...user, status: 'invited' },
    invite: { token, path: `/accept-invite?token=${token}`, expiresAt },
    note: 'No email is sent. Pass this one-time link to the new user yourself — it is shown only once and expires in 72 hours.',
  });
});

async function loadTarget(req, res) {
  const target = await prisma.user.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, select: { ...SELECT, tenantId: true } });
  if (!target) { res.status(404).json({ error: 'User not found' }); return null; }
  if (touchesSuperAdmin(req.auth.role, target.role)) { res.status(403).json({ error: 'Only a Super Admin can manage Super Admin accounts' }); return null; }
  return target;
}

router.put('/:id', requirePermission('user:manage'), async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(120).optional(), role: z.enum(ROLES).optional(), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const target = await loadTarget(req, res);
  if (!target) return;
  const d = parsed.data;

  if (target.id === req.auth.userId && (d.role !== undefined || d.isActive !== undefined)) {
    return res.status(400).json({ error: 'You cannot change your own role or deactivate yourself — ask another administrator' });
  }
  if (d.role && touchesSuperAdmin(req.auth.role, d.role)) return res.status(403).json({ error: 'Only a Super Admin can grant the Super Admin role' });
  const demotes = target.role === 'SUPER_ADMIN' && target.isActive && ((d.role && d.role !== 'SUPER_ADMIN') || d.isActive === false);
  if (demotes && (await otherActiveSuperAdmins(req.auth.tenantId, target.id)) < 1) {
    return res.status(400).json({ error: 'This is the last active Super Admin — appoint another one first' });
  }
  if (d.isActive === true && !target.passwordChangedAt) return res.status(400).json({ error: 'This user has not accepted their invitation yet' });

  const updated = await prisma.user.update({ where: { id: target.id }, data: d, select: SELECT });
  if (d.isActive === false) await prisma.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({
    req, action: d.role && d.role !== target.role ? 'USER_ROLE_CHANGED' : d.isActive === false ? 'USER_DEACTIVATED' : d.isActive === true ? 'USER_REACTIVATED' : 'USER_UPDATED',
    objectType: 'User', objectId: target.id, previousValue: { role: target.role, isActive: target.isActive, name: target.name }, newValue: { role: updated.role, isActive: updated.isActive, name: updated.name },
  });
  res.json({ user: { ...updated, status: status(updated) } });
});

router.post('/:id/reset-password', requirePermission('user:manage'), async (req, res) => {
  const target = await loadTarget(req, res);
  if (!target) return;
  const token = newToken();
  const expiresAt = new Date(Date.now() + RESET_MS);
  await prisma.userToken.create({ data: { tenantId: req.auth.tenantId, userId: target.id, type: 'PASSWORD_RESET', tokenHash: hashToken(token), expiresAt, createdById: req.auth.userId } });
  await writeAudit({ req, action: 'USER_PASSWORD_RESET_ISSUED', objectType: 'User', objectId: target.id });
  res.status(201).json({ reset: { token, path: `/accept-invite?token=${token}&reset=1`, expiresAt }, note: 'No email is sent. Pass this one-time link to the user — shown only once, expires in 24 hours.' });
});

router.post('/:id/revoke-sessions', requirePermission('user:manage'), async (req, res) => {
  const target = await loadTarget(req, res);
  if (!target) return;
  const r = await prisma.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ req, action: 'USER_SESSIONS_REVOKED', objectType: 'User', objectId: target.id, newValue: { revoked: r.count } });
  res.json({ ok: true, revoked: r.count });
});

// For a user who lost their authenticator and recovery codes. Audited; they must enrol again.
router.post('/:id/reset-mfa', requirePermission('user:manage'), async (req, res) => {
  const target = await loadTarget(req, res);
  if (!target) return;
  await prisma.user.update({ where: { id: target.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
  await prisma.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ req, action: 'USER_MFA_RESET', objectType: 'User', objectId: target.id });
  res.json({ ok: true });
});

module.exports = router;
