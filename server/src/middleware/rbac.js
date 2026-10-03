// Section 34 — Role-Based Access Control.
// A static permission map rather than DB-backed roles/permissions tables;
// requirePermission() call sites wouldn't change if this moves to tables.

const CORE = ['ai_system:read', 'ai_system:create', 'ai_system:update', 'ai_system:archive', 'audit_log:read'];
const DISCOVERY = ['connector:read', 'connector:create', 'connector:scan', 'data_asset:read', 'data_asset:create', 'lineage:read', 'find_me:read'];
const RIGHTS = ['consent:read', 'consent:create', 'consent:withdraw', 'dsar:read', 'dsar:create', 'dsar:manage'];
const RAG_SHADOW = ['rag:read', 'rag:create', 'shadow_ai:read', 'shadow_ai:create', 'policy:read', 'policy:create'];
const RISK_COMPLIANCE = ['risk:assess', 'dpia:read', 'dpia:create', 'dpia:manage', 'dpia:approve', 'compliance:read', 'compliance:manage'];
const DECISIONS = ['decision:read', 'decision:create', 'review:manage', 'appeal:read', 'appeal:create', 'appeal:manage'];
const OPERATIONS = ['incident:read', 'incident:create', 'incident:manage', 'emergency:read', 'emergency:execute', 'report:read'];
const SETTINGS = ['settings:read', 'settings:manage'];
const VENDOR_EVIDENCE = ['vendor:read', 'vendor:manage', 'evidence:read', 'evidence:create', 'evidence:review'];
const INTEGRATIONS = ['webhook:read', 'webhook:manage'];
const INTAKE = ['intake:read', 'intake:manage'];

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ['*'],

  AI_GOVERNANCE_ADMIN: [
    ...CORE, ...DISCOVERY, ...RIGHTS, ...RAG_SHADOW, ...RISK_COMPLIANCE, ...DECISIONS, ...OPERATIONS,
    ...SETTINGS, ...VENDOR_EVIDENCE, ...INTEGRATIONS, ...INTAKE, 'emergency:approve', 'user:read', 'user:manage', 'ai_system:gate_override',
  ],

  PRIVACY_OFFICER: [
    'ai_system:read', 'ai_system:update', 'audit_log:read', ...DISCOVERY, ...RIGHTS, ...RAG_SHADOW,
    ...RISK_COMPLIANCE, ...DECISIONS, ...SETTINGS, ...VENDOR_EVIDENCE, ...INTAKE,
    'incident:read', 'incident:create', 'incident:manage', 'emergency:read', 'report:read', 'ai_system:gate_override',
  ],

  DPO: [
    'ai_system:read', 'ai_system:update', 'audit_log:read',
    'connector:read', 'data_asset:read', 'lineage:read', 'find_me:read',
    'consent:read', 'consent:withdraw', 'dsar:read', 'dsar:create', 'dsar:manage',
    'rag:read', 'shadow_ai:read', 'policy:read',
    'dpia:read', 'dpia:create', 'dpia:manage', 'dpia:approve', 'compliance:read',
    'decision:read', 'appeal:read', 'appeal:manage', 'incident:read', 'report:read',
    'settings:read', 'settings:manage',
    'vendor:read', 'evidence:read', 'evidence:create', 'evidence:review', 'emergency:read', 'emergency:approve', ...INTAKE,
  ],

  AI_SYSTEM_OWNER: [
    'ai_system:read', 'ai_system:create', 'ai_system:update',
    'connector:read', 'data_asset:read', 'data_asset:create', 'lineage:read',
    'consent:read', 'dsar:read', 'rag:read', 'rag:create', 'shadow_ai:read',
    'risk:assess', 'dpia:read', 'dpia:create', 'decision:read', 'decision:create',
    'vendor:read', 'evidence:read', 'evidence:create',
  ],

  DATA_OWNER: ['ai_system:read', 'data_asset:read', 'lineage:read', 'rag:read', 'dpia:read', 'evidence:read'],

  SECURITY_ADMIN: [
    'ai_system:read', 'audit_log:read', 'connector:read', 'data_asset:read', 'lineage:read',
    'shadow_ai:read', 'shadow_ai:create', 'policy:read', 'policy:create',
    'incident:read', 'incident:create', 'incident:manage', 'emergency:read', 'emergency:execute', 'emergency:approve', 'report:read',
    'vendor:read', 'evidence:read', 'evidence:create', 'user:read', ...INTEGRATIONS,
  ],

  AUDITOR: [
    'ai_system:read', 'audit_log:read', 'connector:read', 'data_asset:read', 'lineage:read',
    'consent:read', 'dsar:read', 'rag:read', 'shadow_ai:read', 'policy:read',
    'dpia:read', 'compliance:read', 'decision:read', 'appeal:read', 'incident:read', 'emergency:read', 'report:read',
    'settings:read', 'vendor:read', 'evidence:read', 'webhook:read', 'user:read', 'intake:read',
  ], // Section 34: "Auditor can view evidence but cannot modify controls"

  HUMAN_REVIEWER: ['ai_system:read', 'decision:read', 'review:manage', 'appeal:read'],

  INCIDENT_MANAGER: ['ai_system:read', 'shadow_ai:read', 'incident:read', 'incident:create', 'incident:manage', 'emergency:read', 'emergency:execute'],

  READ_ONLY: ['ai_system:read', 'data_asset:read', 'lineage:read', 'rag:read', 'dpia:read', 'compliance:read', 'decision:read', 'incident:read', 'vendor:read', 'evidence:read'],

  CUSTOMER_APPEAL_USER: ['appeal:create'],
};

function can(role, permission) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes('*') || perms.includes(permission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.auth) return res.status(401).json({ error: 'Not authenticated' });
    if (!can(req.auth.role, permission)) {
      return res.status(403).json({ error: `Role ${req.auth.role} does not have permission ${permission}` });
    }
    next();
  };
}

module.exports = { requirePermission, can, ROLE_PERMISSIONS };
