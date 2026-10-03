const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { writeAudit } = require('../middleware/audit');
const { encryptSecret, decryptSecret } = require('../lib/secrets');
const { testConnection, scanDatabase, DEFAULT_SAMPLE_ROWS, MAX_SAMPLE_ROWS } = require('../lib/pgScanner');
const { detectPii } = require('../lib/piiDetect');
const { hashValue } = require('../lib/piiIndex');

const router = express.Router();
router.use(requireAuth);

// Section 37 / Section 25: only connector types with a real integration behind
// them can ever become CONNECTED. FILE_UPLOAD (Mode C) and PostgreSQL
// (Mode A, this phase) are real; every other type stays NOT_CONFIGURED.
// A PostgreSQL connector also stays NOT_CONFIGURED until a real connection test
// succeeds — nothing is marked CONNECTED on trust.
const isPostgres = (c) => c.type === 'DATABASE' && c.config?.engine === 'postgres';

// Credentials are never selected into any response.
const PUBLIC = {
  id: true, name: true, type: true, status: true, config: true,
  lastTestedAt: true, lastTestOk: true, lastError: true, createdAt: true, updatedAt: true,
  _count: { select: { runs: true } },
};

const pgConfig = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1).max(63),
  user: z.string().min(1).max(63),
  password: z.string().min(1).max(200),
  sslmode: z.enum(['disable', 'require', 'verify-full']).default('require'),
  schemas: z.array(z.string().min(1).max(63)).max(50).optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['FILE_UPLOAD', 'DATABASE', 'CLOUD_STORAGE', 'VECTOR_DB', 'SAAS_API']),
  config: z.any().optional(),
});

router.get('/', requirePermission('connector:read'), async (req, res) => {
  const connectors = await prisma.connector.findMany({
    where: { tenantId: req.auth.tenantId }, orderBy: { createdAt: 'desc' }, select: PUBLIC,
  });
  res.json({ connectors });
});

router.post('/', requirePermission('connector:create'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const { name, type } = parsed.data;

  let config = null;
  let credentialsEncrypted = null;
  if (type === 'DATABASE') {
    const pg = pgConfig.safeParse(parsed.data.config);
    if (!pg.success) return res.status(400).json({ error: 'A PostgreSQL connection config is required (host, port, database, user, password, sslmode)', details: pg.error.flatten() });
    const { password, ...rest } = pg.data;
    config = { engine: 'postgres', ...rest };
    credentialsEncrypted = encryptSecret(password);
  }

  // FILE_UPLOAD is usable immediately; everything else must earn CONNECTED.
  const status = type === 'FILE_UPLOAD' ? 'CONNECTED' : 'NOT_CONFIGURED';
  const connector = await prisma.connector.create({
    data: { tenantId: req.auth.tenantId, name, type, status, config, credentialsEncrypted, createdById: req.auth.userId },
    select: PUBLIC,
  });
  await writeAudit({ req, action: 'CONNECTOR_CREATED', objectType: 'Connector', objectId: connector.id, newValue: { name, type, config } });

  let note;
  if (type === 'DATABASE') note = 'Created. It stays NOT_CONFIGURED until a connection test succeeds.';
  else if (status === 'NOT_CONFIGURED') note = 'CONTROL AVAILABLE — INTEGRATION REQUIRED. This connector type has no live integration in this deployment.';
  res.status(201).json({ connector, note });
});

async function loadPg(req, res) {
  const c = await prisma.connector.findFirst({ where: { id: req.params.id, tenantId: req.auth.tenantId } });
  if (!c) { res.status(404).json({ error: 'Connector not found' }); return null; }
  if (!isPostgres(c)) { res.status(400).json({ error: 'Only PostgreSQL database connectors can be tested or scanned in this deployment' }); return null; }
  return c;
}
const cfgOf = (c) => ({ ...c.config, password: decryptSecret(c.credentialsEncrypted) });

router.post('/:id/test', requirePermission('connector:create'), async (req, res) => {
  const c = await loadPg(req, res);
  if (!c) return;
  try {
    const info = await testConnection(cfgOf(c));
    await prisma.connector.update({ where: { id: c.id }, data: { status: 'CONNECTED', lastTestedAt: new Date(), lastTestOk: true, lastError: null } });
    await writeAudit({ req, action: 'CONNECTOR_TESTED', objectType: 'Connector', objectId: c.id, newValue: { ok: true } });
    res.json({ ok: true, info });
  } catch (e) {
    const error = e.userMessage || 'Connection test failed';
    await prisma.connector.update({ where: { id: c.id }, data: { status: 'NOT_CONFIGURED', lastTestedAt: new Date(), lastTestOk: false, lastError: error } });
    await writeAudit({ req, action: 'CONNECTOR_TESTED', objectType: 'Connector', objectId: c.id, newValue: { ok: false, error } });
    res.json({ ok: false, error });
  }
});

// Password rotation (Section 38). Forces a fresh connection test.
router.put('/:id/credentials', requirePermission('connector:create'), async (req, res) => {
  const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A new password is required' });
  const c = await loadPg(req, res);
  if (!c) return;
  await prisma.connector.update({ where: { id: c.id }, data: { credentialsEncrypted: encryptSecret(parsed.data.password), status: 'NOT_CONFIGURED', lastTestOk: null, lastError: null } });
  await writeAudit({ req, action: 'CONNECTOR_CREDENTIALS_ROTATED', objectType: 'Connector', objectId: c.id });
  res.json({ ok: true, note: 'Credentials replaced. Run a connection test before scanning.' });
});

const scanSchema = z.object({
  aiSystemId: z.string().uuid().optional(),
  relationship: z.enum(['FEEDS', 'TRAINED_ON', 'USED_IN_RAG']).optional(),
  sampleRows: z.number().int().min(1).max(MAX_SAMPLE_ROWS).optional(),
  schemas: z.array(z.string().min(1).max(63)).max(50).optional(),
});

const STALE_RUN_MS = 15 * 60 * 1000;

router.post('/:id/scan', requirePermission('connector:scan'), async (req, res) => {
  const parsed = scanSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const opts = parsed.data;
  const tenantId = req.auth.tenantId;

  const c = await loadPg(req, res);
  if (!c) return;
  if (c.status !== 'CONNECTED') return res.status(400).json({ error: 'Run a successful connection test before scanning' });
  if (opts.aiSystemId && !(await prisma.aiSystem.findFirst({ where: { id: opts.aiSystemId, tenantId } }))) {
    return res.status(404).json({ error: 'AI system not found' });
  }

  const running = await prisma.connectorRun.findFirst({ where: { connectorId: c.id, tenantId, status: 'RUNNING' } });
  if (running && Date.now() - new Date(running.startedAt).getTime() < STALE_RUN_MS) {
    return res.status(409).json({ error: 'A scan of this connector is already running' });
  }

  const run = await prisma.connectorRun.create({ data: { tenantId, connectorId: c.id, status: 'RUNNING', startedAt: new Date() } });
  const summary = { tables: [], errors: [], recordsScanned: 0, findingsCount: 0 };

  try {
    const meta = await scanDatabase(
      cfgOf(c),
      { schemas: opts.schemas || c.config.schemas || [], sampleRows: opts.sampleRows || DEFAULT_SAMPLE_ROWS },
      async (t) => {
        const name = `${t.schema}.${t.table}`;
        if (t.error) { summary.errors.push({ table: name, error: t.error }); return; }

        const { findings, values, rowsScanned, complete: piiComplete } = detectPii(t.columns, t.rows);
        // Complete only if we reached the end of the table AND nothing was truncated in indexing.
        const complete = t.reachedEnd && piiComplete;
        const sourceRef = `postgres:${c.id}:${name}`;
        const fields = {
          name, mimeType: 'application/x-postgres-table', rowCount: t.estimatedRows, columnCount: t.columns.length,
          rowsScanned: t.rowsFetched, scanComplete: complete, indexedAsHash: true, dataSourceType: 'CONNECTOR',
          status: 'SCANNED', scannedAt: new Date(), connectorRunId: run.id, aiSystemId: opts.aiSystemId || null,
        };

        // Re-scan replaces the previous index for this table in place (stable asset id,
        // so DSAR / lineage references stay valid).
        let asset = await prisma.dataAsset.findFirst({ where: { tenantId, sourceRef } });
        if (asset) {
          asset = await prisma.dataAsset.update({ where: { id: asset.id }, data: fields });
          await prisma.piiFinding.deleteMany({ where: { tenantId, dataAssetId: asset.id } });
          await prisma.piiRecordValue.deleteMany({ where: { tenantId, dataAssetId: asset.id } });
        } else {
          asset = await prisma.dataAsset.create({ data: { ...fields, tenantId, sourceRef, createdById: req.auth.userId } });
        }
        if (findings.length) await prisma.piiFinding.createMany({ data: findings.map((f) => ({ ...f, tenantId, dataAssetId: asset.id })) });
        if (values.length) {
          // Personal data read from the customer's database is stored only as keyed hashes.
          await prisma.piiRecordValue.createMany({ data: values.map((v) => ({ ...v, value: hashValue(tenantId, v.value), tenantId, dataAssetId: asset.id })) });
        }

        // Lineage: only tables that actually hold personal data are linked to the AI system.
        if (opts.aiSystemId && findings.length) {
          const relationship = opts.relationship || 'FEEDS';
          await prisma.lineageEdge.upsert({
            where: { tenantId_sourceType_sourceId_targetType_targetId_relationship: { tenantId, sourceType: 'DATA_ASSET', sourceId: asset.id, targetType: 'AI_SYSTEM', targetId: opts.aiSystemId, relationship } },
            update: {},
            create: { tenantId, sourceType: 'DATA_ASSET', sourceId: asset.id, targetType: 'AI_SYSTEM', targetId: opts.aiSystemId, relationship },
          });
        }

        summary.recordsScanned += rowsScanned;
        summary.findingsCount += findings.length;
        summary.tables.push({
          name, rowsScanned: t.rowsFetched, estimatedRows: t.estimatedRows, complete,
          piiCategories: [...new Set(findings.map((f) => f.category))],
        });
      }
    );

    await prisma.connectorRun.update({ where: { id: run.id }, data: { status: 'SUCCESS', finishedAt: new Date(), recordsScanned: summary.recordsScanned, findingsCount: summary.findingsCount } });
    const complete = summary.tables.filter((t) => t.complete).length;
    await writeAudit({ req, action: 'CONNECTOR_SCAN_COMPLETED', objectType: 'Connector', objectId: c.id, newValue: { tablesScanned: summary.tables.length, complete, findings: summary.findingsCount, errors: summary.errors.length } });

    res.json({
      runId: run.id, ...meta, tablesComplete: complete, tablesIncomplete: summary.tables.length - complete,
      tablesWithPii: summary.tables.filter((t) => t.piiCategories.length).length,
      findingsCount: summary.findingsCount, errors: summary.errors, tables: summary.tables,
      note: 'Tables marked incomplete were only sampled (first rows). Find Me in AI will never report "Not found" based on an incomplete scan — only "Unknown". Personal-data values are stored as keyed hashes, not in clear.',
    });
  } catch (e) {
    await prisma.connectorRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: e.userMessage || 'Scan failed' } });
    res.status(e.status || 502).json({ error: e.userMessage || 'Scan failed' });
  }
});

module.exports = router;
