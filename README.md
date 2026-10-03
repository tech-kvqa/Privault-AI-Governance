# PRIVault AI Governance — Phases 1–13

Every module from the master spec's Section 53 phase plan has a real
implementation here — not a UI mockup, not simulated execution. The rule
followed throughout: **build what Privault can genuinely do for real; for
anything that would need a live integration into a customer's own
infrastructure (a database, a vector store, an API gateway, a browser
extension), model it honestly as `NOT_CONFIGURED` / `REQUIRES_INTEGRATION`
and say so in the UI — never fake a successful execution.**

See `docs/phase-plan.md` for the full, honest phase-by-phase account of
what's real vs. what still needs a live integration, plus concrete next
steps for anyone taking this further.

## What's here

**Backend** (`/server`) — Express + Prisma/PostgreSQL. JWT auth, 12-role
RBAC, tenant-isolated queries throughout, and an audit log entry written on
every mutation. Real logic worth calling out:

- **PII detection engine** (`lib/piiDetect.js`) — regex matchers, plus
  actual checksum validation (Luhn for cards, Verhoeff for Aadhaar), plus
  column-header dictionary matching.
- **Risk engine** (`lib/riskEngine.js`) — weighted-factor scoring with a
  named rationale, never an opaque number.
- **Policy engine** (`lib/policyEngine.js`) — evaluates Shadow AI events
  against tenant policies; a `CREATE_INCIDENT` result genuinely opens an
  Incident.
- **DSAR engine** (`lib/dsarEngine.js`) — the exact same matching logic
  "Find Me in AI" uses, so a DSAR's evidence trail can never disagree with
  a manual search.
- **Chunking** (`lib/chunkText.js`) — real deterministic document chunking
  for RAG Governance.
- **CSV reports** (`lib/csv.js`) — six live report types, generated on
  request, not cached.

**Frontend** (`/client`) — Vue 3 + Vuetify 3 + Pinia. Every module in the
sidebar is a real, working page: AI Inventory, Audit Trail, AI Data
Discovery, AI Data Map, Find Me in AI, Consent, AI Data Rights (DSAR), RAG
Governance, Shadow AI, AI Risk & DPIA, Decisions & Appeals, AI Operations
(monitoring/incidents/emergency controls), and Reports.

**Demo data** (`prisma/seed.js`) — the "ABC Bank" tenant, 8 users across
different roles, 6 AI systems, a scanned CSV linked to one of them, a
consent-withdrawal that ran through the full DSAR pipeline, a Shadow AI
policy that trips on a logged event, a RAG knowledge base with a chunked
document, a computed risk assessment + approved DPIA + compliance control,
an automated decision that was appealed and overturned, an incident, and
an emergency-action log entry.

**Phase 9 — DPDP Act specifics**: children's-data and parental-consent
enforcement (s.9), Right to Nominate (s.14), personal-data-breach
notification tracking that blocks closure until notified (s.8(6)), DPO
contact publication, Significant Data Fiduciary obligations checklist
(s.10), retention/erasure review flags (s.8(7)), and configurable rights-
request due dates with overdue flagging. See `docs/phase-plan.md` for what's
enforced vs. self-attested.

**Phase 10 — Vendors, Evidence, dual approval, webhooks**: a vendor register
whose DPA status feeds risk scoring; hash-verified evidence with
separation-of-duties review; two-person approval to suspend a Production AI
system; and signed, SSRF-guarded webhooks for every audited event. Plus an
automated test suite: `cd server && npm test`.

**Phase 13 — accounts & MFA, tamper-evident audit, the Production gate, and a public portal**: real TOTP
(RFC 6238-verified), server-side sessions, account lockout, one-time invite/reset links, org-wide MFA
enforcement with self-recovery, a hash-chained + database-append-only audit log, a gate blocking Production
without an approved DPIA (with an audited override), and a self-service rights-request portal at
`/portal/<org-slug>`. Onboard a new organisation with `node server/scripts/create-tenant.js --name "..."
--slug "..." --admin-email "..." --admin-name "..."`. 29 more real end-to-end tests (69 total server-side).
See `docs/phase-plan.md`.

**Phase 12 — verified and deployable**: real migrations, the seed and the whole API/UI exercised against a
real database (16 end-to-end tests; 32 UI checks), which found and fixed real bugs; Dockerfiles, a full-stack
compose file and a production-config guard. See `docs/phase-plan.md`.

**Phase 11 — first live connector**: a read-only PostgreSQL scanner (Connectors
page) that stores personal data only as keyed hashes and records whether each
table was scanned completely, so Find Me in AI never claims absence from
partially scanned data. Setup and limits: `docs/connectors.md`.

## Running it locally

Needs Node 22+ and PostgreSQL 14+ (16 tested).

```bash
# 1. Database — Docker, or any Postgres (then set DATABASE_URL in server/.env)
docker compose up -d db

# 2. Backend  (http://localhost:4100)
cd server
cp .env.example .env
npm install
npm run migrate        # applies prisma/migrations with plain pg — no Prisma engine needed
npm run seed           # demo tenant "ABC Bank" (safe to run repeatedly)
npm run dev

# 3. Frontend  (http://localhost:5173)
cd client
npm install
npm run dev
```

Demo users (password `Demo@1234`): `admin@`, `governance@`, `privacy@`, `dpo@`, `owner@`, `auditor@`,
`security@`, `reviewer@`, `readonly@` — all `@abcbank.demo`. None have MFA enrolled by default. Public
rights-request portal: http://localhost:5173/portal/abc-bank.

**Everything in containers:** `cp .env.docker.example .env`, fill in the three secrets
(`openssl rand -hex 32`), then `docker compose up --build` → http://localhost:8080. The API refuses to
start in production with placeholder secrets. Add `SEED_DEMO=true` only for demos (well-known passwords).

**Changing the schema:** edit `server/prisma/schema.prisma`, then `npm run migrate:dev` (Prisma's own
tooling, on a machine that can download its schema engine) to author the new migration, and commit it.
The runtime client is Rust-free (`engineType = "client"` + `@prisma/adapter-pg`): nothing is downloaded at
install time, so air-gapped installs work (`PRISMA_OFFLINE=1 npx prisma generate`).

## Tests

```bash
cd server && npm test   # unit + route tests need no database. Connector and end-to-end tests use a REAL
                        # PostgreSQL: run `bash test/fixtures/setup-pg.sh` once as a Postgres superuser; the
                        # `privault` role needs CREATEDB (E2E_ADMIN_URL overrides). They skip if none is reachable.
cd client && npm test   # mounts the real Vue app (real router/Pinia/Vuetify/Login form) in jsdom against a
                        # real backend it starts itself on :4100. Needs server dependencies installed.
```

## Notes for whoever picks this up next

- `dataSourceType` on `AiSystem`/`DataAsset` defaults to manual/user-entered.
  When a real connector lands, it should set `AUTOMATIC`/`CONNECTOR`/`API`
  so the UI's "manually entered, not connector-verified" banners stay
  honest.
- RBAC is a static in-memory map (`server/src/middleware/rbac.js`) rather
  than DB-backed `roles`/`permissions` tables, to keep every phase
  shippable on schedule. Moving it into tables is additive —
  `requirePermission()` callers don't need to change.
- Every route scopes queries by `req.auth.tenantId` at the database level —
  never trust a tenant ID from the request body/params.
- The single largest remaining body of work is the live connectors
  everything else is waiting on — see `docs/phase-plan.md`'s "What would
  make this production-ready next" section.
