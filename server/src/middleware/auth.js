const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

const IDLE_MS = Number(process.env.SESSION_IDLE_MINUTES || 60) * 60 * 1000;

// A JWT is only the *handle* for a server-side session row. The token is honoured only while that session is
// live (not revoked, not expired, not idle) and its user is still active — so logout, password change,
// deactivation and admin "revoke sessions" take effect immediately.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  let payload;
  try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
  if (payload.purpose || !payload.sid) return res.status(401).json({ error: 'Invalid token' }); // e.g. an MFA-step token is not an access token

  const now = new Date();
  const session = await prisma.session.findFirst({ where: { id: payload.sid } });
  if (!session || session.revokedAt || new Date(session.expiresAt) <= now) return res.status(401).json({ error: 'Session expired or revoked' });
  if (now - new Date(session.lastSeenAt) > IDLE_MS) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    return res.status(401).json({ error: 'Session timed out due to inactivity' });
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive' });
  if (now - new Date(session.lastSeenAt) > 60_000) await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });

  req.auth = {
    userId: user.id, tenantId: user.tenantId, role: user.role, email: user.email, name: user.name,
    sessionId: session.id, restricted: session.restricted,
  };
  // Tenant requires MFA and this user has not enrolled yet: only the /auth/* endpoints work until they do.
  if (session.restricted && !req.originalUrl.startsWith('/auth/')) {
    return res.status(403).json({ error: 'Your organisation requires multi-factor authentication. Set it up to continue.', code: 'MFA_ENROLLMENT_REQUIRED' });
  }
  next();
}

module.exports = { requireAuth };
