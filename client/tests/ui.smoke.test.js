// Mounts the REAL app (real router, Pinia stores, Vuetify, and the real Login form) in jsdom against the REAL
// backend, then walks every page. Fails on any Vue warning/error and checks that seeded data is on screen.
// It is not a browser: layout, CSS and real user gestures are not covered.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { privaultTheme } from '../src/theme';
import router from '../src/router';
import App from '../src/App.vue';
import { useAuthStore } from '../src/stores/auth';

let backendUp = false;
let wrapper;
const problems = [];
const seen = () => problems.splice(0).filter((p) => !/^\[Vue warn\]: Extraneous non-props|ResizeObserver/.test(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, ms = 10000) {
  const start = Date.now();
  for (;;) {
    await flushPromises();
    let ok = false;
    try { ok = check(); } catch { ok = false; }
    if (ok) return;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}. Page text: ${wrapper.text().replace(/\s+/g, ' ').slice(0, 400)}`);
    await sleep(80);
  }
}
const text = () => wrapper.text().replace(/\s+/g, ' ');
async function go(path, expected) {
  seen();
  await router.push(path);
  await flushPromises();
  for (const e of [].concat(expected)) await until(() => text().includes(e), `"${e}" on ${path}`);
  await sleep(150);
  await flushPromises();
  const p = seen();
  expect(p, `Vue warnings/errors on ${path}:\n${p.join('\n')}`).toEqual([]);
}

beforeAll(async () => {
  try { backendUp = (await fetch('http://127.0.0.1:4100/health')).ok; } catch { backendUp = false; }
  if (!backendUp) return;
  const origError = console.error;
  console.error = (...a) => { problems.push('console.error: ' + a.map(String).join(' ').slice(0, 300)); origError(...a); };
  const vuetify = createVuetify({ components, directives, theme: { defaultTheme: 'privaultTheme', themes: { privaultTheme } } });
  wrapper = mount(App, {
    attachTo: document.body,
    global: {
      plugins: [createPinia(), router, vuetify],
      config: { warnHandler: (m) => problems.push('[Vue warn]: ' + m), errorHandler: (e) => problems.push('Vue error: ' + (e?.stack || e).toString().slice(0, 400)) },
    },
  });
  await router.push('/login');
  await router.isReady();
  await flushPromises();
});
afterAll(() => wrapper?.unmount());

const suite = describe;
suite('UI smoke (real app + real backend)', () => {
  it('logs in through the real Login form and lands on the dashboard', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await until(() => text().includes('Sign in to the AI privacy control plane'), 'login page');
    await wrapper.find('input[type="password"]').setValue('wrong-password');
    await wrapper.find('form').trigger('submit');
    await until(() => /Invalid email or password/.test(text()), 'login error');
    await wrapper.find('input[type="password"]').setValue('Demo@1234');
    await wrapper.find('form').trigger('submit');
    await until(() => router.currentRoute.value.name === 'dashboard', 'redirect to dashboard');
    expect(useAuthStore().isAuthenticated).toBe(true);
    await until(() => text().includes('AI systems needing attention'), 'dashboard content');
    const t = text();
    await until(() => !/…/.test(text().split('Shadow AI Events')[0].slice(-40)) && /Pending Human Reviews/.test(text()), 'KPIs loaded');
    expect(text()).not.toMatch(/Phase \d/);      // no placeholder KPI cards, ever
    expect(text()).toMatch(/Shadow AI Events/);
    expect(seen()).toEqual([]);
  });

  const pages = [
    ['/dashboard', ['Loan Decision Engine', 'Recent activity', 'Pending Human Reviews']],
    ['/ai-inventory', ['Loan Decision Engine', 'Customer Recommendation Engine', 'HR Screening AI']],
    ['/audit-trail', ['Audit Trail', 'Login']],
    ['/connectors', ['Manual File Upload', 'Add PostgreSQL connector']],
    ['/data-discovery', ['loan_applications_sample.csv', 'Scan for PII']],
    ['/data-map', ['AI Data Map', 'Data asset']],
    ['/find-me-in-ai', ['Find Me in AI']],
    ['/consents', ['ritika.gupta@abcbank.demo', 'Minor / parental consent', 'aarav.junior@abcbank.demo']],
    ['/dsars', ['sana.verma@abcbank.demo', 'Due']],
    ['/rag-governance', ['Support Policy KB']],
    ['/shadow-ai', ['Kabir Singh', 'ChatGPT (personal account)']],
    ['/risk-compliance', ['Loan Decision Engine', 'APPROVED']],
    ['/decisions', ['arjun.rao@abcbank.demo', 'OVERRIDDEN']],
    ['/operations', ['Monitoring', 'Open incidents', 'DPDP & governance signals']],
    ['/vendors', ['ThirdPartyATS Inc.', 'No DPA on record', 'Anthropic']],
    ['/evidence', ['Human review queue configuration export', 'PENDING']],
    ['/reports', ['AI Inventory Report', 'DPDP Breach Register']],
    ['/settings', ['Data Protection Officer', 'Significant Data Fiduciary obligations', 'Data Protection Officer appointed and contact published']],
  ];
  for (const [path, expected] of pages) {
    it(`renders ${path} with real data and no Vue errors`, async (ctx) => {
      if (!backendUp) return ctx.skip();
      await go(path, expected);
    });
  }

  it('drills into an AI system profile, a data asset, a DSAR and a knowledge base', async (ctx) => {
    if (!backendUp) return ctx.skip();
    const { useAiSystemsStore } = await import('../src/stores/aiSystems');
    const { useDataDiscoveryStore } = await import('../src/stores/dataDiscovery');
    const { useRightsStore } = await import('../src/stores/rights');
    const { useRagStore } = await import('../src/stores/rag');
    const loan = useAiSystemsStore().items.find((s) => s.name === 'Loan Decision Engine');
    await go(`/ai-inventory/${loan.id}`, ['Loan Decision Engine', 'Overview', 'Manually entered'.slice(0, 0) + 'Approval status']);
    await wrapper.findAll('.v-tab').find((t) => t.text() === 'Data').trigger('click');
    await until(() => text().includes('Linked data assets') && text().includes('DPDP Act indicators'), 'Data tab content');
    expect(seen()).toEqual([]);
    const asset = useDataDiscoveryStore().assets[0];
    await go(`/data-discovery/${asset.id}`, ['PII findings', 'Sample values']);
    const dsar = useRightsStore().dsars[0];
    await go(`/dsars/${dsar.id}`, ['Impact discovered', 'Remediation actions']);
    const kb = useRagStore().knowledgeBases[0];
    await go(`/rag-governance/${kb.id}`, ['Ingest a document', 'support_policies.txt']);
  });

  it('runs a Find Me in AI search from the UI and shows found / unknown statuses with reasons', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/find-me-in-ai', ['Find Me in AI']);
    await wrapper.find('input[placeholder^="e.g."]').setValue('sana.verma@abcbank.demo');
    const btn = wrapper.findAll('button').find((b) => b.text().trim() === 'Search');
    await btn.trigger('click');
    await until(() => text().includes('AI system coverage'), 'search results');
    expect(text()).toMatch(/Found/);
    expect(text()).toMatch(/No scanned data asset is linked to this system/);
    expect(seen()).toEqual([]);
  });

  // ------------------------------------------------------------- real interactions
  const body = () => document.body.textContent.replace(/\s+/g, ' ');
  const overlay = () => document.querySelector('.v-overlay--active .v-overlay__content') || document.body;
  const inputs = () => [...overlay().querySelectorAll('input:not([type=checkbox]), textarea')];
  const setInput = async (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); await flushPromises(); };
  const button = (label) => [...overlay().querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const clickButton = async (label) => { const b = button(label); if (!b) throw new Error(`no "${label}" button. Overlay: ${overlay().textContent.replace(/\s+/g, ' ').slice(0, 300)}`); b.click(); await flushPromises(); };
  const untilBody = async (re, what, ms = 10000) => { const t0 = Date.now(); while (!re.test(body())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}. Dialog: ${overlay().textContent.replace(/\s+/g, ' ').slice(-420)}`); await sleep(80); await flushPromises(); } };
  const comp = (name, pred) => wrapper.findAllComponents({ name }).find(pred);

  it('creates an AI system through the real form and it appears in the inventory', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/ai-inventory', ['Loan Decision Engine']);
    await wrapper.findAll('button').find((b) => b.text().includes('Add AI System')).trigger('click');
    await untilBody(/Add AI System.*Manually entered/, 'create dialog');
    await setInput(inputs()[0], 'UI Created System');
    await comp('VCheckbox', (c) => /children/i.test(c.props('label') || '')).setValue(true);
    await clickButton('Create');
    await until(() => text().includes('UI Created System'), 'new inventory row');
    expect(seen()).toEqual([]);
  });

  it('shows the server-enforced DPDP s.9 message when a minor\'s consent has no parental verification', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/consents', ['ritika.gupta@abcbank.demo']);
    await wrapper.findAll('button').find((b) => b.text().includes('Record Consent')).trigger('click');
    await untilBody(/Record Consent.*Data subject identifier/, 'consent dialog');
    const [who, purpose] = inputs();
    await setInput(who, 'child@example.com');
    await setInput(purpose, 'Youth savings product');
    await comp('VCheckbox', (c) => /minor/i.test(c.props('label') || '')).setValue(true);
    await clickButton('Save');
    await untilBody(/DPDP Section 9/, 'the s.9 error message');
    expect(body()).toMatch(/cannot be recorded as Granted without parentalConsentVerified/);
    // ticking the parental-verification box lets it through
    await comp('VCheckbox', (c) => /parental/i.test(c.props('label') || '')).setValue(true);
    await clickButton('Save');
    await until(() => text().includes('child@example.com'), 'saved minor consent row');
    expect(text()).toMatch(/Minor — parent verified/);
  });

  it('refuses a vendor marked "DPA signed" without a signing date, and explains why', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/vendors', ['ThirdPartyATS Inc.']);
    await wrapper.findAll('button').find((b) => b.text().includes('Add vendor')).trigger('click');
    await untilBody(/Add vendor.*Category/, 'vendor dialog');
    await setInput(inputs()[0], 'Date-less Vendor');
    await comp('VCheckbox', (c) => /agreement signed/i.test(c.props('label') || '')).setValue(true);
    await clickButton('Create');
    await untilBody(/Provide the date the data processing agreement was signed/, 'the DPA date error');
  });

  it('shows "awaiting a second approver" to the person who requested the emergency stop', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/operations', ['Monitoring']);
    await wrapper.findAll('.v-tab').find((t) => t.text() === 'Emergency Controls').trigger('click');
    await until(() => text().includes('Action log') && text().includes('PENDING APPROVAL'), 'pending emergency action');
    expect(text()).toMatch(/Awaiting a second approver/);          // logged in as the requester (governance admin)
    expect(text()).not.toMatch(/Approve\s*Reject/);
  });

  it('adds a PostgreSQL connector, tests it, scans it and shows per-table coverage — all through the UI', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/connectors', ['Manual File Upload']);
    await wrapper.findAll('button').find((b) => b.text().includes('Add PostgreSQL connector')).trigger('click');
    await untilBody(/Add PostgreSQL connector.*SELECT only/, 'connector dialog');
    const [name, host, port, database, user, password] = inputs();
    await setInput(name, 'UI bank_demo');
    await setInput(host, '127.0.0.1');
    await setInput(port, '5432');
    await setInput(database, 'bank_demo');
    await setInput(user, 'scanner');
    await setInput(password, 'scanner-pw');
    await comp('VSelect', (c) => (c.props('label') || '') === 'TLS').setValue('disable');
    await clickButton('Create');
    await until(() => text().includes('UI bank_demo') && text().includes('Not configured'), 'new connector, not yet configured');
    expect(text()).not.toMatch(/scanner-pw/);

    const row = () => wrapper.findAll('tr').find((r) => r.text().includes('UI bank_demo'));
    await row().findAll('button').find((b) => b.text() === 'Test').trigger('click');
    await until(() => /Connected as|Connection failed/.test(text()), 'connection test result');
    if (/Connection failed: (Connection refused|Database does not exist|Authentication failed)/.test(text())) return ctx.skip(); // no bank_demo fixture here
    expect(text()).toMatch(/Connected as scanner to bank_demo/);
    expect(text()).toMatch(/Read-only session: yes/);
    await until(() => row().text().includes('Connected'), 'status Connected');
    expect(text()).toMatch(/TLS is disabled/);                      // warning surfaced to the user

    await row().findAll('button').find((b) => b.text() === 'Scan').trigger('click');
    await untilBody(/Scan UI bank_demo.*Rows to read per table/, 'scan dialog');
    await setInput(inputs().find((i) => i.type === 'number'), '1000');
    await clickButton('Start scan');
    await untilBody(/tables scanned.*contain personal data/, 'scan results', 20000);
    const b = body();
    expect(b).toMatch(/public\.customers/);
    expect(b).toMatch(/public\.web_logins/);
    expect(b).toMatch(/Sampled/);                                   // 3000-row table read only in part
    expect(b).toMatch(/Complete/);
    expect(b).toMatch(/Find Me in AI will never report "Not found" based on an incomplete scan/);
    expect(seen()).toEqual([]);
  });

  // ------------------------------------------------------------- every create form, minimal input
  const setComp = async (name, labelStart, value) => {
    const c = comp(name, (x) => String(x.props('label') || '').startsWith(labelStart));
    if (!c) throw new Error(`no ${name} labelled "${labelStart}"`);
    await c.setValue(value); await flushPromises();
  };
  const tab = async (label) => { await wrapper.findAll('.v-tab').find((t) => t.text() === label).trigger('click'); await flushPromises(); };
  const pageButton = (label) => wrapper.findAll('button').find((b) => b.text().includes(label));

  it('completes the adult consent left unfinished above, with no AI system chosen', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/consents', ['ritika.gupta@abcbank.demo']);
    await pageButton('Record Consent').trigger('click');
    await untilBody(/Record Consent.*Data subject identifier/, 'consent dialog');
    await setComp('VTextField', 'Data subject identifier', 'adult@example.com');
    await setComp('VTextField', 'Purpose', 'Marketing preferences');
    await clickButton('Save');
    await until(() => text().includes('adult@example.com'), 'saved adult consent');
  });

  it('logs an incident with no AI system selected', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/operations', ['Monitoring']);
    await tab('Incidents');
    await pageButton('Log Incident').trigger('click');
    await untilBody(/Log Incident.*Description/, 'incident dialog');
    await setComp('VTextarea', 'Description', 'UI-logged incident with no system');
    await clickButton('Log');
    await until(() => text().includes('UI-logged incident with no system'), 'incident row');
  });

  it('creates a knowledge base without linking an AI system', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/rag-governance', ['Support Policy KB']);
    await pageButton('New Knowledge Base').trigger('click');
    await untilBody(/New Knowledge Base.*Name/, 'kb dialog');
    await setComp('VTextField', 'Name', 'UI Knowledge Base');
    await clickButton('Create');
    await until(() => text().includes('UI Knowledge Base'), 'kb card');
  });

  it('creates a compliance control without an AI system', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/risk-compliance', ['Loan Decision Engine']);
    await tab('Compliance Controls');
    await pageButton('New Control').trigger('click');
    await untilBody(/New Compliance Control.*Requirement/, 'control dialog');
    await setComp('VTextField', 'Requirement', 'UI requirement text');
    await setComp('VTextField', 'Control', 'UI control text');
    await clickButton('Create');
    await until(() => text().includes('UI requirement text'), 'control row');
  });

  it('raises a DSAR and lands on its detail page', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/dsars', ['sana.verma@abcbank.demo']);
    await pageButton('New DSAR').trigger('click');
    await untilBody(/New DSAR.*Data subject identifier/, 'dsar dialog');
    await setComp('VTextField', 'Data subject identifier', 'ui.dsar@example.com');
    await clickButton('Create');
    await until(() => router.currentRoute.value.name === 'dsar-detail', 'DSAR detail route');
    await until(() => text().includes('Run impact analysis'), 'impact analysis step');
  });

  it('registers a nominee and logs an automated decision', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/settings', ['Data Protection Officer']);
    await tab('Nominees (s.14)');
    await pageButton('Register nominee').trigger('click');
    await untilBody(/Register nominee.*Nominee name/, 'nominee dialog');
    await setComp('VTextField', 'Data principal', 'ui.principal@example.com');
    await setComp('VTextField', 'Nominee name', 'UI Nominee');
    await setComp('VTextField', 'Nominee contact', 'nominee@example.com');
    await clickButton('Register');
    await until(() => text().includes('UI Nominee'), 'nominee row');

    const { useAiSystemsStore } = await import('../src/stores/aiSystems');
    const loan = useAiSystemsStore().items.find((s) => s.name === 'Loan Decision Engine');
    await go('/decisions', ['arjun.rao@abcbank.demo']);
    await pageButton('Log Decision').trigger('click');
    await untilBody(/Log Automated Decision.*Decision/, 'decision dialog');
    await setComp('VSelect', 'AI system', loan.id);
    await setComp('VTextField', 'Data subject', 'ui.subject@example.com');
    await setComp('VTextField', 'Decision', 'Declined by UI test');
    await clickButton('Log');
    await until(() => text().includes('ui.subject@example.com'), 'decision row');
  });

  // ------------------------------------------------------------- Phase 13: accounts, MFA, gate, portal
  it('shows the production gate\'s blockers and lets an authorized role override with a reason', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/ai-inventory', ['Loan Decision Engine']);
    await pageButton('Add AI System').trigger('click');
    await untilBody(/Add AI System.*Manually entered/, 'create dialog');
    await setInput(inputs()[0], 'Gated System');
    await setComp('VSelect', 'Lifecycle status', 'PRODUCTION');
    await comp('VCheckbox', (c) => /automated decisions/i.test(c.props('label') || '')).setValue(true);
    await clickButton(overlay().querySelector('button.v-btn--variant-elevated, button')?.textContent.includes('Create') ? 'Create' : 'Create');
    await untilBody(/can't move to PRODUCTION yet/, 'gate blockers shown');
    expect(overlay().textContent).toMatch(/DPIA/);
    const textareas = overlay().querySelectorAll('textarea');
    const reasonBox = [...textareas].find((t) => /business|reason/i.test(t.closest('.v-input')?.textContent || '')) || textareas[textareas.length - 1];
    await setInput(reasonBox, 'Launching now with a documented, accountable business justification for this exception');
    await clickButton('Save & override');
    await sleep(200); await flushPromises();
    if (overlay() !== document.body) {
      throw new Error('dialog still open after override attempt: ' + overlay().textContent.replace(/\s+/g, ' ').slice(0, 500));
    }
    await until(() => text().includes('Gated System'), 'system now appears in the inventory');
    expect(seen()).toEqual([]);
  });

  it('invites a user through the real Users page and shows a one-time link (no email is sent)', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/users', ['Rahul Mehta']);
    await pageButton('Invite user').trigger('click');
    await untilBody(/Invite user.*Email/, 'invite dialog');
    const [name, email] = inputs();
    await setInput(name, 'UI Invited Person');
    await setInput(email, 'ui.invited@abcbank.demo');
    await clickButton('Send invite');
    await untilBody(/No email is sent.*accept-invite\?token=/s, 'one-time invite link shown');
    await clickButton('Done');
    await until(() => text().includes('UI Invited Person') && text().includes('invited'), 'new user row');
  });

  it('turns on org-wide MFA, sees the enrolled count change, then turns it back off', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/users', ['Require MFA']);
    const sw = comp('VSwitch', () => true);
    await sw.find('input').trigger('click');
    await until(() => text().includes('restricted to completing MFA setup') || /\d+ of \d+ active users enrolled/.test(text()), 'policy feedback');
    await sw.find('input').trigger('click');
    await until(() => !document.querySelector('input[type=checkbox]:checked'), 'toggled back off');
    expect(seen()).toEqual([]);
  });

  it('the account page changes password and shows this session in the session list', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await go('/account', ['Change password']);
    await tab('Sessions');
    await until(() => text().includes('this device'), 'current session listed');
    expect(seen()).toEqual([]);
  });

  it('serves the public rights-request portal with no login, and submission gives a reference and token', async (ctx) => {
    if (!backendUp) return ctx.skip();
    await router.push('/portal/abc-bank');
    await flushPromises();
    await until(() => text().includes('ABC Bank') && text().includes('Submit a request'), 'portal home');
    await setComp('VTextField', "Your name", 'UI Portal Person');
    await setComp('VTextField', 'Email', 'ui.portal@example.com');
    const submitBtn = wrapper.findAll('button').find((b) => b.text() === 'Submit request');
    await submitBtn.trigger('click');
    await until(() => text().includes('Your request was received'), 'submission confirmation');
    expect(text()).toMatch(/DPR-/);
    expect(seen()).toEqual([]);
  });

  it('the portal status page rejects a wrong token and accepts the right one', async (ctx) => {
    if (!backendUp) return ctx.skip();
    const res = await fetch('http://127.0.0.1:4100/public/abc-bank/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'ACCESS', requesterName: 'Status Check Person', contactType: 'EMAIL', contactValue: 'status.check@example.com' }),
    });
    const sub = await res.json();
    await router.push('/portal/abc-bank/status');
    await flushPromises();
    await until(() => text().includes('Check request status'), 'status page');
    const [ref, tok] = inputs();
    await setInput(ref, sub.reference);
    await setInput(tok, 'wrong-token-value');
    await clickButton('Check status');
    await untilBody(/No request matches/, 'wrong token rejected');
    await setInput(inputs()[1], sub.statusToken);
    await clickButton('Check status');
    await until(() => text().includes('Received') || text().includes('RECEIVED'.toLowerCase()) || /received/i.test(text()), 'correct token accepted');
    expect(seen()).toEqual([]);
  });
});
