const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { parseUpload } = require('../lib/fileParse');
const { detectPii } = require('../lib/piiDetect');
const { chunkText, chunkRows } = require('../lib/chunkText');

const router = express.Router();
router.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const kbSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  aiSystemId: z.string().uuid().nullish(),
});

router.get('/knowledge-bases', requirePermission('rag:read'), async (req, res) => {
  const kbs = await prisma.knowledgeBase.findMany({
    where: { tenantId: req.auth.tenantId },
    orderBy: { createdAt: 'desc' },
    include: { aiSystem: { select: { id: true, name: true } }, _count: { select: { documents: true } } },
  });
  res.json({ knowledgeBases: kbs });
});

router.post('/knowledge-bases', requirePermission('rag:create'), async (req, res) => {
  const parsed = kbSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });

  const kb = await prisma.knowledgeBase.create({
    data: { ...parsed.data, tenantId: req.auth.tenantId, createdById: req.auth.userId },
  });
  await writeAudit({ req, action: 'KNOWLEDGE_BASE_CREATED', objectType: 'KnowledgeBase', objectId: kb.id, newValue: kb });
  res.status(201).json({ knowledgeBase: kb });
});

router.get('/knowledge-bases/:id', requirePermission('rag:read'), async (req, res) => {
  const kb = await prisma.knowledgeBase.findFirst({
    where: { id: req.params.id, tenantId: req.auth.tenantId },
    include: {
      aiSystem: { select: { id: true, name: true } },
      documents: { include: { dataAsset: { select: { id: true, name: true, findings: true } } } },
    },
  });
  if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
  res.json({ knowledgeBase: kb });
});

// Ingest a document: parse it (Phase 2's parser), scan it for PII (Phase
// 2's engine — a knowledge base can leak personal data just like any other
// data asset), and chunk it for real (Section 14's "Documents -> Chunking"
// step). Embeddings stay NOT_CONFIGURED — see schema comment.
router.post('/knowledge-bases/:id/documents', requirePermission('rag:create'), upload.single('file'), async (req, res) => {
  const kb = await prisma.knowledgeBase.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!kb) return res.status(404).json({ error: 'Knowledge base not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });

  const isTextFile = /\.(txt|md)$/i.test(req.file.originalname) || req.file.mimetype === 'text/plain';
  let dataAsset, chunkContents;

  if (isTextFile) {
    const text = req.file.buffer.toString('utf8');
    chunkContents = chunkText(text);
    dataAsset = await prisma.dataAsset.create({
      data: {
        tenantId: req.auth.tenantId,
        name: req.file.originalname,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        rowCount: null,
        columnCount: null,
        status: 'SCANNED',
        scannedAt: new Date(),
        createdById: req.auth.userId,
      },
    });
    // No column/row structure to run the PII engine's regex-per-column logic
    // against for plain text — Phase 5+ would add NLP-based entity detection
    // for free text. Flag this honestly rather than silently skipping it.
  } else {
    let parsedFile;
    try {
      parsedFile = parseUpload(req.file.buffer, req.file.mimetype, req.file.originalname);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const { headers, rows } = parsedFile;
    const { findings, values, rowsScanned: piiRows, complete: piiComplete } = detectPii(headers, rows);
    chunkContents = chunkRows(rows);

    dataAsset = await prisma.dataAsset.create({
      data: {
        tenantId: req.auth.tenantId,
        name: req.file.originalname,
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        rowCount: rows.length,
        columnCount: headers.length,
        scanComplete: piiComplete,
        rowsScanned: piiRows,
        status: 'SCANNED',
        scannedAt: new Date(),
        createdById: req.auth.userId,
      },
    });
    if (findings.length) {
      await prisma.piiFinding.createMany({ data: findings.map((f) => ({ ...f, tenantId: req.auth.tenantId, dataAssetId: dataAsset.id })) });
    }
    if (values.length) {
      await prisma.piiRecordValue.createMany({ data: values.map((v) => ({ ...v, tenantId: req.auth.tenantId, dataAssetId: dataAsset.id })) });
    }
  }

  const doc = await prisma.knowledgeBaseDocument.create({
    data: {
      tenantId: req.auth.tenantId,
      knowledgeBaseId: kb.id,
      dataAssetId: dataAsset.id,
      chunkCount: chunkContents.length,
      chunkedAt: new Date(),
      createdById: req.auth.userId,
    },
  });

  await prisma.documentChunk.createMany({
    data: chunkContents.map((content, i) => ({
      tenantId: req.auth.tenantId,
      documentId: doc.id,
      chunkIndex: i,
      content,
      charCount: content.length,
      embeddingStatus: 'NOT_CONFIGURED',
    })),
  });

  await writeAudit({
    req,
    action: 'RAG_DOCUMENT_INGESTED',
    objectType: 'KnowledgeBaseDocument',
    objectId: doc.id,
    newValue: { fileName: req.file.originalname, chunkCount: chunkContents.length },
  });

  res.status(201).json({
    document: doc,
    dataAssetId: dataAsset.id,
    chunkCount: chunkContents.length,
    embeddingNote: 'Chunks created. Embedding generation is not run — no vector store is configured for this knowledge base.',
  });
});

router.get('/knowledge-bases/:id/documents/:docId/chunks', requirePermission('rag:read'), async (req, res) => {
  const doc = await prisma.knowledgeBaseDocument.findFirst({
    where: { id: req.params.docId, knowledgeBaseId: req.params.id, tenantId: req.auth.tenantId },
  });
  if (!doc) return res.status(404).json({ error: 'Document not found' });

  const chunks = await prisma.documentChunk.findMany({
    where: { documentId: doc.id },
    orderBy: { chunkIndex: 'asc' },
  });
  res.json({ chunks });
});

module.exports = router;
