// Section 20 — the DPIA's 17 sections, pre-filled from data the platform
// already has (Phase 1's AiSystem fields, Phase 5's risk engine) rather
// than asked for twice. Sections with no real source data are left blank
// for a human to fill in — never invented.
const { assessRisk } = require('./riskEngine');

function buildDpiaTemplate(aiSystem) {
  const risk = assessRisk(aiSystem);
  return {
    '1_description': aiSystem.description || '',
    '2_purpose': aiSystem.purpose || '',
    '3_data_subjects': aiSystem.dataSubjects || '',
    '4_data_categories': {
      personal: aiSystem.personalDataCategories || [],
      sensitive: aiSystem.sensitiveDataCategories || [],
    },
    '5_processing_activities': aiSystem.businessFunction || '',
    '6_model_information': { model: aiSystem.model, provider: aiSystem.modelProvider, version: aiSystem.modelVersion },
    '7_training_data': { trainingUsage: aiSystem.trainingUsage, fineTuningUsage: aiSystem.fineTuningUsage },
    '8_rag_data': { ragUsage: aiSystem.ragUsage },
    '9_vendors': aiSystem.vendor || '',
    '10_transfers': { crossBorderProcessing: aiSystem.crossBorderProcessing, hostingLocation: aiSystem.hostingLocation, processingLocation: aiSystem.processingLocation },
    '11_automated_decisions': { automatedDecisionUsage: aiSystem.automatedDecisionUsage },
    '12_human_oversight': { humanOversight: aiSystem.humanOversight },
    '13_risks': risk.firedFactors,
    '14_mitigations': aiSystem.securityControls || '',
    '15_residual_risk': risk.classification,
    '16_approval': '',
    '17_review_date': '',
  };
}

module.exports = { buildDpiaTemplate };
