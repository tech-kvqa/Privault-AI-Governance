const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { assertSafeUrl, encryptSecret, generateSecret, deliver } = require('../lib/webhooks');

const router = express.Router();
router.use(requireAuth);

const PUBLIC = { id: true, url: true, description: true, events: true, enabled: true, createdAt: true };

router.get('/', requirePermission('webhook:read'), async (req, res) => {
  const endpoints = await prisma.webhookEndpoint.findMany({ where: { tenantId: req.auth.tenantId }, orderBy: { createdAt: 'desc' }, select: PUBLIC });
  res.json({ endpoints });
});

const createSchema = z.object({
  url: z.string().url(),
  description: z.string().optional(),
  events: z.array(z.string().min(1)).min(1).default(['*']),
});

router.post('/', requirePermission('webhook:manage'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  try { await assertSafeUrl(parsed.data.url); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }

  const secret = generateSecret();
  const endpoint = await prisma.webhookEndpoint.create({
    data: { ...parsed.data, tenantId: req.auth.tenantId, secretEncrypted: encryptSecret(secret), createdById: req.auth.userId },
    select: PUBLIC,
  });
  await writeAudit({ req, action: 'WEBHOOK_ENDPOINT_CREATED', objectType: 'WebhookEndpoint', objectId: endpoint.id, newValue: { url: endpoint.url, events: endpoint.events } });
  // The signing secret is returned exactly once and cannot be retrieved later.
  res.status(201).json({ endpoint, signingSecret: secret, note: 'Store this signing secret now — it is not shown again.' });
});

router.put('/:id', requirePermission('webhook:manage'), async (req, res) => {
  const parsed = z.object({ enabled: z.boolean().optional(), events: z.array(z.string().min(1)).min(1).optional(), description: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const existing = await prisma.webhookEndpoint.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, select: PUBLIC });
  if (!existing) return res.status(404).json({ error: 'Endpoint not found' });
  const endpoint = await prisma.webhookEndpoint.update({ where: { id: existing.id }, data: parsed.data, select: PUBLIC });
  await writeAudit({ req, action: 'WEBHOOK_ENDPOINT_UPDATED', objectType: 'WebhookEndpoint', objectId: endpoint.id, previousValue: existing, newValue: endpoint });
  res.json({ endpoint });
});

router.post('/:id/test', requirePermission('webhook:manage'), async (req, res) => {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });
  const delivery = await deliver(endpoint, 'WEBHOOK_TEST', { message: 'Test delivery from PRIVault AI Governance' });
  res.json({ delivery });
});

router.get('/:id/deliveries', requirePermission('webhook:read'), async (req, res) => {
  const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId }, select: { id: true } });
  if (!endpoint) return res.status(404).json({ error: 'Endpoint not found' });
  const deliveries = await prisma.webhookDelivery.findMany({ where: { endpointId: endpoint.id }, orderBy: { createdAt: 'desc' }, take: 25 });
  res.json({ deliveries });
});

module.exports = router;
