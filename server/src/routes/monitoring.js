const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

const router = express.Router();
router.use(requireAuth);

// Section 27 — every figure here is a live count, not a cached/static
// dashboard. Nothing here is a new data model; it's read-only aggregation
// over Phases 1-7's real tables.
router.get('/', requirePermission('ai_system:read'), async (req, res) => {
  const tenantId = req.auth.tenantId;
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    newAiSystems, unauthorizedShadowAi, piiUploadsThisWeek, consentWithdrawals,
    failedRemediations, openDsars, pendingHumanReviews, openIncidents,
    dpiaOverdue, policyViolations,
    childrenSystems, childrenTrackingSystems, restrictedTransferSystems,
    unverifiedMinorConsents, breachesAwaitingNotification, overdueDsars, retentionCandidates,
    vendorsWithoutDpa, evidencePendingReview, evidenceExpired, pendingEmergencyApprovals, partiallyScannedAssets,
  ] = await Promise.all([
    prisma.aiSystem.count({ where: { tenantId, createdAt: { gte: since7d } } }),
    prisma.shadowAiEvent.count({ where: { tenantId, detectedAt: { gte: since7d }, recommendedAction: { in: ['BLOCK', 'CREATE_INCIDENT'] } } }),
    prisma.shadowAiEvent.count({ where: { tenantId, detectedAt: { gte: since7d }, piiDetected: true } }),
    prisma.consent.count({ where: { tenantId, status: 'WITHDRAWN', withdrawnAt: { gte: since7d } } }),
    prisma.remediationAction.count({ where: { tenantId, status: 'PENDING' } }),
    prisma.dsar.count({ where: { tenantId, status: { not: 'CLOSED' } } }),
    prisma.automatedDecision.count({ where: { tenantId, reviewStatus: { in: ['PENDING', 'ESCALATED'] } } }),
    prisma.incident.count({ where: { tenantId, status: { not: 'CLOSED' } } }),
    prisma.aiSystem.count({ where: { tenantId, dpiaStatus: { in: ['REQUIRED_NOT_STARTED', 'OVERDUE'] } } }),
    prisma.shadowAiEvent.count({ where: { tenantId, detectedAt: { gte: since7d }, recommendedAction: { not: 'ALLOW' } } }),
    // ---- DPDP-specific (Phase 9) ----
    prisma.aiSystem.count({ where: { tenantId, processesChildrensData: true, status: { not: 'RETIRED' } } }),
    prisma.aiSystem.count({ where: { tenantId, processesChildrensData: true, behavioralTrackingOrAds: true, status: { not: 'RETIRED' } } }),
    prisma.aiSystem.count({ where: { tenantId, crossBorderRestrictedCountry: true, status: { not: 'RETIRED' } } }),
    prisma.consent.count({ where: { tenantId, isMinorDataSubject: true, parentalConsentVerified: false, status: 'GRANTED' } }),
    prisma.incident.count({
      where: {
        tenantId, isPersonalDataBreach: true, dpbNotificationRequired: true,
        OR: [{ dpbNotifiedAt: null }, { affectedPrincipalsNotifiedAt: null }],
      },
    }),
    prisma.dsar.count({ where: { tenantId, status: { not: 'CLOSED' }, dueDate: { lt: new Date() } } }),
    // Section 8(7): candidates for erasure once retention period has elapsed.
    prisma.aiSystem.findMany({
      where: { tenantId, retentionPeriodDays: { not: null }, status: { not: 'RETIRED' } },
      select: { id: true, name: true, retentionPeriodDays: true, createdAt: true },
    }),
    prisma.vendor.count({ where: { tenantId, dpaSigned: false, aiSystems: { some: {} } } }),
    prisma.evidence.count({ where: { tenantId, reviewStatus: 'PENDING' } }),
    prisma.evidence.count({ where: { tenantId, validUntil: { lt: new Date() } } }),
    prisma.emergencyAction.count({ where: { tenantId, status: 'PENDING_APPROVAL' } }),
    prisma.dataAsset.count({ where: { tenantId, scanComplete: false } }),
  ]);

  const now = Date.now();
  const retentionOverdue = retentionCandidates
    .filter((r) => r.createdAt.getTime() + r.retentionPeriodDays * 86400000 < now)
    .map((r) => ({ id: r.id, name: r.name, retentionPeriodDays: r.retentionPeriodDays }));

  res.json({
    monitoring: {
      newAiSystemsThisWeek: newAiSystems,
      shadowAiHighSeverityThisWeek: unauthorizedShadowAi,
      piiUploadsDetectedThisWeek: piiUploadsThisWeek,
      consentWithdrawalsThisWeek: consentWithdrawals,
      pendingRemediationActions: failedRemediations,
      openDsars,
      pendingHumanReviews,
      openIncidents,
      aiSystemsMissingDpia: dpiaOverdue,
      policyViolationsThisWeek: policyViolations,
    },
    governance: {
      vendorsInUseWithoutDpa: vendorsWithoutDpa,
      evidencePendingReview,
      evidenceExpired,
      emergencyActionsAwaitingApproval: pendingEmergencyApprovals,
      dataAssetsPartiallyScanned: partiallyScannedAssets,
    },
    dpdp: {
      aiSystemsProcessingChildrensData: childrenSystems,
      childrensDataWithBehavioralTrackingOrAds: childrenTrackingSystems,
      restrictedCountryTransferSystems: restrictedTransferSystems,
      grantedMinorConsentsWithoutParentalVerification: unverifiedMinorConsents,
      personalDataBreachesAwaitingNotification: breachesAwaitingNotification,
      overdueDsars,
      retentionElapsedAiSystems: retentionOverdue,
      retentionNote: 'Retention is measured from the AI system record\'s creation date using its structured retention period — a prompt to review erasure under DPDP Section 8(7), not proof that data is still held or must be erased (legal-hold exceptions apply).',
    },
  });
});

module.exports = router;
