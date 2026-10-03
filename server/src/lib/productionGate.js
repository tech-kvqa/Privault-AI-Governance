// Master spec Section 51: "WHEN an AI system processes personal data AND has an external provider AND has no
// approved DPIA THEN block production approval." This is that rule set, as code: it decides whether an AI
// system may move into APPROVED / PRODUCTION. Blockers stop the transition (a SUPER_ADMIN can override with a
// written, audited reason); warnings are shown but never block.
const GATED_STATUSES = ['APPROVED', 'PRODUCTION'];

function evaluateProductionGate(system, { approvedDpia = false, vendor = null } = {}) {
  const blockers = [];
  const warnings = [];
  const hasPersonal = (system.personalDataCategories || []).length > 0 || (system.sensitiveDataCategories || []).length > 0;
  const needsDpia = hasPersonal || !!system.automatedDecisionUsage || !!system.processesChildrensData;

  if (needsDpia && !approvedDpia) {
    blockers.push({ code: 'DPIA_NOT_APPROVED', message: "This system processes personal data, makes automated decisions or handles children's data, but has no approved DPIA." });
  }
  if (system.automatedDecisionUsage && !system.humanOversight) {
    blockers.push({ code: 'NO_HUMAN_OVERSIGHT', message: 'It makes automated decisions with no human oversight recorded.' });
  }
  if (system.processesChildrensData && system.behavioralTrackingOrAds) {
    blockers.push({ code: 'CHILDREN_TRACKING', message: "DPDP s.9 prohibits behavioural tracking and targeted advertising directed at children." });
  }
  if (vendor && !vendor.dpaSigned && hasPersonal) {
    blockers.push({ code: 'VENDOR_NO_DPA', message: `Its vendor (${vendor.name}) has no signed data processing agreement on record (DPDP s.8(2)).` });
  }
  if (system.crossBorderRestrictedCountry) {
    blockers.push({ code: 'RESTRICTED_TRANSFER', message: 'It is attested as transferring personal data to a restricted country (DPDP s.16).' });
  }

  if (!system.lastAssessmentAt) warnings.push({ code: 'RISK_NOT_ASSESSED', message: 'Risk has not been assessed yet.' });
  if (hasPersonal && (system.retentionPeriodDays === null || system.retentionPeriodDays === undefined)) {
    warnings.push({ code: 'NO_RETENTION_PERIOD', message: 'No retention period is recorded (needed to review erasure under DPDP s.8(7)).' });
  }
  return { allowed: blockers.length === 0, blockers, warnings };
}

module.exports = { evaluateProductionGate, GATED_STATUSES };
