const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { maskValue, canSeeUnmasked } = require('../lib/masking');
const { matchWhere, isHashed } = require('../lib/piiIndex');

const router = express.Router();
router.use(requireAuth);

const querySchema = z.object({ identifier: z.string().min(1) });

// Module 04 — "Find Me in AI". Section 9's core rule: never claim absence
// without having actually looked. Every AI system gets exactly one of:
//   FOUND      — the identifier matched a value in data linked to it
//   NOT_FOUND  — it has linked data, ALL of it fully scanned, and the
//                identifier is not among the PII columns Privault indexed
//   UNKNOWN    — nothing is linked, or the linked data was only PARTIALLY
//                scanned (sampled / over the scan limits), so absence can't be
//                concluded. The reason is returned so the UI can say which.
// Matching is exact (trim + case-insensitive), against classified PII columns
// only; values from live connectors are matched through a keyed hash.
router.get('/', requirePermission('find_me:read'), async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Provide an identifier to search for (?identifier=...)' });
  const { identifier } = parsed.data;
  const tenantId = req.auth.tenantId;
  const unmasked = canSeeUnmasked(req.auth.role);

  const matches = await prisma.piiRecordValue.findMany({
    where: { tenantId, ...matchWhere(tenantId, identifier) },
    include: { dataAsset: { include: { aiSystem: { select: { id: true, name: true } } } } },
  });
  const matchedAssetIds = new Set(matches.map((m) => m.dataAssetId));

  const [edges, assets, allSystems] = await Promise.all([
    prisma.lineageEdge.findMany({ where: { tenantId, targetType: 'AI_SYSTEM', sourceType: 'DATA_ASSET' } }),
    prisma.dataAsset.findMany({ where: { tenantId }, select: { id: true, aiSystemId: true, scanComplete: true } }),
    prisma.aiSystem.findMany({ where: { tenantId }, select: { id: true, name: true } }),
  ]);
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // Absence may only be concluded when EVERY linked asset was fully scanned —
  // one sampled table is enough to leave the identifier possibly hiding in it.
  const coverage = new Map(); // systemId -> { linked, allComplete }
  const link = (systemId, asset) => {
    const cur = coverage.get(systemId) || { linked: false, allComplete: true };
    cur.linked = true;
    if (!asset.scanComplete) cur.allComplete = false;
    coverage.set(systemId, cur);
  };
  assets.forEach((a) => { if (a.aiSystemId) link(a.aiSystemId, a); });
  edges.forEach((e) => { const a = assetById.get(e.sourceId); if (a) link(e.targetId, a); });

  const foundSystems = new Set();
  matches.forEach((m) => { if (m.dataAsset.aiSystemId) foundSystems.add(m.dataAsset.aiSystemId); });
  edges.filter((e) => matchedAssetIds.has(e.sourceId)).forEach((e) => foundSystems.add(e.targetId));

  const aiSystems = allSystems.map((s) => {
    const cov = coverage.get(s.id);
    if (foundSystems.has(s.id)) return { aiSystemId: s.id, name: s.name, status: 'FOUND', reason: 'Matched an indexed value in data linked to this system' };
    if (cov?.linked && cov.allComplete) return { aiSystemId: s.id, name: s.name, status: 'NOT_FOUND', reason: 'Not present in the PII columns Privault indexed; every linked data asset was fully scanned' };
    if (cov?.linked) return { aiSystemId: s.id, name: s.name, status: 'UNKNOWN', reason: 'Linked data was only partially scanned (sampled or over the scan limits), so absence cannot be confirmed' };
    return { aiSystemId: s.id, name: s.name, status: 'UNKNOWN', reason: 'No scanned data asset is linked to this system' };
  });

  const foundIn = matches.map((m) => ({
    dataAssetId: m.dataAssetId,
    dataAssetName: m.dataAsset.name,
    category: m.category,
    column: m.column,
    hashed: isHashed(m.value),
    value: isHashed(m.value) ? 'matched via hashed index' : unmasked ? m.value : maskValue(m.value, m.category),
    scanComplete: m.dataAsset.scanComplete,
    aiSystem: m.dataAsset.aiSystem ? { id: m.dataAsset.aiSystem.id, name: m.dataAsset.aiSystem.name } : null,
  }));

  await writeAudit({
    req, action: 'FIND_ME_IN_AI_SEARCHED', objectType: 'DataSubjectSearch',
    newValue: { identifierMasked: maskValue(identifier, 'Generic'), matchCount: matches.length }, reason: 'Find Me in AI lookup',
  });

  res.json({ identifier, foundIn, aiSystems });
});

module.exports = router;
