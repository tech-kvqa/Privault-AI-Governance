const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { parseUpload } = require('../lib/fileParse');
const { detectPii } = require('../lib/piiDetect');
const { maskValue, canSeeUnmasked } = require('../lib/masking');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — Phase 2 is Mode C manual evidence, not bulk ingestion
});

async function getOrCreateManualConnector(tenantId, userId) {
  let connector = await prisma.connector.findFirst({
    where: { tenantId, type: 'FILE_UPLOAD', name: 'Manual File Upload' },
  });
  if (!connector) {
    connector = await prisma.connector.create({
      data: { tenantId, name: 'Manual File Upload', type: 'FILE_UPLOAD', status: 'CONNECTED', createdById: userId },
    });
  }
  return connector;
}

const scanBodySchema = z.object({
  aiSystemId: z.string().uuid().optional(),
  relationship: z.enum(['FEEDS', 'TRAINED_ON', 'USED_IN_RAG']).optional(),
});

// POST /data-discovery/scan  (multipart/form-data: file, aiSystemId?, relationship?)
router.post('/scan', requirePermission('data_asset:create'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

  const parsedBody = scanBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsedBody.error.flatten() });
  }
  const { aiSystemId, relationship } = parsedBody.data;

  if (aiSystemId) {
    const system = await prisma.aiSystem.findFirst({ where: { id: aiSystemId, tenantId: req.auth.tenantId } });
    if (!system) return res.status(404).json({ error: 'AI system not found' });
  }

  const connector = await getOrCreateManualConnector(req.auth.tenantId, req.auth.userId);
  const run = await prisma.connectorRun.create({
    data: { tenantId: req.auth.tenantId, connectorId: connector.id, status: 'RUNNING' },
  });

  let parsedFile;
  try {
    parsedFile = parseUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
  } catch (err) {
    await prisma.connectorRun.update({
      where: { id: run.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage: err.message },
    });
    return res.status(err.status || 400).json({ error: err.message });
  }

  const { headers, rows } = parsedFile;
  const { findings, values, rowsScanned, complete } = detectPii(headers, rows);

  const dataAsset = await prisma.dataAsset.create({
    data: {
      tenantId: req.auth.tenantId,
      connectorRunId: run.id,
      name: req.file.originalname,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      rowCount: rows.length,
      columnCount: headers.length,
      aiSystemId: aiSystemId || null,
      dataSourceType: 'MANUAL_UPLOAD',
      status: 'SCANNED',
      scanComplete: complete,
      rowsScanned,
      scannedAt: new Date(),
      createdById: req.auth.userId,
    },
  });

  if (findings.length) {
    await prisma.piiFinding.createMany({
      data: findings.map((f) => ({ ...f, tenantId: req.auth.tenantId, dataAssetId: dataAsset.id })),
    });
  }
  if (values.length) {
    await prisma.piiRecordValue.createMany({
      data: values.map((v) => ({ ...v, tenantId: req.auth.tenantId, dataAssetId: dataAsset.id })),
    });
  }

  await prisma.connectorRun.update({
    where: { id: run.id },
    data: { status: 'SUCCESS', finishedAt: new Date(), recordsScanned: rowsScanned, findingsCount: findings.length },
  });

  if (aiSystemId) {
    await prisma.lineageEdge.upsert({
      where: {
        tenantId_sourceType_sourceId_targetType_targetId_relationship: {
          tenantId: req.auth.tenantId,
          sourceType: 'DATA_ASSET',
          sourceId: dataAsset.id,
          targetType: 'AI_SYSTEM',
          targetId: aiSystemId,
          relationship: relationship || 'FEEDS',
        },
      },
      update: {},
      create: {
        tenantId: req.auth.tenantId,
        sourceType: 'DATA_ASSET',
        sourceId: dataAsset.id,
        targetType: 'AI_SYSTEM',
        targetId: aiSystemId,
        relationship: relationship || 'FEEDS',
      },
    });
  }

  await writeAudit({
    req,
    action: 'DATA_ASSET_SCANNED',
    objectType: 'DataAsset',
    objectId: dataAsset.id,
    newValue: { name: dataAsset.name, findingsCount: findings.length, rowsScanned },
  });

  res.status(201).json({
    dataAsset, findings, rowsScanned, scanComplete: complete,
    note: complete ? undefined : 'This file is larger than the scan limits, so only part of it was indexed. Find Me in AI will treat it as partially scanned and will not report absence based on it.',
  });
});

router.get('/assets', requirePermission('data_asset:read'), async (req, res) => {
  const assets = await prisma.dataAsset.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      findings: true,
      aiSystem: { select: { id: true, name: true } },
    },
  });
  res.json({ dataAssets: assets });
});

router.get('/assets/:id', requirePermission('data_asset:read'), async (req, res) => {
  const asset = await prisma.dataAsset.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: { findings: true, aiSystem: { select: { id: true, name: true } } },
  });
  if (!asset) return res.status(404).json({ error: 'Data asset not found' });

  const rawValues = await prisma.piiRecordValue.findMany({
    where: { dataAssetId: asset.id },
    orderBy: [{ column: 'asc' }, { rowNumber: 'asc' }],
    take: 100, // sample only — this endpoint is for review, not export
  });

  const unmasked = canSeeUnmasked(req.auth.role);
  const values = rawValues.map((v) => ({ ...v, value: unmasked ? v.value : maskValue(v.value, v.category) }));

  res.json({ dataAsset: asset, sampleValues: values, valuesMasked: !unmasked });
});

module.exports = router;
