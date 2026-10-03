// Section 57 — Demo Mode. This data is clearly synthetic (ABC Bank) and is
// only ever created by this script, never presented as if it came from a
// live connector/scan (dataSourceType on every AiSystem row is left at its
// default, USER_ENTERED).
const bcrypt = require('bcryptjs');

const prisma = require('../src/lib/prisma');
const { appendAudit } = require('../src/lib/auditChain');
const { hashToken, newToken, newReference } = require('../src/lib/tokens');

const DEMO_PASSWORD = 'Demo@1234';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { slug: 'abc-bank' },
    create: { id: '00000000-0000-0000-0000-000000000001', name: 'ABC Bank', slug: 'abc-bank' },
  });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const usersToCreate = [
    { email: 'admin@abcbank.demo', name: 'Sana Admin', role: 'SUPER_ADMIN' },
    { email: 'governance@abcbank.demo', name: 'Rahul Mehta', role: 'AI_GOVERNANCE_ADMIN' },
    { email: 'privacy@abcbank.demo', name: 'Priya Nair', role: 'PRIVACY_OFFICER' },
    { email: 'dpo@abcbank.demo', name: 'Arjun Shah', role: 'DPO' },
    { email: 'owner@abcbank.demo', name: 'Kabir Singh', role: 'AI_SYSTEM_OWNER' },
    { email: 'auditor@abcbank.demo', name: 'Neha Kulkarni', role: 'AUDITOR' },
    { email: 'security@abcbank.demo', name: 'Imran Sheikh', role: 'SECURITY_ADMIN' },
    { email: 'reviewer@abcbank.demo', name: 'Farah Khan', role: 'HUMAN_REVIEWER' },
    { email: 'readonly@abcbank.demo', name: 'Vikram Rao', role: 'READ_ONLY' },
  ];

  const users = {};
  for (const u of usersToCreate) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: { tenantId: tenant.id, email: u.email, name: u.name, role: u.role, passwordHash },
    });
    users[u.email] = user;
  }

  const governanceOwnerId = users['governance@abcbank.demo'].id;

  const aiSystems = [
    {
      name: 'Loan Decision Engine',
      description: 'Scores and approves/declines consumer loan applications.',
      businessOwner: 'Retail Lending',
      technicalOwner: 'ML Platform Team',
      privacyOwner: 'Priya Nair',
      vendor: 'In-house',
      model: 'abc-credit-scoring-v3',
      modelProvider: 'Internal',
      modelVersion: '3.2.1',
      deploymentEnvironment: 'Production',
      hostingLocation: 'AWS ap-south-1',
      processingLocation: 'India',
      purpose: 'Automated credit risk scoring and loan approval',
      businessFunction: 'Retail Lending',
      userPopulation: 'Retail loan applicants',
      dataSubjects: 'Customers',
      personalDataCategories: ['Name', 'Income', 'Employment history', 'Credit history', 'Bank account'],
      sensitiveDataCategories: ['Financial data'],
      trainingUsage: true,
      fineTuningUsage: true,
      ragUsage: false,
      automatedDecisionUsage: true,
      humanOversight: true,
      crossBorderProcessing: false,
      retention: '7 years (regulatory)',
      dpiaStatus: 'COMPLETED',
      riskClassification: 'HIGH',
      riskRationale: 'High-impact automated decision affecting credit access; sensitive financial data; regulated domain.',
      securityControls: 'Encryption at rest, RBAC, model access logging',
      status: 'PRODUCTION',
      approvalStatus: 'Approved',
    },
    {
      name: 'Fraud Detection AI',
      description: 'Real-time transaction fraud scoring.',
      businessOwner: 'Fraud & Risk',
      technicalOwner: 'Risk Engineering',
      privacyOwner: 'Priya Nair',
      vendor: 'In-house',
      model: 'abc-fraud-net',
      modelProvider: 'Internal',
      modelVersion: '5.0',
      deploymentEnvironment: 'Production',
      hostingLocation: 'AWS ap-south-1',
      processingLocation: 'India',
      purpose: 'Detect anomalous/fraudulent transactions in real time',
      businessFunction: 'Fraud & Risk',
      userPopulation: 'All account holders',
      dataSubjects: 'Customers',
      personalDataCategories: ['Transaction data', 'Device ID', 'Location', 'IP address'],
      sensitiveDataCategories: ['Financial data', 'Location data'],
      trainingUsage: true,
      fineTuningUsage: false,
      ragUsage: false,
      automatedDecisionUsage: true,
      humanOversight: true,
      crossBorderProcessing: false,
      retention: '5 years',
      dpiaStatus: 'COMPLETED',
      riskClassification: 'HIGH',
      riskRationale: 'Automated decisions can block/hold customer funds; processes behavioral + location data at scale.',
      securityControls: 'Encryption at rest, anomaly monitoring, RBAC',
      status: 'PRODUCTION',
      approvalStatus: 'Approved',
    },
    {
      name: 'Customer Support Copilot',
      description: 'LLM assistant for support agents, grounded on internal KB via RAG.',
      businessOwner: 'Customer Service',
      technicalOwner: 'AI Platform Team',
      privacyOwner: 'Priya Nair',
      vendor: 'Anthropic',
      model: 'Claude',
      modelProvider: 'Anthropic',
      modelVersion: 'N/A',
      deploymentEnvironment: 'Production',
      hostingLocation: 'Vendor-hosted (API)',
      processingLocation: 'Multiple / vendor-dependent',
      purpose: 'Assist support agents with drafting responses and looking up policy',
      businessFunction: 'Customer Service',
      userPopulation: 'Internal support agents',
      dataSubjects: 'Customers (referenced in tickets)',
      personalDataCategories: ['Name', 'Email', 'Phone', 'Account ID'],
      sensitiveDataCategories: [],
      trainingUsage: false,
      fineTuningUsage: false,
      ragUsage: true,
      automatedDecisionUsage: false,
      humanOversight: true,
      crossBorderProcessing: true,
      retention: '90 days (chat logs)',
      dpiaStatus: 'IN_PROGRESS',
      riskClassification: 'MEDIUM',
      riskRationale: 'No automated decisions, but RAG pipeline surfaces customer PII from support tickets to a third-party model API.',
      securityControls: 'Vendor DPA, prompt redaction (partial), access logging',
      status: 'PRODUCTION',
      approvalStatus: 'Approved',
    },
    {
      name: 'HR Screening AI',
      description: 'Resume screening and candidate ranking for recruitment.',
      businessOwner: 'Human Resources',
      technicalOwner: 'HR Tech',
      privacyOwner: 'Arjun Shah',
      vendor: 'ThirdPartyATS Inc.',
      model: 'ATS-Ranker',
      modelProvider: 'ThirdPartyATS Inc.',
      modelVersion: '2.4',
      deploymentEnvironment: 'Production',
      hostingLocation: 'Vendor cloud (EU)',
      processingLocation: 'EU + India',
      purpose: 'Rank job applicants by fit score',
      businessFunction: 'Human Resources',
      userPopulation: 'Job applicants',
      dataSubjects: 'Job applicants',
      personalDataCategories: ['Name', 'Resume content', 'Education history', 'Employment history'],
      sensitiveDataCategories: [],
      trainingUsage: false,
      fineTuningUsage: false,
      ragUsage: false,
      automatedDecisionUsage: true,
      humanOversight: false,
      crossBorderProcessing: true,
      retention: '2 years',
      dpiaStatus: 'REQUIRED_NOT_STARTED',
      riskClassification: 'HIGH',
      riskRationale: 'High-impact automated decision (employment) with no confirmed human oversight step; cross-border transfer to vendor; DPIA outstanding.',
      securityControls: 'Vendor security review pending',
      status: 'ASSESSMENT',
      approvalStatus: 'Pending Approval',
    },
    {
      name: 'Internal Knowledge Assistant',
      description: 'RAG assistant over internal policy and compliance documents.',
      businessOwner: 'Compliance',
      technicalOwner: 'AI Platform Team',
      privacyOwner: 'Priya Nair',
      vendor: 'In-house',
      model: 'abc-kb-assistant',
      modelProvider: 'Internal (open-weight)',
      modelVersion: '1.1',
      deploymentEnvironment: 'Production',
      hostingLocation: 'On-premise',
      processingLocation: 'India',
      purpose: 'Answer employee questions from internal policy documents',
      businessFunction: 'Compliance',
      userPopulation: 'All employees',
      dataSubjects: 'Employees (incidentally, via referenced case files)',
      personalDataCategories: ['Employee ID'],
      sensitiveDataCategories: [],
      trainingUsage: false,
      fineTuningUsage: false,
      ragUsage: true,
      automatedDecisionUsage: false,
      humanOversight: true,
      crossBorderProcessing: false,
      retention: 'Indefinite (internal KB)',
      dpiaStatus: 'NOT_REQUIRED',
      riskClassification: 'LOW',
      riskRationale: 'Internal-only, no automated decisions, minimal personal data exposure.',
      securityControls: 'SSO-gated access, on-prem hosting',
      status: 'PRODUCTION',
      approvalStatus: 'Approved',
    },
    {
      name: 'Customer Recommendation Engine',
      description: 'Recommends financial products based on customer profile.',
      businessOwner: 'Marketing',
      technicalOwner: 'Data Science',
      privacyOwner: 'Priya Nair',
      vendor: 'In-house',
      model: 'abc-recommender',
      modelProvider: 'Internal',
      modelVersion: '2.0',
      deploymentEnvironment: 'Staging',
      hostingLocation: 'AWS ap-south-1',
      processingLocation: 'India',
      purpose: 'Personalized product recommendations',
      businessFunction: 'Marketing',
      userPopulation: 'Retail customers',
      dataSubjects: 'Customers',
      personalDataCategories: ['Transaction history', 'Product holdings', 'Demographic data'],
      sensitiveDataCategories: [],
      trainingUsage: true,
      fineTuningUsage: false,
      ragUsage: false,
      automatedDecisionUsage: false,
      humanOversight: true,
      crossBorderProcessing: false,
      retention: '3 years',
      dpiaStatus: 'NOT_REQUIRED',
      riskClassification: 'LOW',
      riskRationale: 'Recommendations only, no automated decision with legal/similarly significant effect.',
      securityControls: 'Encryption at rest, RBAC',
      status: 'ASSESSMENT',
      approvalStatus: 'Not submitted',
    },
  ];

  for (const sys of aiSystems) {
    const existing = await prisma.aiSystem.findFirst({ where: { tenantId: tenant.id, name: sys.name } });
    if (existing) continue;
    const created = await prisma.aiSystem.create({
      data: { ...sys, tenantId: tenant.id, aiGovernanceOwnerId: governanceOwnerId, createdById: governanceOwnerId },
    });
    await appendAudit({
        tenantId: tenant.id,
        userId: governanceOwnerId,
        role: 'AI_GOVERNANCE_ADMIN',
        action: 'AI_SYSTEM_CREATED',
        objectType: 'AiSystem',
        objectId: created.id,
        newValue: created,
        source: 'app',
        reason: 'Demo data seed',
      });
  }

  // Phase 2 demo: a scanned "loan applications" CSV, run through the real
  // PII detection engine and linked to the Loan Decision Engine AI system,
  // so Data Discovery / Data Map / Find Me in AI have something to show.
  const loanSystem = await prisma.aiSystem.findFirst({ where: { tenantId: tenant.id, name: 'Loan Decision Engine' } });
  const existingAsset = await prisma.dataAsset.findFirst({ where: { tenantId: tenant.id, name: 'loan_applications_sample.csv' } });
  if (loanSystem && !existingAsset) {
    const { detectPii } = require('../src/lib/piiDetect');
    const headers = ['customer_name', 'email', 'phone', 'pan_number', 'income'];
    const rows = [
      { customer_name: 'Ritika Gupta', email: 'ritika.gupta@abcbank.demo', phone: '9876543210', pan_number: 'ABCDE1234F', income: '850000' },
      { customer_name: 'Sana Verma', email: 'sana.verma@abcbank.demo', phone: '9123456780', pan_number: 'PQRSX5678K', income: '620000' },
      { customer_name: 'Arjun Rao', email: 'arjun.rao@abcbank.demo', phone: '9988776655', pan_number: 'ZXCVB4321L', income: '410000' },
    ];
    const { findings, values, rowsScanned } = detectPii(headers, rows);

    const connector = await prisma.connector.upsert({
      where: { id: '00000000-0000-0000-0000-0000000000c1' },
      update: {},
      create: {
        id: '00000000-0000-0000-0000-0000000000c1',
        tenantId: tenant.id,
        name: 'Manual File Upload',
        type: 'FILE_UPLOAD',
        status: 'CONNECTED',
        createdById: governanceOwnerId,
      },
    });
    const run = await prisma.connectorRun.create({
      data: {
        tenantId: tenant.id,
        connectorId: connector.id,
        status: 'SUCCESS',
        finishedAt: new Date(),
        recordsScanned: rowsScanned,
        findingsCount: findings.length,
      },
    });
    const asset = await prisma.dataAsset.create({
      data: {
        tenantId: tenant.id,
        connectorRunId: run.id,
        name: 'loan_applications_sample.csv',
        originalFilename: 'loan_applications_sample.csv',
        mimeType: 'text/csv',
        sizeBytes: 2048,
        rowCount: rows.length,
        columnCount: headers.length,
        aiSystemId: loanSystem.id,
        status: 'SCANNED',
        scannedAt: new Date(),
        createdById: governanceOwnerId,
      },
    });
    if (findings.length) {
      await prisma.piiFinding.createMany({ data: findings.map((f) => ({ ...f, tenantId: tenant.id, dataAssetId: asset.id })) });
    }
    if (values.length) {
      await prisma.piiRecordValue.createMany({ data: values.map((v) => ({ ...v, tenantId: tenant.id, dataAssetId: asset.id })) });
    }
    await prisma.lineageEdge.create({
      data: {
        tenantId: tenant.id,
        sourceType: 'DATA_ASSET',
        sourceId: asset.id,
        targetType: 'AI_SYSTEM',
        targetId: loanSystem.id,
        relationship: 'TRAINED_ON',
      },
    });
    await appendAudit({
        tenantId: tenant.id,
        userId: governanceOwnerId,
        role: 'AI_GOVERNANCE_ADMIN',
        action: 'DATA_ASSET_SCANNED',
        objectType: 'DataAsset',
        objectId: asset.id,
        newValue: { name: asset.name, findingsCount: findings.length },
        source: 'app',
        reason: 'Demo data seed',
      });
  }

  // Phase 3 demo: a granted consent, plus a withdrawn one that ran through
  // the real consent-withdrawal -> DSAR -> impact-analysis -> remediation
  // pipeline, so Consent/DSAR screens aren't empty on first login.
  const existingConsent = await prisma.consent.findFirst({ where: { tenantId: tenant.id, dataSubjectIdentifier: 'ritika.gupta@abcbank.demo' } });
  if (loanSystem && !existingConsent) {
    await prisma.consent.create({
      data: {
        tenantId: tenant.id,
        dataSubjectIdentifier: 'ritika.gupta@abcbank.demo',
        purpose: 'Credit risk scoring',
        aiSystemId: loanSystem.id,
        processingActivity: 'Automated loan decisioning',
        dataCategory: 'Financial data',
        legalBasis: 'Contractual necessity',
        status: 'GRANTED',
        source: 'Web form',
        version: 'v1',
        createdById: governanceOwnerId,
      },
    });

    const withdrawnConsent = await prisma.consent.create({
      data: {
        tenantId: tenant.id,
        dataSubjectIdentifier: 'sana.verma@abcbank.demo',
        purpose: 'Credit risk scoring',
        aiSystemId: loanSystem.id,
        processingActivity: 'Automated loan decisioning',
        dataCategory: 'Financial data',
        legalBasis: 'Consent',
        status: 'WITHDRAWN',
        withdrawnAt: new Date(),
        source: 'Customer support call',
        version: 'v1',
        createdById: governanceOwnerId,
      },
    });

    const { analyzeImpact, generateRemediationActions } = require('../src/lib/dsarEngine');
    const dsar = await prisma.dsar.create({
      data: {
        tenantId: tenant.id,
        dataSubjectIdentifier: 'sana.verma@abcbank.demo',
        requestType: 'CONSENT_WITHDRAWAL',
        status: 'RECEIVED',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        notes: 'Auto-created from consent withdrawal (demo seed)',
        triggeredByConsentId: withdrawnConsent.id,
        createdById: governanceOwnerId,
      },
    });
    const impactRecords = await analyzeImpact(tenant.id, dsar.id, dsar.dataSubjectIdentifier);
    await generateRemediationActions(tenant.id, dsar.id, impactRecords);
    await prisma.dsar.update({ where: { id: dsar.id }, data: { status: 'REMEDIATION_PLANNED' } });

    await appendAudit({
        tenantId: tenant.id,
        userId: governanceOwnerId,
        role: 'AI_GOVERNANCE_ADMIN',
        action: 'CONSENT_WITHDRAWN',
        objectType: 'Consent',
        objectId: withdrawnConsent.id,
        newValue: { status: 'WITHDRAWN', triggeredDsarId: dsar.id },
        source: 'app',
        reason: 'Demo data seed',
      });
  }

  // Phase 4 demo: one Shadow AI policy + a logged event that trips it, and
  // a RAG knowledge base with one ingested (chunked) document, so the new
  // screens aren't empty on first login.
  const existingPolicy = await prisma.shadowAiPolicy.findFirst({ where: { tenantId: tenant.id, name: 'Block external AI uploads containing personal data' } });
  if (!existingPolicy) {
    const policy = await prisma.shadowAiPolicy.create({
      data: {
        tenantId: tenant.id,
        name: 'Block external AI uploads containing personal data',
        description: 'Blocks any file upload to an unauthorized external AI tool if it contains detected personal data.',
        requireExternalAi: true,
        requirePersonalData: true,
        categories: [],
        action: 'BLOCK',
        priority: 0,
        enabled: true,
        createdById: governanceOwnerId,
      },
    });
    await prisma.shadowAiPolicy.create({
      data: {
        tenantId: tenant.id,
        name: 'Warn on any external AI use',
        description: 'Warns whenever an employee uses an external AI tool, regardless of content.',
        requireExternalAi: true,
        requirePersonalData: false,
        categories: [],
        action: 'WARN',
        priority: 1,
        enabled: true,
        createdById: governanceOwnerId,
      },
    });

    const { evaluatePolicies } = require('../src/lib/policyEngine');
    const { action } = evaluatePolicies(
      { isExternalAi: true, personalDataDetected: true, categories: ['Email', 'PAN'] },
      [policy]
    );
    await prisma.shadowAiEvent.create({
      data: {
        tenantId: tenant.id,
        employeeIdentifier: 'Kabir Singh',
        application: 'ChatGPT (personal account)',
        destination: 'chat.openai.com',
        eventType: 'FILE_UPLOAD_TO_AI',
        isExternalAi: true,
        fileName: 'customer_list_draft.csv',
        piiDetected: true,
        piiCategories: ['Email', 'PAN'],
        recordCount: 3,
        matchedPolicyId: policy.id,
        recommendedAction: action,
        enforced: false,
        source: 'MANUAL_UPLOAD',
        createdById: governanceOwnerId,
      },
    });
  }

  const existingKb = await prisma.knowledgeBase.findFirst({ where: { tenantId: tenant.id, name: 'Support Policy KB' } });
  if (!existingKb) {
    const kb = await prisma.knowledgeBase.create({
      data: {
        tenantId: tenant.id,
        name: 'Support Policy KB',
        description: 'Internal policy documents used by the Customer Support Copilot.',
        aiSystemId: (await prisma.aiSystem.findFirst({ where: { tenantId: tenant.id, name: 'Customer Support Copilot' } }))?.id,
        createdById: governanceOwnerId,
      },
    });

    const { chunkText } = require('../src/lib/chunkText');
    const policyText = [
      'Refund Policy\n\nCustomers may request a refund within 30 days of purchase. Refunds are processed to the original payment method within 5-7 business days.',
      'Escalation Policy\n\nAny complaint involving a threat of legal action must be escalated to the compliance team immediately, before any further response is sent to the customer.',
      'Data Access Policy\n\nSupport agents may only view the last four digits of a stored card number. Full card numbers are never displayed in the support console.',
    ].join('\n\n');
    const chunks = chunkText(policyText);

    const dataAsset = await prisma.dataAsset.create({
      data: {
        tenantId: tenant.id,
        name: 'support_policies.txt',
        originalFilename: 'support_policies.txt',
        mimeType: 'text/plain',
        sizeBytes: policyText.length,
        status: 'SCANNED',
        scannedAt: new Date(),
        createdById: governanceOwnerId,
      },
    });
    const doc = await prisma.knowledgeBaseDocument.create({
      data: {
        tenantId: tenant.id,
        knowledgeBaseId: kb.id,
        dataAssetId: dataAsset.id,
        chunkCount: chunks.length,
        chunkedAt: new Date(),
        createdById: governanceOwnerId,
      },
    });
    await prisma.documentChunk.createMany({
      data: chunks.map((content, i) => ({
        tenantId: tenant.id,
        documentId: doc.id,
        chunkIndex: i,
        content,
        charCount: content.length,
        embeddingStatus: 'NOT_CONFIGURED',
      })),
    });
  }

  // Phase 5-8 demo: a computed risk assessment + DPIA + compliance control
  // for the Loan Decision Engine, an automated decision with an appeal, an
  // incident, and an emergency-action log entry — so every new screen has
  // something real to show on first login.
  if (loanSystem) {
    const { assessRisk } = require('../src/lib/riskEngine');
    const { buildDpiaTemplate } = require('../src/lib/dpiaTemplate');

    const freshLoanSystem = await prisma.aiSystem.findUnique({ where: { id: loanSystem.id } });
    const assessment = assessRisk(freshLoanSystem);
    await prisma.aiSystem.update({
      where: { id: loanSystem.id },
      data: { riskClassification: assessment.classification, riskRationale: assessment.rationale, lastAssessmentAt: new Date() },
    });

    const existingDpia = await prisma.dpia.findFirst({ where: { tenantId: tenant.id, aiSystemId: loanSystem.id } });
    if (!existingDpia) {
      const refreshedSystem = await prisma.aiSystem.findUnique({ where: { id: loanSystem.id } });
      await prisma.dpia.create({
        data: {
          tenantId: tenant.id,
          aiSystemId: loanSystem.id,
          status: 'APPROVED',
          sections: buildDpiaTemplate(refreshedSystem),
          residualRisk: refreshedSystem.riskClassification,
          approvedById: users['dpo@abcbank.demo'].id,
          approvedAt: new Date(),
          createdById: governanceOwnerId,
        },
      });
    }

    const existingControl = await prisma.complianceControl.findFirst({ where: { tenantId: tenant.id, aiSystemId: loanSystem.id } });
    if (!existingControl) {
      await prisma.complianceControl.create({
        data: {
          tenantId: tenant.id,
          aiSystemId: loanSystem.id,
          framework: 'DPDP',
          requirement: 'Significant decisions based solely on automated processing require a review mechanism',
          control: 'Human review queue for declined loan applications above a risk threshold',
          controlType: 'LEGAL_REQUIREMENT',
          status: 'IMPLEMENTED',
          evidenceNote: 'Human Review queue in the platform; see Decisions module.',
          ownerId: users['privacy@abcbank.demo'].id,
          createdById: governanceOwnerId,
        },
      });
    }

    const existingDecision = await prisma.automatedDecision.findFirst({ where: { tenantId: tenant.id, aiSystemId: loanSystem.id } });
    let decision = existingDecision;
    if (!decision) {
      decision = await prisma.automatedDecision.create({
        data: {
          tenantId: tenant.id,
          aiSystemId: loanSystem.id,
          dataSubjectIdentifier: 'arjun.rao@abcbank.demo',
          inputSummary: 'Income 410000, existing loans: 1, credit history: 4 years',
          decision: 'Declined',
          modelVersion: '3.2.1',
          riskLevel: 'HIGH',
          reviewStatus: 'OVERRIDDEN',
          reviewerId: users['reviewer@abcbank.demo'].id,
          overrideReason: 'Manual review found additional income documentation the model did not have access to.',
          finalOutcome: 'Approved on manual review',
          reviewedAt: new Date(),
          createdById: governanceOwnerId,
        },
      });
      await prisma.appeal.create({
        data: {
          tenantId: tenant.id,
          decisionId: decision.id,
          dataSubjectIdentifier: 'arjun.rao@abcbank.demo',
          reason: 'Applicant provided additional income documentation not considered in the original decision.',
          status: 'DECIDED',
          reviewerId: users['reviewer@abcbank.demo'].id,
          outcome: 'Overturned — approved after manual review of additional documents.',
          decidedAt: new Date(),
          createdById: governanceOwnerId,
        },
      });
    }

    const existingIncident = await prisma.incident.findFirst({ where: { tenantId: tenant.id, type: 'SHADOW_AI' } });
    if (!existingIncident) {
      const shadowEvent = await prisma.shadowAiEvent.findFirst({ where: { tenantId: tenant.id, employeeIdentifier: 'Kabir Singh' } });
      if (shadowEvent) {
        await prisma.incident.create({
          data: {
            tenantId: tenant.id,
            shadowAiEventId: shadowEvent.id,
            type: 'SHADOW_AI',
            status: 'CONTAINED',
            severity: 'HIGH',
            description: 'Employee uploaded a customer list containing email and PAN data to a personal ChatGPT account.',
            evidence: '[CONTAINED] IT confirmed the chat session was deleted; employee completed re-training.',
            createdById: governanceOwnerId,
          },
        });
      }
    }

    const existingEmergency = await prisma.emergencyAction.findFirst({ where: { tenantId: tenant.id } });
    if (!existingEmergency) {
      const hrSystem = await prisma.aiSystem.findFirst({ where: { tenantId: tenant.id, name: 'HR Screening AI' } });
      if (hrSystem) {
        await prisma.emergencyAction.create({
          data: {
            tenantId: tenant.id,
            aiSystemId: hrSystem.id,
            actionType: 'ROLLBACK_MODEL',
            status: 'REQUIRES_INTEGRATION',
            reason: 'Vendor reported a scoring regression affecting candidates from one region — requested rollback pending investigation.',
            ticketRef: 'OPS-4821',
            executedById: users['security@abcbank.demo']?.id || governanceOwnerId,
          },
        });
      }
    }
  }

  // Phase 9 demo: DPDP-specific data — DPO contact, an SDF designation, a
  // children's-data AI system, a verified minor consent, a registered
  // nominee, and a personal-data-breach incident awaiting notification.
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: {
      dpoName: 'Arjun Shah', dpoEmail: 'dpo@abcbank.demo', dpoPhone: '+91-22-0000-0000',
      significantDataFiduciary: true, independentAuditorName: 'Independent Audit Partners LLP',
      lastComplianceAuditAt: new Date('2026-03-31'), nextComplianceAuditDueAt: new Date('2027-03-31'),
      dsarResponseDays: 30,
    },
  });

  const recSystem = await prisma.aiSystem.findFirst({ where: { tenantId: tenant.id, name: 'Customer Recommendation Engine' } });
  if (recSystem) {
    await prisma.aiSystem.update({
      where: { id: recSystem.id },
      data: { processesChildrensData: true, behavioralTrackingOrAds: false, retentionPeriodDays: 1095 },
    });
  }
  const supportSystem = await prisma.aiSystem.findFirst({ where: { tenantId: tenant.id, name: 'Customer Support Copilot' } });
  if (supportSystem) {
    await prisma.aiSystem.update({ where: { id: supportSystem.id }, data: { retentionPeriodDays: 90 } });
  }

  const minorConsent = await prisma.consent.findFirst({ where: { tenantId: tenant.id, dataSubjectIdentifier: 'aarav.junior@abcbank.demo' } });
  if (!minorConsent && recSystem) {
    await prisma.consent.create({
      data: {
        tenantId: tenant.id, dataSubjectIdentifier: 'aarav.junior@abcbank.demo', purpose: 'Youth savings product recommendations',
        aiSystemId: recSystem.id, legalBasis: 'Consent', status: 'GRANTED', source: 'Branch form', version: 'v1',
        isMinorDataSubject: true, parentalConsentVerified: true, verifiedById: users['privacy@abcbank.demo'].id, verifiedAt: new Date(),
        createdById: governanceOwnerId,
      },
    });
  }

  const existingNominee = await prisma.nominee.findFirst({ where: { tenantId: tenant.id } });
  if (!existingNominee) {
    await prisma.nominee.create({
      data: {
        tenantId: tenant.id, dataSubjectIdentifier: 'ritika.gupta@abcbank.demo',
        nomineeName: 'Meera Gupta', nomineeContact: 'meera.gupta@example.com', relationship: 'Spouse',
        createdById: governanceOwnerId,
      },
    });
  }

  const breach = await prisma.incident.findFirst({ where: { tenantId: tenant.id, isPersonalDataBreach: true } });
  if (!breach) {
    await prisma.incident.create({
      data: {
        tenantId: tenant.id, aiSystemId: supportSystem?.id, type: 'PROMPT_DATA_EXPOSURE', status: 'INVESTIGATING', severity: 'HIGH',
        description: 'Support Copilot prompt logs exposed to a misconfigured analytics workspace; customer names and phone numbers visible.',
        isPersonalDataBreach: true, dpbNotificationRequired: true, affectedDataSubjectCount: 412,
        dpbNotifiedAt: null, affectedPrincipalsNotifiedAt: null, createdById: governanceOwnerId,
      },
    });
  }

  // Phase 10 demo: vendors (one without a DPA), hashed evidence, and an
  // emergency stop awaiting a second approver.
  const crypto = require('crypto');
  const anthropic = await prisma.vendor.findFirst({ where: { tenantId: tenant.id, name: 'Anthropic' } })
    || await prisma.vendor.create({ data: {
      tenantId: tenant.id, name: 'Anthropic', category: 'Model provider', country: 'United States', contactEmail: 'privacy@example.com',
      dpaSigned: true, dpaSignedAt: new Date('2026-02-01'), securityReviewAt: new Date('2026-05-10'), securityReviewOutcome: 'Approved with conditions',
      riskTier: 'LOW', createdById: governanceOwnerId,
    } });
  const ats = await prisma.vendor.findFirst({ where: { tenantId: tenant.id, name: 'ThirdPartyATS Inc.' } })
    || await prisma.vendor.create({ data: {
      tenantId: tenant.id, name: 'ThirdPartyATS Inc.', category: 'Recruitment platform', country: 'Ireland',
      dpaSigned: false, securityReviewOutcome: 'Review pending', riskTier: 'HIGH', createdById: governanceOwnerId,
    } });
  if (supportSystem) await prisma.aiSystem.update({ where: { id: supportSystem.id }, data: { vendorId: anthropic.id } });
  const hrForVendor = await prisma.aiSystem.findFirst({ where: { tenantId: tenant.id, name: 'HR Screening AI' } });
  if (hrForVendor) await prisma.aiSystem.update({ where: { id: hrForVendor.id }, data: { vendorId: ats.id } });

  const anyControl = await prisma.complianceControl.findFirst({ where: { tenantId: tenant.id } });
  const hasEvidence = await prisma.evidence.findFirst({ where: { tenantId: tenant.id } });
  if (anyControl && !hasEvidence) {
    const text = Buffer.from('Human review queue configuration export\nQueue: loan-declines\nSLA: 24h\nReviewer group: Human Reviewers\nExported: 2026-09-01\n');
    await prisma.evidence.create({ data: {
      tenantId: tenant.id, title: 'Human review queue configuration export', description: 'Shows declined applications route to human review.',
      controlId: anyControl.id, aiSystemId: anyControl.aiSystemId, fileName: 'review_queue_config.txt', mimeType: 'text/plain',
      sizeBytes: text.length, sha256: crypto.createHash('sha256').update(text).digest('hex'), content: text,
      validUntil: new Date('2027-09-01'), reviewStatus: 'PENDING', uploadedById: users['owner@abcbank.demo'].id,
    } });
  }

  const pendingStop = await prisma.emergencyAction.findFirst({ where: { tenantId: tenant.id, status: 'PENDING_APPROVAL' } });
  if (!pendingStop && loanSystem) {
    await prisma.emergencyAction.create({ data: {
      tenantId: tenant.id, aiSystemId: loanSystem.id, actionType: 'STOP_AI_SYSTEM', status: 'PENDING_APPROVAL',
      reason: 'Unexplained spike in declines after last model refresh — requesting suspension pending investigation.',
      ticketRef: 'OPS-4890', executedById: users['governance@abcbank.demo'].id,
    } });
  }

  // Phase 13 demo: one request submitted through the public portal, awaiting identity verification.
  const hasIntake = await prisma.dsarIntake.findFirst({ where: { tenantId: tenant.id } });
  if (!hasIntake) {
    await prisma.dsarIntake.create({
      data: {
        tenantId: tenant.id, reference: newReference(), requestType: 'DELETION', requesterName: 'Meera Kapoor', contactType: 'EMAIL', contactValue: 'meera.kapoor@example.com',
        dataSubjectIdentifier: 'meera.kapoor@example.com', details: 'Please erase my data — I closed my account last year.', statusTokenHash: hashToken(newToken()),
      },
    });
  }

  console.log('Seed complete.');
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);
  console.log('Demo login — pick any user below with password:', DEMO_PASSWORD);
  usersToCreate.forEach((u) => console.log(`  ${u.email}  [${u.role}]`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
