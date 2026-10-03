// Section 19 — AI Risk Engine. Real factor-based scoring over fields the
// system already has (Phase 1's AiSystem, informed by what Phase 2-4 found
// about it) — never an opaque number alone. Every factor that fires is
// named in the rationale, matching Section 19's explicit rule: "Always
// explain WHY the system received its classification."

const FACTORS = [
  { key: 'personalData', weight: 2, test: (s) => (s.personalDataCategories || []).length > 0, label: 'Processes personal data' },
  { key: 'sensitiveData', weight: 3, test: (s) => (s.sensitiveDataCategories || []).length > 0, label: 'Processes sensitive data categories' },
  { key: 'automatedDecision', weight: 3, test: (s) => s.automatedDecisionUsage, label: 'Makes or supports automated decisions' },
  { key: 'noHumanOversight', weight: 3, test: (s) => s.automatedDecisionUsage && !s.humanOversight, label: 'Automated decisions with no confirmed human oversight' },
  { key: 'crossBorder', weight: 2, test: (s) => s.crossBorderProcessing, label: 'Cross-border data transfer' },
  { key: 'training', weight: 1, test: (s) => s.trainingUsage || s.fineTuningUsage, label: 'Personal data used for training/fine-tuning' },
  { key: 'rag', weight: 1, test: (s) => s.ragUsage, label: 'RAG pipeline exposes data to a model at query time' },
  { key: 'externalVendor', weight: 1, test: (s) => !!s.vendor && s.vendor.toLowerCase() !== 'in-house' && s.vendor.toLowerCase() !== 'internal', label: 'Processed by an external vendor/model provider' },
  { key: 'noDpia', weight: 2, test: (s) => s.dpiaStatus === 'REQUIRED_NOT_STARTED' || s.dpiaStatus === 'OVERDUE', label: 'Required DPIA is missing or overdue' },
  { key: 'vendorNoDpa', weight: 2, test: (s) => !!s.vendorRecord && !s.vendorRecord.dpaSigned, label: 'Linked vendor has no signed data processing agreement on record (DPDP s.8(2))' },
  // DPDP Act, 2023 Section 9 — children's data with no verified parental
  // consent path, or tracking/behavioral ads directed at children (an
  // outright prohibition, not just a risk factor, but flagged here so it
  // surfaces wherever risk is shown).
  { key: 'childrenNoSafeguard', weight: 4, test: (s) => s.processesChildrensData && s.behavioralTrackingOrAds, label: "Processes children's data AND behavioral tracking/ads — DPDP Section 9 prohibits this combination outright" },
  { key: 'childrenData', weight: 2, test: (s) => s.processesChildrensData && !s.behavioralTrackingOrAds, label: "Processes children's personal data (verifiable parental consent required)" },
  // DPDP Act, 2023 Section 16 — self-attested restricted-country transfer.
  { key: 'restrictedTransfer', weight: 3, test: (s) => s.crossBorderRestrictedCountry, label: 'Self-attested transfer to a restricted country under DPDP Section 16' },
];

function classify(score) {
  if (score >= 10) return 'CRITICAL';
  if (score >= 7) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  if (score >= 1) return 'LOW';
  return 'UNCLASSIFIED';
}

/**
 * @param {object} aiSystem — an AiSystem record
 * @returns {{ classification: string, score: number, firedFactors: {key:string,label:string,weight:number}[], rationale: string }}
 */
function assessRisk(aiSystem) {
  const fired = FACTORS.filter((f) => f.test(aiSystem));
  const score = fired.reduce((sum, f) => sum + f.weight, 0);
  const classification = classify(score);
  const rationale = fired.length
    ? fired.map((f) => `• ${f.label} (+${f.weight})`).join('\n')
    : 'No risk factors detected from current AI system data.';

  return {
    classification,
    score,
    firedFactors: fired.map((f) => ({ key: f.key, label: f.label, weight: f.weight })),
    rationale: `Computed risk score: ${score}. Factors:\n${rationale}`,
  };
}

module.exports = { assessRisk, FACTORS };
