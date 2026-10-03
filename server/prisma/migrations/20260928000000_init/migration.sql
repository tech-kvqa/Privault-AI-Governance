-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'AI_GOVERNANCE_ADMIN', 'PRIVACY_OFFICER', 'DPO', 'AI_SYSTEM_OWNER', 'DATA_OWNER', 'SECURITY_ADMIN', 'AUDITOR', 'HUMAN_REVIEWER', 'INCIDENT_MANAGER', 'READ_ONLY', 'CUSTOMER_APPEAL_USER');

-- CreateEnum
CREATE TYPE "AiSystemStatus" AS ENUM ('PROPOSED', 'ASSESSMENT', 'PENDING_APPROVAL', 'APPROVED', 'PRODUCTION', 'SUSPENDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RiskClassification" AS ENUM ('UNCLASSIFIED', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DpiaStatus" AS ENUM ('NOT_REQUIRED', 'REQUIRED_NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "EvidenceSourceType" AS ENUM ('AUTOMATIC', 'CONNECTOR', 'API', 'MANUAL_UPLOAD', 'USER_ENTERED');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('FILE_UPLOAD', 'DATABASE', 'CLOUD_STORAGE', 'VECTOR_DB', 'SAAS_API');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('CONNECTED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "ConnectorRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "PiiDetectionMethod" AS ENUM ('REGEX', 'CHECKSUM', 'DICTIONARY');

-- CreateEnum
CREATE TYPE "DataAssetStatus" AS ENUM ('SCANNED', 'FAILED');

-- CreateEnum
CREATE TYPE "LineageNodeType" AS ENUM ('DATA_ASSET', 'AI_SYSTEM');

-- CreateEnum
CREATE TYPE "LineageRelationship" AS ENUM ('FEEDS', 'TRAINED_ON', 'USED_IN_RAG');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN', 'EXPIRED', 'PENDING', 'REJECTED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "DsarRequestType" AS ENUM ('ACCESS', 'CORRECTION', 'DELETION', 'RESTRICTION', 'OBJECTION', 'CONSENT_WITHDRAWAL', 'AI_PROCESSING_INQUIRY', 'AUTOMATED_DECISION_CHALLENGE');

-- CreateEnum
CREATE TYPE "DsarStatus" AS ENUM ('RECEIVED', 'IMPACT_ANALYSIS', 'REMEDIATION_PLANNED', 'IN_EXECUTION', 'VERIFICATION', 'CLOSED');

-- CreateEnum
CREATE TYPE "RemediationActionType" AS ENUM ('DELETE', 'EXCLUDE', 'DE_LINK', 'EMBEDDING_DELETE', 'INDEX_REBUILD', 'RETRAIN', 'MODEL_IMPACT_REVIEW');

-- CreateEnum
CREATE TYPE "RemediationActionStatus" AS ENUM ('PENDING', 'REQUIRES_INTEGRATION', 'COMPLETED', 'MANUALLY_ATTESTED');

-- CreateEnum
CREATE TYPE "RagVectorStoreStatus" AS ENUM ('NOT_CONFIGURED', 'CONNECTED');

-- CreateEnum
CREATE TYPE "ShadowAiEventType" AS ENUM ('AI_WEBSITE_VISIT', 'FILE_UPLOAD_TO_AI', 'API_CALL_TO_AI', 'BROWSER_EXTENSION_DETECTED', 'UNAUTHORIZED_AGENT_DETECTED');

-- CreateEnum
CREATE TYPE "PolicyAction" AS ENUM ('ALLOW', 'WARN', 'BLOCK', 'REQUIRE_JUSTIFICATION', 'CREATE_INCIDENT');

-- CreateEnum
CREATE TYPE "DpiaWorkflowStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ComplianceFramework" AS ENUM ('DPDP', 'GDPR', 'ISO_27701', 'ISO_27001', 'ISO_42001', 'NIST_AI_RMF', 'ORG_POLICY');

-- CreateEnum
CREATE TYPE "ControlType" AS ENUM ('LEGAL_REQUIREMENT', 'ORG_POLICY', 'FRAMEWORK_CONTROL', 'RECOMMENDED_PRACTICE');

-- CreateEnum
CREATE TYPE "ControlStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'IMPLEMENTED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "DecisionReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'OVERRIDDEN', 'ESCALATED');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('SUBMITTED', 'UNDER_INVESTIGATION', 'DECIDED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('PII_LEAKAGE', 'SHADOW_AI', 'UNAUTHORIZED_TRAINING', 'PROMPT_DATA_EXPOSURE', 'RAG_LEAKAGE', 'MODEL_OUTPUT_PII', 'VENDOR_BREACH', 'UNAUTHORIZED_MODEL_ACCESS', 'DATA_POISONING', 'PRIVACY_CONTROL_FAILURE');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('DETECTED', 'CLASSIFIED', 'CONTAINED', 'INVESTIGATING', 'REMEDIATED', 'REVIEWED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EmergencyActionType" AS ENUM ('STOP_AI_SYSTEM', 'DISABLE_API', 'REVOKE_CREDENTIAL', 'STOP_DATA_FEED', 'DISABLE_AGENT', 'DISABLE_RAG', 'ROLLBACK_MODEL', 'ISOLATE_SERVICE');

-- CreateEnum
CREATE TYPE "EmergencyActionStatus" AS ENUM ('EXECUTED', 'REQUIRES_INTEGRATION', 'PENDING_APPROVAL', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvidenceReviewStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dpoName" TEXT,
    "dpoEmail" TEXT,
    "dpoPhone" TEXT,
    "significantDataFiduciary" BOOLEAN NOT NULL DEFAULT false,
    "independentAuditorName" TEXT,
    "lastComplianceAuditAt" TIMESTAMP(3),
    "nextComplianceAuditDueAt" TIMESTAMP(3),
    "dsarResponseDays" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_systems" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "businessOwner" TEXT,
    "technicalOwner" TEXT,
    "privacyOwner" TEXT,
    "aiGovernanceOwnerId" TEXT,
    "vendor" TEXT,
    "model" TEXT,
    "modelProvider" TEXT,
    "modelVersion" TEXT,
    "deploymentEnvironment" TEXT,
    "hostingLocation" TEXT,
    "processingLocation" TEXT,
    "purpose" TEXT,
    "businessFunction" TEXT,
    "userPopulation" TEXT,
    "dataSubjects" TEXT,
    "personalDataCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sensitiveDataCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trainingUsage" BOOLEAN NOT NULL DEFAULT false,
    "fineTuningUsage" BOOLEAN NOT NULL DEFAULT false,
    "ragUsage" BOOLEAN NOT NULL DEFAULT false,
    "automatedDecisionUsage" BOOLEAN NOT NULL DEFAULT false,
    "humanOversight" BOOLEAN NOT NULL DEFAULT true,
    "crossBorderProcessing" BOOLEAN NOT NULL DEFAULT false,
    "retention" TEXT,
    "retentionPeriodDays" INTEGER,
    "dpiaStatus" "DpiaStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "riskClassification" "RiskClassification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "riskRationale" TEXT,
    "securityControls" TEXT,
    "processesChildrensData" BOOLEAN NOT NULL DEFAULT false,
    "behavioralTrackingOrAds" BOOLEAN NOT NULL DEFAULT false,
    "crossBorderRestrictedCountry" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiSystemStatus" NOT NULL DEFAULT 'PROPOSED',
    "approvalStatus" TEXT DEFAULT 'Not submitted',
    "lastAssessmentAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "dataSourceType" "EvidenceSourceType" NOT NULL DEFAULT 'USER_ENTERED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vendorId" TEXT,

    CONSTRAINT "ai_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connectors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ConnectorType" NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "config" JSONB,
    "credentialsEncrypted" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "status" "ConnectorRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "recordsScanned" INTEGER NOT NULL DEFAULT 0,
    "findingsCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "connector_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectorRunId" TEXT,
    "name" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "rowCount" INTEGER,
    "columnCount" INTEGER,
    "aiSystemId" TEXT,
    "dataSourceType" "EvidenceSourceType" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "status" "DataAssetStatus" NOT NULL DEFAULT 'SCANNED',
    "scannedAt" TIMESTAMP(3),
    "scanComplete" BOOLEAN NOT NULL DEFAULT true,
    "rowsScanned" INTEGER,
    "sourceRef" TEXT,
    "indexedAsHash" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pii_findings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataAssetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "column" TEXT,
    "detectionMethod" "PiiDetectionMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchCount" INTEGER NOT NULL,
    "sampleRowsScanned" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pii_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pii_record_values" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataAssetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "column" TEXT,
    "value" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,

    CONSTRAINT "pii_record_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lineage_edges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceType" "LineageNodeType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" "LineageNodeType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationship" "LineageRelationship" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lineage_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSubjectIdentifier" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "aiSystemId" TEXT,
    "processingActivity" TEXT,
    "dataCategory" TEXT,
    "legalBasis" TEXT,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "source" TEXT,
    "version" TEXT,
    "notice" TEXT,
    "isMinorDataSubject" BOOLEAN NOT NULL DEFAULT false,
    "parentalConsentVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nominees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSubjectIdentifier" TEXT NOT NULL,
    "nomineeName" TEXT NOT NULL,
    "nomineeContact" TEXT NOT NULL,
    "relationship" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nominees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dsars" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dataSubjectIdentifier" TEXT NOT NULL,
    "requestType" "DsarRequestType" NOT NULL,
    "status" "DsarStatus" NOT NULL DEFAULT 'RECEIVED',
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "triggeredByConsentId" TEXT,
    "actingNomineeId" TEXT,
    "assignedToId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dsars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dsar_impact_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dsarId" TEXT NOT NULL,
    "dataAssetId" TEXT,
    "aiSystemId" TEXT,
    "category" TEXT NOT NULL,
    "column" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dsar_impact_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remediation_actions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dsarId" TEXT NOT NULL,
    "dataAssetId" TEXT,
    "aiSystemId" TEXT,
    "actionType" "RemediationActionType" NOT NULL,
    "status" "RemediationActionStatus" NOT NULL DEFAULT 'PENDING',
    "ownerId" TEXT,
    "reviewerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "evidence" TEXT,
    "comments" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remediation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "aiSystemId" TEXT,
    "vectorStoreStatus" "RagVectorStoreStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "vectorStoreNote" TEXT DEFAULT 'CONTROL AVAILABLE — INTEGRATION REQUIRED. No embedding model or vector store is configured in this deployment.',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_base_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "dataAssetId" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "chunkedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_base_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "charCount" INTEGER NOT NULL,
    "embeddingStatus" "RagVectorStoreStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shadow_ai_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "requireExternalAi" BOOLEAN NOT NULL DEFAULT true,
    "requirePersonalData" BOOLEAN NOT NULL DEFAULT true,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action" "PolicyAction" NOT NULL DEFAULT 'WARN',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shadow_ai_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shadow_ai_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "employeeIdentifier" TEXT NOT NULL,
    "application" TEXT NOT NULL,
    "destination" TEXT,
    "eventType" "ShadowAiEventType" NOT NULL,
    "isExternalAi" BOOLEAN NOT NULL DEFAULT true,
    "fileName" TEXT,
    "piiDetected" BOOLEAN NOT NULL DEFAULT false,
    "piiCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recordCount" INTEGER,
    "matchedPolicyId" TEXT,
    "recommendedAction" "PolicyAction" NOT NULL DEFAULT 'ALLOW',
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "EvidenceSourceType" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "createdById" TEXT,

    CONSTRAINT "shadow_ai_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpias" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "status" "DpiaWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "sections" JSONB NOT NULL,
    "residualRisk" "RiskClassification",
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dpias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_controls" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT,
    "framework" "ComplianceFramework" NOT NULL,
    "requirement" TEXT NOT NULL,
    "control" TEXT NOT NULL,
    "controlType" "ControlType" NOT NULL,
    "status" "ControlStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "evidenceNote" TEXT,
    "ownerId" TEXT,
    "reviewDate" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_controls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automated_decisions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "dataSubjectIdentifier" TEXT NOT NULL,
    "inputSummary" TEXT,
    "decision" TEXT NOT NULL,
    "modelVersion" TEXT,
    "riskLevel" "RiskClassification" NOT NULL DEFAULT 'MEDIUM',
    "reviewStatus" "DecisionReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "overrideReason" TEXT,
    "finalOutcome" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "automated_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "dataSubjectIdentifier" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT,
    "status" "AppealStatus" NOT NULL DEFAULT 'SUBMITTED',
    "reviewerId" TEXT,
    "outcome" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT,
    "shadowAiEventId" TEXT,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'DETECTED',
    "severity" "RiskClassification" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "isPersonalDataBreach" BOOLEAN NOT NULL DEFAULT false,
    "affectedDataSubjectCount" INTEGER,
    "dpbNotificationRequired" BOOLEAN NOT NULL DEFAULT false,
    "dpbNotifiedAt" TIMESTAMP(3),
    "affectedPrincipalsNotifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_actions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "aiSystemId" TEXT NOT NULL,
    "actionType" "EmergencyActionType" NOT NULL,
    "status" "EmergencyActionStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "ticketRef" TEXT,
    "executedById" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "emergency_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "country" TEXT,
    "contactEmail" TEXT,
    "dpaSigned" BOOLEAN NOT NULL DEFAULT false,
    "dpaSignedAt" TIMESTAMP(3),
    "securityReviewAt" TIMESTAMP(3),
    "securityReviewOutcome" TEXT,
    "isSubProcessor" BOOLEAN NOT NULL DEFAULT false,
    "riskTier" "RiskClassification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "controlId" TEXT,
    "aiSystemId" TEXT,
    "sourceType" "EvidenceSourceType" NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "validUntil" TIMESTAMP(3),
    "reviewStatus" "EvidenceReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretEncrypted" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "source" TEXT NOT NULL DEFAULT 'app',
    "reason" TEXT,
    "ipAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_email_key" ON "users"("tenantId", "email");

-- CreateIndex
CREATE INDEX "ai_systems_tenantId_idx" ON "ai_systems"("tenantId");

-- CreateIndex
CREATE INDEX "ai_systems_tenantId_status_idx" ON "ai_systems"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ai_systems_tenantId_riskClassification_idx" ON "ai_systems"("tenantId", "riskClassification");

-- CreateIndex
CREATE INDEX "connectors_tenantId_idx" ON "connectors"("tenantId");

-- CreateIndex
CREATE INDEX "connector_runs_tenantId_idx" ON "connector_runs"("tenantId");

-- CreateIndex
CREATE INDEX "data_assets_tenantId_idx" ON "data_assets"("tenantId");

-- CreateIndex
CREATE INDEX "data_assets_tenantId_sourceRef_idx" ON "data_assets"("tenantId", "sourceRef");

-- CreateIndex
CREATE INDEX "pii_findings_tenantId_dataAssetId_idx" ON "pii_findings"("tenantId", "dataAssetId");

-- CreateIndex
CREATE INDEX "pii_record_values_tenantId_value_idx" ON "pii_record_values"("tenantId", "value");

-- CreateIndex
CREATE INDEX "pii_record_values_tenantId_dataAssetId_idx" ON "pii_record_values"("tenantId", "dataAssetId");

-- CreateIndex
CREATE INDEX "lineage_edges_tenantId_idx" ON "lineage_edges"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "lineage_edges_tenantId_sourceType_sourceId_targetType_targe_key" ON "lineage_edges"("tenantId", "sourceType", "sourceId", "targetType", "targetId", "relationship");

-- CreateIndex
CREATE INDEX "consents_tenantId_idx" ON "consents"("tenantId");

-- CreateIndex
CREATE INDEX "consents_tenantId_dataSubjectIdentifier_idx" ON "consents"("tenantId", "dataSubjectIdentifier");

-- CreateIndex
CREATE INDEX "nominees_tenantId_dataSubjectIdentifier_idx" ON "nominees"("tenantId", "dataSubjectIdentifier");

-- CreateIndex
CREATE INDEX "dsars_tenantId_idx" ON "dsars"("tenantId");

-- CreateIndex
CREATE INDEX "dsars_tenantId_status_idx" ON "dsars"("tenantId", "status");

-- CreateIndex
CREATE INDEX "dsar_impact_records_tenantId_dsarId_idx" ON "dsar_impact_records"("tenantId", "dsarId");

-- CreateIndex
CREATE INDEX "remediation_actions_tenantId_dsarId_idx" ON "remediation_actions"("tenantId", "dsarId");

-- CreateIndex
CREATE INDEX "knowledge_bases_tenantId_idx" ON "knowledge_bases"("tenantId");

-- CreateIndex
CREATE INDEX "knowledge_base_documents_tenantId_knowledgeBaseId_idx" ON "knowledge_base_documents"("tenantId", "knowledgeBaseId");

-- CreateIndex
CREATE INDEX "document_chunks_tenantId_documentId_idx" ON "document_chunks"("tenantId", "documentId");

-- CreateIndex
CREATE INDEX "shadow_ai_policies_tenantId_idx" ON "shadow_ai_policies"("tenantId");

-- CreateIndex
CREATE INDEX "shadow_ai_events_tenantId_idx" ON "shadow_ai_events"("tenantId");

-- CreateIndex
CREATE INDEX "shadow_ai_events_tenantId_detectedAt_idx" ON "shadow_ai_events"("tenantId", "detectedAt");

-- CreateIndex
CREATE INDEX "dpias_tenantId_aiSystemId_idx" ON "dpias"("tenantId", "aiSystemId");

-- CreateIndex
CREATE INDEX "compliance_controls_tenantId_idx" ON "compliance_controls"("tenantId");

-- CreateIndex
CREATE INDEX "automated_decisions_tenantId_idx" ON "automated_decisions"("tenantId");

-- CreateIndex
CREATE INDEX "automated_decisions_tenantId_reviewStatus_idx" ON "automated_decisions"("tenantId", "reviewStatus");

-- CreateIndex
CREATE INDEX "appeals_tenantId_idx" ON "appeals"("tenantId");

-- CreateIndex
CREATE INDEX "incidents_tenantId_idx" ON "incidents"("tenantId");

-- CreateIndex
CREATE INDEX "incidents_tenantId_status_idx" ON "incidents"("tenantId", "status");

-- CreateIndex
CREATE INDEX "emergency_actions_tenantId_idx" ON "emergency_actions"("tenantId");

-- CreateIndex
CREATE INDEX "vendors_tenantId_idx" ON "vendors"("tenantId");

-- CreateIndex
CREATE INDEX "evidence_tenantId_idx" ON "evidence"("tenantId");

-- CreateIndex
CREATE INDEX "webhook_endpoints_tenantId_idx" ON "webhook_endpoints"("tenantId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenantId_endpointId_idx" ON "webhook_deliveries"("tenantId", "endpointId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_timestamp_idx" ON "audit_logs"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_objectType_objectId_idx" ON "audit_logs"("tenantId", "objectType", "objectId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_aiGovernanceOwnerId_fkey" FOREIGN KEY ("aiGovernanceOwnerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "connectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_connectorRunId_fkey" FOREIGN KEY ("connectorRunId") REFERENCES "connector_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_assets" ADD CONSTRAINT "data_assets_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pii_findings" ADD CONSTRAINT "pii_findings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pii_findings" ADD CONSTRAINT "pii_findings_dataAssetId_fkey" FOREIGN KEY ("dataAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pii_record_values" ADD CONSTRAINT "pii_record_values_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pii_record_values" ADD CONSTRAINT "pii_record_values_dataAssetId_fkey" FOREIGN KEY ("dataAssetId") REFERENCES "data_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lineage_edges" ADD CONSTRAINT "lineage_edges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nominees" ADD CONSTRAINT "nominees_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsars" ADD CONSTRAINT "dsars_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsars" ADD CONSTRAINT "dsars_actingNomineeId_fkey" FOREIGN KEY ("actingNomineeId") REFERENCES "nominees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsars" ADD CONSTRAINT "dsars_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsar_impact_records" ADD CONSTRAINT "dsar_impact_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsar_impact_records" ADD CONSTRAINT "dsar_impact_records_dsarId_fkey" FOREIGN KEY ("dsarId") REFERENCES "dsars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsar_impact_records" ADD CONSTRAINT "dsar_impact_records_dataAssetId_fkey" FOREIGN KEY ("dataAssetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsar_impact_records" ADD CONSTRAINT "dsar_impact_records_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_dsarId_fkey" FOREIGN KEY ("dsarId") REFERENCES "dsars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_dataAssetId_fkey" FOREIGN KEY ("dataAssetId") REFERENCES "data_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remediation_actions" ADD CONSTRAINT "remediation_actions_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base_documents" ADD CONSTRAINT "knowledge_base_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base_documents" ADD CONSTRAINT "knowledge_base_documents_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base_documents" ADD CONSTRAINT "knowledge_base_documents_dataAssetId_fkey" FOREIGN KEY ("dataAssetId") REFERENCES "data_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_base_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shadow_ai_policies" ADD CONSTRAINT "shadow_ai_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shadow_ai_events" ADD CONSTRAINT "shadow_ai_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shadow_ai_events" ADD CONSTRAINT "shadow_ai_events_matchedPolicyId_fkey" FOREIGN KEY ("matchedPolicyId") REFERENCES "shadow_ai_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpias" ADD CONSTRAINT "dpias_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpias" ADD CONSTRAINT "dpias_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpias" ADD CONSTRAINT "dpias_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_controls" ADD CONSTRAINT "compliance_controls_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_controls" ADD CONSTRAINT "compliance_controls_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_controls" ADD CONSTRAINT "compliance_controls_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automated_decisions" ADD CONSTRAINT "automated_decisions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automated_decisions" ADD CONSTRAINT "automated_decisions_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automated_decisions" ADD CONSTRAINT "automated_decisions_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "automated_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_shadowAiEventId_fkey" FOREIGN KEY ("shadowAiEventId") REFERENCES "shadow_ai_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_actions" ADD CONSTRAINT "emergency_actions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_actions" ADD CONSTRAINT "emergency_actions_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_actions" ADD CONSTRAINT "emergency_actions_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_actions" ADD CONSTRAINT "emergency_actions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "compliance_controls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

