const crypto = require('crypto');
const prisma = () => require('./prisma'); // lazy: the pure functions below are unit-testable without a database

// Tamper-evident audit log. Every entry stores the SHA-256 of its own content chained to the previous
// entry of the same tenant (a hash chain). Editing or removing any earlier entry breaks every later hash,
// and `verifyChain` finds where. Together with the database-level append-only trigger this gives two
// independent layers: the trigger stops casual tampering, the chain reveals tampering by anyone able to
// bypass the trigger (e.g. a superuser).
//
// Honest limits: the chain cannot detect that the *most recent* entries were removed unless the head hash
// has been recorded somewhere outside this database (see /audit-logs/head) — anchor it periodically
// (email, WORM storage, a ticket). Entries written before chaining existed are reported, not verified.
const GENESIS = '0'.repeat(64);

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
const normJson = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

function computeHash(e) {
  const body = {
    seq: e.seq, prevHash: e.prevHash, tenantId: e.tenantId, userId: e.userId ?? null, role: e.role ?? null,
    action: e.action, objectType: e.objectType, objectId: e.objectId ?? null,
    previousValue: normJson(e.previousValue), newValue: normJson(e.newValue),
    source: e.source ?? 'app', reason: e.reason ?? null, ipAddress: e.ipAddress ?? null,
    timestamp: new Date(e.timestamp).toISOString(),
  };
  return crypto.createHash('sha256').update(canonical(body)).digest('hex');
}

/** Checks one row against the running state; returns a failure object or null. Mutates `state` on success. */
function checkRow(state, r) {
  if (r.seq !== state.expectedSeq) {
    return { brokenAtSeq: state.expectedSeq, reason: r.seq > state.expectedSeq ? 'An entry is missing (gap in the sequence)' : 'Duplicate or out-of-order sequence number' };
  }
  if (r.prevHash !== state.prev) return { brokenAtSeq: r.seq, reason: 'The chain link does not match the previous entry' };
  if (computeHash(r) !== r.hash) return { brokenAtSeq: r.seq, reason: 'The entry content does not match its hash (it was modified)' };
  state.prev = r.hash;
  state.expectedSeq += 1;
  state.checked += 1;
  return null;
}

// PostgreSQL uses an advisory transaction lock to serialize audit-chain writers.
// SQLite does not provide pg_advisory_xact_lock/hashtext, so local development uses
// a small in-process per-tenant mutex. SQLite itself serializes the actual write, and
// the mutex prevents two requests in this Node process from reading the same chain head.
const auditLocks = new Map();

async function withTenantLock(tenantId, fn) {
  const previous = auditLocks.get(tenantId) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  auditLocks.set(tenantId, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (auditLocks.get(tenantId) === current) auditLocks.delete(tenantId);
  }
}

async function appendAudit(entry) {
  const p = prisma();
  const timestamp = new Date();
  const previousValue = normJson(entry.previousValue);
  const newValue = normJson(entry.newValue);

  const row = await withTenantLock(entry.tenantId, () => p.$transaction(async (tx) => {
    // PostgreSQL keeps the database-level advisory lock. SQLite development uses
    // the per-tenant in-process mutex above because pg_advisory_xact_lock/hashtext
    // are PostgreSQL-only functions.
    if (!String(process.env.DATABASE_URL || '').startsWith('file:')) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${entry.tenantId}))`;
    }
    const last = await tx.auditLog.findFirst({ where: { tenantId: entry.tenantId, seq: { not: null } }, orderBy: { seq: 'desc' }, select: { seq: true, hash: true } });
    const seq = (last?.seq ?? 0) + 1;
    const prevHash = last?.hash ?? GENESIS;
    const data = {
      tenantId: entry.tenantId, userId: entry.userId ?? null, role: entry.role ?? null,
      action: entry.action, objectType: entry.objectType, objectId: entry.objectId ?? null,
      source: entry.source ?? 'app', reason: entry.reason ?? null, ipAddress: entry.ipAddress ?? null,
      timestamp, seq, prevHash,
    };
    if (previousValue !== null) data.previousValue = previousValue;
    if (newValue !== null) data.newValue = newValue;
    data.hash = computeHash({ ...data, previousValue, newValue });
    return tx.auditLog.create({ data });
  }));

  // Every audited action is also a deliverable event. Fire and forget: a slow subscriber must never fail the request.
  require('./webhooks').dispatchEvent(entry.tenantId, entry.action, {
    auditLogId: row.id, objectType: entry.objectType, objectId: entry.objectId ?? null, actorRole: entry.role ?? null, occurredAt: row.timestamp,
  }).catch(() => {});
  return row;
}

async function verifyChain(tenantId) {
  const p = prisma();
  const state = { expectedSeq: 1, prev: GENESIS, checked: 0 };
  let cursor = 0;
  for (;;) {
    const rows = await p.auditLog.findMany({ where: { tenantId, seq: { gt: cursor } }, orderBy: { seq: 'asc' }, take: 1000 });
    if (!rows.length) break;
    for (const r of rows) {
      const bad = checkRow(state, r);
      if (bad) return { ok: false, checked: state.checked, ...bad };
      cursor = r.seq;
    }
  }
  const legacy = await p.auditLog.count({ where: { tenantId, seq: null } });
  return { ok: true, checked: state.checked, head: { seq: state.expectedSeq - 1, hash: state.prev }, legacyUnchainedEntries: legacy };
}

module.exports = { GENESIS, canonical, computeHash, checkRow, appendAudit, verifyChain };
