const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

const router = express.Router();
router.use(requireAuth);

// Section 32 — AI Data Map. Returns the privacy graph (Section 8) as nodes
// + edges, scoped to what Phase 2 actually models: DataAsset and AiSystem
// nodes, connected by LineageEdge rows created when a scan is linked to an
// AI system. Unlinked data assets and AI systems with no scanned data are
// still returned as isolated nodes — the map should show gaps, not hide
// them.
router.get('/', requirePermission('lineage:read'), async (req, res) => {
  const tenantId = req.auth.tenantId;

  const [aiSystems, dataAssets, edges] = await Promise.all([
    prisma.aiSystem.findMany({
      where: { tenantId },
      select: { id: true, name: true, riskClassification: true, status: true },
    }),
    prisma.dataAsset.findMany({
      where: { tenantId },
      select: { id: true, name: true, rowCount: true, findings: { select: { category: true } } },
    }),
    prisma.lineageEdge.findMany({ where: { tenantId } }),
  ]);

  const nodes = [
    ...aiSystems.map((s) => ({
      id: `AI_SYSTEM:${s.id}`,
      type: 'AI_SYSTEM',
      refId: s.id,
      label: s.name,
      meta: { riskClassification: s.riskClassification, status: s.status },
    })),
    ...dataAssets.map((d) => ({
      id: `DATA_ASSET:${d.id}`,
      type: 'DATA_ASSET',
      refId: d.id,
      label: d.name,
      meta: {
        rowCount: d.rowCount,
        piiCategories: Array.from(new Set(d.findings.map((f) => f.category))),
      },
    })),
  ];

  const graphEdges = edges.map((e) => ({
    id: e.id,
    source: `${e.sourceType}:${e.sourceId}`,
    target: `${e.targetType}:${e.targetId}`,
    relationship: e.relationship,
  }));

  res.json({ nodes, edges: graphEdges });
});

module.exports = router;
