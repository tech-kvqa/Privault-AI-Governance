const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

const router = express.Router();
router.use(requireAuth);

// Section 30 — dashboard KPIs. Every figure is a live count from the database.
router.get('/kpis', requirePermission('ai_system:read'), async (req, res) => {
  const tenantId = req.auth.tenantId;
  const [
    total, production, highRisk, noDpia, noHumanOversight, processingPersonalData,
    shadowAiEvents, openAiDsars, pendingHumanReviews, aiPrivacyIncidents,
  ] = await Promise.all([
    prisma.aiSystem.count({ where: { tenantId } }),
    prisma.aiSystem.count({ where: { tenantId, status: 'PRODUCTION' } }),
    prisma.aiSystem.count({ where: { tenantId, riskClassification: { in: ['HIGH', 'CRITICAL'] } } }),
    prisma.aiSystem.count({ where: { tenantId, dpiaStatus: { in: ['REQUIRED_NOT_STARTED', 'OVERDUE'] } } }),
    prisma.aiSystem.count({ where: { tenantId, automatedDecisionUsage: true, humanOversight: false } }),
    prisma.aiSystem.findMany({ where: { tenantId }, select: { personalDataCategories: true } }),
    prisma.shadowAiEvent.count({ where: { tenantId } }),
    prisma.dsar.count({ where: { tenantId, status: { not: 'CLOSED' } } }),
    prisma.automatedDecision.count({ where: { tenantId, reviewStatus: { in: ['PENDING', 'ESCALATED'] } } }),
    prisma.incident.count({ where: { tenantId, status: { not: 'CLOSED' } } }),
  ]);

  const processingPersonalDataCount = processingPersonalData.filter((s) => Array.isArray(s.personalDataCategories) && s.personalDataCategories.length > 0).length;

  res.json({
    kpis: {
      aiSystems: total,
      aiSystemsInProduction: production,
      aiSystemsProcessingPersonalData: processingPersonalDataCount,
      highRiskAiSystems: highRisk,
      aiSystemsMissingRequiredDpia: noDpia,
      automatedDecisionSystemsWithoutHumanOversight: noHumanOversight,
      shadowAiEvents,
      openAiDsars,
      pendingHumanReviews,
      aiPrivacyIncidents,
    },
  });
});

module.exports = router;
