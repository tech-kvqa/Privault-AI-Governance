const express = require('express');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { ROLE_PERMISSIONS } = require('../middleware/rbac');
const { appendAudit } = require('../lib/auditChain');
const { encryptSecret, decryptSecret } = require('../lib/secrets');
const { verifyPassword, hashPassword, validatePassword, DUMMY_HASH } = require('../lib/password');
const { generateSecret, otpauthUri } = require('../lib/totp');
const { consumeTotpStep, consumeRecoveryCode } = require('../lib/mfaConsume');
const { hashToken, newRecoveryCode, normalizeRecovery } = require('../lib/tokens');

const router = express.Router();

const SESSION_MS = Number(process.env.SESSION_HOURS || 8) * 60 * 60 * 1000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 30), standardHeaders: true, legacyHeaders: false });

const view = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, tenantId: u.tenantId, mfaEnabled: u.mfaEnabled });
const audit = (u, action, req, extra = {}) => appendAudit({ tenantId: u.tenantId, userId: u.id, role: u.role, action, objectType: 'User', objectId: u.id, source: 'app', ipAddress: req.ip, ...extra });

async function issueSession(req, user, { restricted = false, mfaVerified = false } = {}) {
  const expiresAt = new Date(Date.now() + SESSION_MS);
  const session = await prisma.session.create({
    data: { tenantId: user.tenantId, userId: user.id, expiresAt, ip: req.ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 300), restricted, mfaVerified },
  });
  const token = jwt.sign({ sub: user.id, sid: session.id, tid: user.tenantId }, process.env.JWT_SECRET, { expiresIn: Math.floor(SESSION_MS / 1000) });
  return { session, token };
}

async function registerFailure(user, req) {
  const failed = user.failedLoginCount + 1;
  const lock = failed >= MAX_FAILED;
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : user.lockedUntil } });
  await audit(user, lock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', req);
}

// ------------------------------------------------------------------------------------------------ sign in
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200), tenant: z.string().max(80).optional() });
const GENERIC = 'Invalid email or password. Repeated failed attempts temporarily lock an account.';

router.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const { email, password, tenant: tenantSlug } = parsed.data;
  const now = new Date();

  let candidates = await prisma.user.findMany({ where: { email: { equals: email.trim().toLowerCase() }, isActive: true } });
  if (tenantSlug) {
    const t = await prisma.tenant.findUnique({ where: { slug: tenantSlug.toLowerCase() } });
    candidates = t ? candidates.filter((u) => u.tenantId === t.id) : [];
  }

  // Always spend the same work, so response time does not reveal whether an email exists.
  if (!candidates.length) { await verifyPassword(password, DUMMY_HASH); return res.status(401).json({ error: GENERIC }); }

  const matches = [];
  const failed = [];
  for (const u of candidates) {
    const locked = u.lockedUntil && new Date(u.lockedUntil) > now;
    const ok = await verifyPassword(password, u.passwordHash);
    if (ok && !locked) matches.push(u); else if (!locked) failed.push(u);
  }
  if (!matches.length) {
    for (const u of failed) await registerFailure(u, req);
    return res.status(401).json({ error: GENERIC });
  }
  if (matches.length > 1) {
    return res.status(409).json({ needsTenant: true, error: 'That email is used in more than one organisation — enter your organisation handle.' });
  }

  const user = matches[0];
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });

  if (user.mfaEnabled) {
    const mfaToken = jwt.sign({ sub: user.id, purpose: 'mfa' }, process.env.JWT_SECRET, { expiresIn: 300 });
    return res.json({ mfaRequired: true, mfaToken });
  }
  const restricted = !!tenant?.requireMfa;
  const { token } = await issueSession(req, user, { restricted });
  await audit(user, 'LOGIN', req);
  res.json({ token, user: view(user), mfaSetupRequired: restricted });
});

router.post('/mfa/verify', authLimiter, async (req, res) => {
  const parsed = z.object({ mfaToken: z.string().min(10), code: z.string().max(20).optional(), recoveryCode: z.string().max(30).optional() }).safeParse(req.body);
  if (!parsed.success || (!parsed.data.code && !parsed.data.recoveryCode)) return res.status(400).json({ error: 'Provide the 6-digit code (or a recovery code)' });
  let payload;
  try { payload = jwt.verify(parsed.data.mfaToken, process.env.JWT_SECRET); } catch { return res.status(401).json({ error: 'That sign-in step expired — sign in again' }); }
  if (payload.purpose !== 'mfa') return res.status(401).json({ error: 'Invalid token' });

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive || !user.mfaEnabled || (user.lockedUntil && new Date(user.lockedUntil) > new Date())) return res.status(401).json({ error: 'Invalid code' });

  // Both branches below are atomic compare-and-swap consumption (server/src/lib/mfaConsume.js) —
  // a code or recovery code can be accepted by at most one request, even under concurrency.
  let ok = false;
  if (parsed.data.code) {
    const step = await consumeTotpStep(prisma, user.id, decryptSecret(user.mfaSecretEncrypted), parsed.data.code, user.mfaLastStep);
    ok = step !== null;
  } else {
    const h = hashToken(normalizeRecovery(parsed.data.recoveryCode));
    ok = await consumeRecoveryCode(prisma, user.id, h);
    if (ok) await audit(user, 'MFA_RECOVERY_CODE_USED', req);
  }
  if (!ok) { await registerFailure(user, req); return res.status(401).json({ error: 'Invalid code' }); }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  const { token } = await issueSession(req, user, { mfaVerified: true });
  await audit(user, 'LOGIN', req);
  res.json({ token, user: view(user) });
});

// ------------------------------------------------------------------------------------------------ one-time links
async function claimToken(rawToken, type) {
  const t = await prisma.userToken.findFirst({ where: { tokenHash: hashToken(rawToken), type } });
  if (!t || t.usedAt || new Date(t.expiresAt) <= new Date()) return null;
  const claimed = await prisma.userToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
  return claimed.count === 1 ? t : null; // single use even under concurrent requests
}

const setPasswordSchema = z.object({ token: z.string().min(20).max(200), password: z.string().max(200), name: z.string().min(1).max(120).optional() });

router.post('/accept-invite', authLimiter, async (req, res) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const t = await prisma.userToken.findFirst({ where: { tokenHash: hashToken(parsed.data.token), type: 'INVITE' } });
  if (!t || t.usedAt || new Date(t.expiresAt) <= new Date()) return res.status(400).json({ error: 'This invitation link is invalid, already used or has expired' });
  const user = await prisma.user.findUnique({ where: { id: t.userId } });
  const problems = validatePassword(parsed.data.password, { email: user.email, name: parsed.data.name || user.name });
  if (problems.length) return res.status(400).json({ error: problems[0], problems });
  if (!(await claimToken(parsed.data.token, 'INVITE'))) return res.status(400).json({ error: 'This invitation link is invalid, already used or has expired' });

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.password), isActive: true, name: parsed.data.name || user.name, passwordChangedAt: new Date() } });
  await audit(user, 'USER_INVITE_ACCEPTED', req);
  res.json({ ok: true });
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const t = await prisma.userToken.findFirst({ where: { tokenHash: hashToken(parsed.data.token), type: 'PASSWORD_RESET' } });
  if (!t || t.usedAt || new Date(t.expiresAt) <= new Date()) return res.status(400).json({ error: 'This reset link is invalid, already used or has expired' });
  const user = await prisma.user.findUnique({ where: { id: t.userId } });
  const problems = validatePassword(parsed.data.password, { email: user.email, name: user.name });
  if (problems.length) return res.status(400).json({ error: problems[0], problems });
  if (!(await claimToken(parsed.data.token, 'PASSWORD_RESET'))) return res.status(400).json({ error: 'This reset link is invalid, already used or has expired' });

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(user, 'PASSWORD_RESET_COMPLETED', req);
  res.json({ ok: true });
});

// ------------------------------------------------------------------------------------------------ signed-in account
router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { name: true, slug: true, requireMfa: true } });
  res.json({
    user: view(user),
    tenant,
    permissions: ROLE_PERMISSIONS[user.role] || [],
    session: { id: req.auth.sessionId, restricted: req.auth.restricted },
  });
});

router.post('/logout', requireAuth, async (req, res) => {
  await prisma.session.update({ where: { id: req.auth.sessionId }, data: { revokedAt: new Date() } });
  await appendAudit({ tenantId: req.auth.tenantId, userId: req.auth.userId, role: req.auth.role, action: 'LOGOUT', objectType: 'User', objectId: req.auth.userId, ipAddress: req.ip });
  res.json({ ok: true });
});

router.post('/logout-all', requireAuth, async (req, res) => {
  const r = await prisma.session.updateMany({ where: { userId: req.auth.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await appendAudit({ tenantId: req.auth.tenantId, userId: req.auth.userId, role: req.auth.role, action: 'LOGOUT_ALL', objectType: 'User', objectId: req.auth.userId, ipAddress: req.ip, newValue: { sessionsRevoked: r.count } });
  res.json({ ok: true, revoked: r.count });
});

router.get('/sessions', requireAuth, async (req, res) => {
  const rows = await prisma.session.findMany({ where: { userId: req.auth.userId, revokedAt: null }, orderBy: { lastSeenAt: 'desc' } });
  const now = new Date();
  res.json({
    sessions: rows.filter((s) => new Date(s.expiresAt) > now).map((s) => ({
      id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, ip: s.ip, userAgent: s.userAgent, current: s.id === req.auth.sessionId,
    })),
  });
});

router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const r = await prisma.session.updateMany({ where: { id: req.params.id, userId: req.auth.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count === 0) return res.status(404).json({ error: 'Session not found' });
  res.json({ ok: true });
});

router.post('/change-password', requireAuth, authLimiter, async (req, res) => {
  const parsed = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) return res.status(400).json({ error: 'Your current password is not correct' });
  const problems = validatePassword(parsed.data.newPassword, { email: user.email, name: user.name });
  if (problems.length) return res.status(400).json({ error: problems[0], problems });
  if (parsed.data.newPassword === parsed.data.currentPassword) return res.status(400).json({ error: 'Choose a password different from your current one' });

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.newPassword), passwordChangedAt: new Date() } });
  const others = await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: req.auth.sessionId } }, data: { revokedAt: new Date() } });
  await audit(user, 'PASSWORD_CHANGED', req, { newValue: { otherSessionsRevoked: others.count } });
  res.json({ ok: true, otherSessionsRevoked: others.count });
});

// ------------------------------------------------------------------------------------------------ MFA management
router.post('/mfa/setup', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (user.mfaEnabled) return res.status(400).json({ error: 'Multi-factor authentication is already enabled' });
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { name: true } });
  const secret = generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: encryptSecret(secret), mfaLastStep: null } });
  res.json({ secret, otpauthUri: otpauthUri({ secret, account: user.email, issuer: `PRIVault (${tenant.name})` }) });
});

function freshRecoveryCodes() {
  const codes = Array.from({ length: 10 }, newRecoveryCode);
  return { codes, hashes: codes.map((c) => hashToken(normalizeRecovery(c))) };
}

router.post('/mfa/enable', requireAuth, authLimiter, async (req, res) => {
  const parsed = z.object({ code: z.string().max(20) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter the 6-digit code from your authenticator app' });
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  if (user.mfaEnabled) return res.status(400).json({ error: 'Multi-factor authentication is already enabled' });
  if (!user.mfaSecretEncrypted) return res.status(400).json({ error: 'Start setup first' });
  // Consume the enrollment TOTP atomically too (same mechanism as login/reauthentication) — closes the
  // remaining gap where two concurrent /mfa/enable requests carrying the same code could both succeed.
  const step = await consumeTotpStep(prisma, user.id, decryptSecret(user.mfaSecretEncrypted), parsed.data.code, user.mfaLastStep);
  if (step === null) return res.status(400).json({ error: 'That code did not match or has already been used. Check the time on your device and try again.' });

  const { codes, hashes } = freshRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaLastStep: step, mfaRecoveryHashes: hashes } });
  if (req.auth.restricted) await prisma.session.update({ where: { id: req.auth.sessionId }, data: { restricted: false, mfaVerified: true } });
  await audit(user, 'MFA_ENABLED', req);
  res.json({ ok: true, recoveryCodes: codes, note: 'Store these recovery codes somewhere safe. They are shown only once.' });
});

// Reauthentication for sensitive MFA operations (disable, recovery-code regeneration).
// This was the actual bug reported: it validated a TOTP code without ever marking the
// step consumed, so the same code could be replayed against these endpoints — including,
// worse, reused to sign in via /mfa/verify since the two paths shared no consumption
// state. It now calls the same atomic consumeTotpStep() the login path uses, so a step
// accepted here can never be accepted again anywhere.
//
// Order matters for one more requirement: password is checked and must pass BEFORE the
// TOTP step is ever attempted, so a wrong password can never burn a valid, unused code.
async function reauthenticate(req, res) {
  const parsed = z.object({ password: z.string().max(200), code: z.string().max(30) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Enter your password and a current authenticator code' }); return null; }
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
  const passOk = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!passOk || !user.mfaEnabled) { res.status(400).json({ error: 'Password or code is incorrect' }); return null; }
  const step = await consumeTotpStep(prisma, user.id, decryptSecret(user.mfaSecretEncrypted), parsed.data.code, user.mfaLastStep);
  if (step === null) { res.status(400).json({ error: 'Password or code is incorrect' }); return null; }
  return user;
}

router.post('/mfa/disable', requireAuth, authLimiter, async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { requireMfa: true } });
  if (tenant?.requireMfa) return res.status(403).json({ error: 'Your organisation requires multi-factor authentication, so it cannot be turned off' });
  const user = await reauthenticate(req, res);
  if (!user) return;
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: req.auth.sessionId } }, data: { revokedAt: new Date() } });
  await audit(user, 'MFA_DISABLED', req);
  res.json({ ok: true });
});

router.post('/mfa/recovery-codes', requireAuth, authLimiter, async (req, res) => {
  const user = await reauthenticate(req, res);
  if (!user) return;
  const { codes, hashes } = freshRecoveryCodes();
  await prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: hashes } });
  await audit(user, 'MFA_RECOVERY_CODES_REGENERATED', req);
  res.json({ ok: true, recoveryCodes: codes });
});

module.exports = router;
