const prisma = require('./prisma');
const { matchWhere } = require('./piiIndex');

// Section 11's workflow: DATA SUBJECT -> IDENTIFICATION -> AI IMPACT
// DISCOVERY -> AFFECTED ASSETS -> REMEDIATION PLAN -> APPROVAL -> EXECUTION
// -> VERIFICATION -> EVIDENCE. This module implements the AI IMPACT
// DISCOVERY and REMEDIATION PLAN steps, reusing the exact same matching
// logic as "Find Me in AI" (Section 9) so a DSAR's impact analysis and a
// manual search never disagree about what Privault has indexed.

async function analyzeImpact(tenantId, dsarId, dataSubjectIdentifier) {
  const matches = await prisma.piiRecordValue.findMany({
    where: { tenantId, ...matchWhere(tenantId, dataSubjectIdentifier) },
    include: { dataAsset: { include: { aiSystem: true } } },
  });

  const records = [];
  for (const m of matches) {
    records.push({
      tenantId,
      dsarId,
      dataAssetId: m.dataAssetId,
      aiSystemId: m.dataAsset.aiSystemId || null,
      category: m.category,
      column: m.column,
    });
  }

  if (records.length) {
    await prisma.dsarImpactRecord.createMany({ data: records });
  }

  return prisma.dsarImpactRecord.findMany({
    where: { dsarId },
    include: { dataAsset: { select: { id: true, name: true } }, aiSystem: { select: { id: true, name: true } } },
  });
}

// Section 12's mapping from "where personal data was found" to "what
// remediation actions are needed" — every action this function creates is
// PENDING or REQUIRES_INTEGRATION; nothing is ever auto-marked COMPLETED.
async function generateRemediationActions(tenantId, dsarId, impactRecords) {
  const byDataAsset = new Map();
  const aiSystemIds = new Set();

  for (const r of impactRecords) {
    if (r.dataAssetId) byDataAsset.set(r.dataAssetId, r.aiSystemId || null);
    if (r.aiSystemId) aiSystemIds.add(r.aiSystemId);
  }

  const actionsToCreate = [];

  // Real, executable action: remove the matched value from Privault's own
  // detected-PII index (see routes/dsars.js executeDeleteAction).
  for (const [dataAssetId, aiSystemId] of byDataAsset.entries()) {
    actionsToCreate.push({
      tenantId, dsarId, dataAssetId, aiSystemId,
      actionType: 'DELETE',
      status: 'PENDING',
    });
  }

  if (aiSystemIds.size) {
    const systems = await prisma.aiSystem.findMany({ where: { id: { in: Array.from(aiSystemIds) } } });
    for (const sys of systems) {
      if (sys.trainingUsage || sys.fineTuningUsage) {
        actionsToCreate.push({ tenantId, dsarId, aiSystemId: sys.id, actionType: 'EXCLUDE', status: 'REQUIRES_INTEGRATION' });
        actionsToCreate.push({ tenantId, dsarId, aiSystemId: sys.id, actionType: 'RETRAIN', status: 'REQUIRES_INTEGRATION' });
      }
      if (sys.ragUsage) {
        actionsToCreate.push({ tenantId, dsarId, aiSystemId: sys.id, actionType: 'EMBEDDING_DELETE', status: 'REQUIRES_INTEGRATION' });
        actionsToCreate.push({ tenantId, dsarId, aiSystemId: sys.id, actionType: 'INDEX_REBUILD', status: 'REQUIRES_INTEGRATION' });
      }
      if (sys.automatedDecisionUsage) {
        actionsToCreate.push({ tenantId, dsarId, aiSystemId: sys.id, actionType: 'MODEL_IMPACT_REVIEW', status: 'REQUIRES_INTEGRATION' });
      }
    }
  }

  if (actionsToCreate.length) {
    await prisma.remediationAction.createMany({ data: actionsToCreate });
  }

  return prisma.remediationAction.findMany({
    where: { dsarId },
    include: {
      dataAsset: { select: { id: true, name: true } },
      aiSystem: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
    },
  });
}

// Due date for a new DSAR, from the tenant's configurable response window (Tenant.dsarResponseDays).
// A configurable operational target — not an assertion of the exact statutory period.
async function defaultDueDate(tenantId) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { dsarResponseDays: true } });
  return new Date(Date.now() + (t?.dsarResponseDays ?? 30) * 24 * 60 * 60 * 1000);
}

module.exports = { analyzeImpact, generateRemediationActions, defaultDueDate };
