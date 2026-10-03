const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { verifyChain } = require('../lib/auditChain');

const router = express.Router();
router.use(requireAuth);

// Recomputes the whole hash chain for the tenant. Any edited, reordered or removed entry is reported with the
// sequence number where the chain first breaks. Record `head` somewhere outside this database to also
// detect removal of the most recent entries.
router.get('/verify', requirePermission('audit_log:read'), async (req, res) => {
  res.json(await verifyChain(req.auth.tenantId));
});

// GET /audit-logs?objectType=&action=&limit=
router.get('/', requirePermission('audit_log:read'), async (req, res) => {
  const { objectType, action } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const logs = await prisma.auditLog.findMany({
    where: {
      tenantId: req.auth.tenantId,
      ...(objectType ? { objectType: String(objectType) } : {}),
      ...(action ? { action: String(action) } : {}),
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: { user: { select: { name: true, email: true, role: true } } },
  });

  res.json({ auditLogs: logs });
});

module.exports = router;
