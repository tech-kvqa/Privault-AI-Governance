import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import api from '../lib/api';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true } },
  { path: '/mfa-setup', name: 'mfa-setup', component: () => import('../views/MfaSetup.vue'), meta: { public: true } },
  { path: '/portal/:slug', name: 'portal', component: () => import('../views/portal/PortalHome.vue'), meta: { public: true } },
  { path: '/portal/:slug/status', name: 'portal-status', component: () => import('../views/portal/PortalStatus.vue'), meta: { public: true } },
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue') },
  { path: '/ai-inventory', name: 'ai-inventory', component: () => import('../views/AIInventory.vue') },
  { path: '/ai-inventory/:id', name: 'ai-system-profile', component: () => import('../views/AISystemProfile.vue'), props: true },
  { path: '/audit-trail', name: 'audit-trail', component: () => import('../views/AuditTrail.vue') },
  { path: '/data-discovery', name: 'data-discovery', component: () => import('../views/DataDiscovery.vue') },
  { path: '/data-discovery/:id', name: 'data-asset-detail', component: () => import('../views/DataAssetDetail.vue'), props: true },
  { path: '/data-map', name: 'data-map', component: () => import('../views/DataMap.vue') },
  { path: '/find-me-in-ai', name: 'find-me-in-ai', component: () => import('../views/FindMeInAi.vue') },
  { path: '/consents', name: 'consents', component: () => import('../views/Consents.vue') },
  { path: '/dsars', name: 'dsars', component: () => import('../views/Dsars.vue') },
  { path: '/dsars/:id', name: 'dsar-detail', component: () => import('../views/DsarDetail.vue'), props: true },
  { path: '/rag-governance', name: 'rag-governance', component: () => import('../views/RagGovernance.vue') },
  { path: '/rag-governance/:id', name: 'rag-kb-detail', component: () => import('../views/RagKnowledgeBaseDetail.vue'), props: true },
  { path: '/shadow-ai', name: 'shadow-ai', component: () => import('../views/ShadowAi.vue') },
  { path: '/risk-compliance', name: 'risk-compliance', component: () => import('../views/RiskCompliance.vue') },
  { path: '/decisions', name: 'decisions', component: () => import('../views/Decisions.vue') },
  { path: '/operations', name: 'operations', component: () => import('../views/Operations.vue') },
  { path: '/reports', name: 'reports', component: () => import('../views/Reports.vue') },
  { path: '/connectors', name: 'connectors', component: () => import('../views/Connectors.vue') },
  { path: '/vendors', name: 'vendors', component: () => import('../views/Vendors.vue') },
  { path: '/evidence', name: 'evidence', component: () => import('../views/Evidence.vue') },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue') },
  { path: '/account', name: 'account', component: () => import('../views/Account.vue') },
  { path: '/users', name: 'users', component: () => import('../views/Users.vue') },
  { path: '/intake', name: 'intake', component: () => import('../views/Intake.vue') },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    if (to.name === 'login' && auth.isAuthenticated) return { name: 'dashboard' };
    return true;
  }
  if (!auth.isAuthenticated) return { name: 'login', query: { redirect: to.fullPath } };
  // Server is the source of truth for restriction (a session can become restricted from another tab / an
  // admin turning the org policy on) — check on every navigation, not just at login.
  try {
    await auth.refreshSession();
  } catch (e) {
    if (e.response?.status === 401) return { name: 'login' };
  }
  if (auth.sessionRestricted && to.name !== 'mfa-setup') return { name: 'mfa-setup' };
  if (!auth.sessionRestricted && to.name === 'mfa-setup') return { name: 'dashboard' };
  return true;
});

export default router;
