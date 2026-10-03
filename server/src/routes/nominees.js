const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

// DPDP Act, 2023 Section 14 — "Right to Nominate": a Data Principal may
// register another individual to exercise their rights in the event of
// death or incapacity. Registration is independent of any single request —
// it's recorded ahead of time so a later DSAR can reference it.

router.get('/', requirePermission('dsar:read'), async (req, res) => {
  const { dataSubjectIdentifier } = req.query;
  const nominees = await prisma.nominee.findMany({
    where: {
      tenantId: req.auth.tenantId,
      ...(dataSubjectIdentifier ? { dataSubjectIdentifier: { equals: String(dataSubjectIdentifier) } } : {}),
    },
    orderBy: { registeredAt: 'desc' },
  });
  res.json({ nominees });
});

const createSchema = z.object({
  dataSubjectIdentifier: z.string().min(1),
  nomineeName: z.string().min(1),
  nomineeContact: z.string().min(1),
  relationship: z.string().optional(),
});

router.post('/', requirePermission('dsar:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const nominee = await prisma.nominee.create({
    data: { ...parsed.data, tenantId: req.auth.tenantId, createdById: req.auth.userId },
  });
  await writeAudit({ req, action: 'NOMINEE_REGISTERED', objectType: 'Nominee', objectId: nominee.id, newValue: nominee });
  res.status(201).json({ nominee });
});

module.exports = router;
