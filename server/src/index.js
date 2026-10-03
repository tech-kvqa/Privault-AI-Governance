require('dotenv').config();
try {
  require('./lib/config').assertProductionConfig();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
// Express 4 never answers a request whose async handler throws — the client just hangs.
// This routes those rejections to the error handler below instead.
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const aiSystemsRoutes = require('./routes/aiSystems');
const auditLogsRoutes = require('./routes/auditLogs');
const dashboardRoutes = require('./routes/dashboard');
const connectorsRoutes = require('./routes/connectors');
const dataDiscoveryRoutes = require('./routes/dataDiscovery');
const dataMapRoutes = require('./routes/dataMap');
const findMeInAiRoutes = require('./routes/findMeInAi');
const consentsRoutes = require('./routes/consents');
const dsarsRoutes = require('./routes/dsars');
const ragRoutes = require('./routes/rag');
const shadowAiRoutes = require('./routes/shadowAi');

const dpiasRoutes = require('./routes/dpias');
const complianceRoutes = require('./routes/compliance');
const decisionsRoutes = require('./routes/decisions');
const appealsRoutes = require('./routes/appeals');
const incidentsRoutes = require('./routes/incidents');
const emergencyRoutes = require('./routes/emergency');
const monitoringRoutes = require('./routes/monitoring');
const reportsRoutes = require('./routes/reports');
const nomineesRoutes = require('./routes/nominees');
const usersRoutes = require('./routes/users');
const intakeRoutes = require('./routes/intake');
const portalRoutes = require('./routes/portal');
const settingsRoutes = require('./routes/settings');
const vendorsRoutes = require('./routes/vendors');
const evidenceRoutes = require('./routes/evidence');
const webhooksRoutes = require('./routes/webhooks');

const app = express();

// Section 38 — secure headers + rate limiting, for real (not a checkbox in
// a features list). 300 req/15min per IP is generous enough for normal
// interactive use but stops naive brute-force/scraping.
// Behind nginx / a load balancer set TRUST_PROXY=1 so req.ip is the real client (rate limits, session IPs).
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : true);
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.RATE_LIMIT_MAX || 300), standardHeaders: true, legacyHeaders: false }));

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'privault-ai-governance', phasesBuilt: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] }));

app.use('/auth', authRoutes);
app.use('/public', portalRoutes); // unauthenticated data-principal portal — has its own rate limits
app.use('/users', usersRoutes);
app.use('/intake', intakeRoutes);
app.use('/ai-systems', aiSystemsRoutes);
app.use('/audit-logs', auditLogsRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/connectors', connectorsRoutes);
app.use('/data-discovery', dataDiscoveryRoutes);
app.use('/data-map', dataMapRoutes);
app.use('/find-me-in-ai', findMeInAiRoutes);
app.use('/consents', consentsRoutes);
app.use('/dsars', dsarsRoutes);
app.use('/rag', ragRoutes);
app.use('/shadow-ai', shadowAiRoutes);
app.use('/dpias', dpiasRoutes);
app.use('/compliance', complianceRoutes);
app.use('/decisions', decisionsRoutes);
app.use('/appeals', appealsRoutes);
app.use('/incidents', incidentsRoutes);
app.use('/emergency', emergencyRoutes);
app.use('/monitoring', monitoringRoutes);
app.use('/reports', reportsRoutes);
app.use('/nominees', nomineesRoutes);
app.use('/settings', settingsRoutes);
app.use('/vendors', vendorsRoutes);
app.use('/evidence', evidenceRoutes);
app.use('/webhooks', webhooksRoutes);

// Central error handler: never leak stack traces or fail silently.
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err); // details stay in the server log
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

module.exports = app; // exported so tests can start it in-process

if (require.main === module) {
  const port = process.env.PORT || 4100;
  app.listen(port, () => {
    console.log(`privault-ai-governance server listening on :${port}`);
  });
}
