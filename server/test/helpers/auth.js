const jwt = require('jsonwebtoken');
// Signs a token for a user backed by a live session row — what /auth/login does, for tests using the fake DB.
async function issueToken(db, user) {
  const s = await db.session.create({ data: { tenantId: user.tenantId, userId: user.id, expiresAt: new Date(Date.now() + 3600e3), lastSeenAt: new Date(), restricted: false } });
  return jwt.sign({ sub: user.id, sid: s.id }, process.env.JWT_SECRET);
}
module.exports = { issueToken };
