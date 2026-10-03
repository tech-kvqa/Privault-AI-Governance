# Phase plan (Section 53 of the master spec)

Status of each phase against what actually exists in this repo today.

| Phase | Scope (per spec) | Status |
|---|---|---|
| 1 | Foundation: architecture, DB, auth, tenant isolation, RBAC, navigation, AI Inventory | **Built** |
| 2 | AI Data Governance: data assets, PII discovery, lineage, privacy graph, Find Me in AI | **Built** |
| 3 | AI Rights: consent, DSAR, deletion, remediation | **Built** (RAG governance moved to Phase 4) |
| 4 | Shadow AI + RAG Governance (deferred from Phase 3) | **Built** |
| 5 | AI Risk: risk engine, DPIA, framework mapping | **Built** |
| 6 | AI Decisions: automated decisions, human review, appeals | **Built** |
| 7 | AI Operations: incidents, monitoring, emergency controls | **Built** |
| 8 | Enterprise: reporting, security hardening | **Partially built** — see below |
| 9 | DPDP Act-specific obligations (added on request, beyond the original spec) | **Built** — see below |
| 10 | Phase 8 leftovers: Vendors, Evidence, dual approval, signed webhooks, automated tests | **Built** — see below |
| 11 | First live connector (PostgreSQL) + scan-completeness honesty + hashed PII index | **Built** — see below and `docs/connectors.md` |
| 12 | Run it for real: migrations, seed, end-to-end + UI tests, bug fixes, Docker, production guard | **Built** — see below |
| 13 | Accounts & MFA, tamper-evident audit log, Production gate, public rights-request portal | **Built** — see below |

Every phase follows the same honesty rule established in Phase 1 and never
relaxed since: **real, executable code for anything Privault genuinely
controls; anything that needs a live integration into the customer's own
infrastructure is clearly labeled `NOT_CONFIGURED` / `REQUIRES_INTEGRATION`
and never simulated as having succeeded** (Section 25).

## Phase 16 — Reviewed and verified an externally-amended build

A separately-provided "amended build" was checked against the current source. It modified exactly
one file, `server/src/routes/auth.js`: applying the same atomic `consumeTotpStep()` mechanism (Phase
14) to `/auth/mfa/enable` as well — an endpoint that mechanism had deliberately been left out of
originally, since first-time enrollment has no prior consumable state to replay against. The
amendment's reasoning was sound: two concurrent `/mfa/enable` requests carrying the same
freshly-generated code could both read `mfaEnabled=false` / `mfaLastStep=null` before either wrote,
and both succeed. Verified correct: the removed `verifyTotp` import had no other remaining use in the
file, and the `consumeTotpStep()` call signature matched exactly.

The amendment's own `BUILD_NOTES.md` was explicit and honest that its concurrency claim had **not**
been verified against real PostgreSQL — its environment had no Docker/Postgres available, so its added
test (`server/test/mfa-enable-source.test.js`) only checks that the source code *calls*
`consumeTotpStep` via a text match, not that doing so is actually race-safe at runtime. That test is
kept (harmless, catches an accidental revert), but it is not sufficient on its own, so a real one was
added: `server/test/mfa-fix-regression-c.test.js` fires two genuinely concurrent HTTP requests at a
real database with the identical TOTP code and confirms exactly one succeeds — plus a sequential-reuse
check. Both fixes were mutation-tested (temporarily reverted, confirmed the right test fails, restored).

One bug was found and fixed along the way, in the new test itself, not the product: the first draft
used an invited user's name ("Enable Race Test") that shared a word with the test's own password,
correctly tripping the password policy's "don't include your name" rule (Section 18, FR-18-03) — a
reminder that Privault's own validation catches sloppy test fixtures as readily as sloppy production
input.

Full regression after merging: 82/82 server tests, 38/38 UI tests.

## Phase 15 — Docker QA kit merged in; one real infrastructure bug fixed

A separately-provided Docker QA kit (`qa/`) was merged into the repository: a `docker-compose.qa.yml`
that builds a throwaway PostgreSQL plus a test-runner container, and `run-full-tests.sh`, which installs
exact dependencies from both lockfiles, prepares the PostgreSQL connector fixture, runs a JS syntax check,
then runs the real `npm test` in both `server/` and `client/` — the same commands this project's own `npm
test` scripts already run, just inside Docker so nobody needs PostgreSQL or Node on the host.

Its Dockerfiles, compose files and docs were byte-identical to what was already in this repo; the only
addition was the `qa/` folder itself, and every path it references (`server/test/fixtures/setup-pg.sh`,
`server/src`, `client/src`, both package manifests) was confirmed to exist. Still no Docker runtime in the
environment this was built in, so the container build itself is untested — but every command the QA
container runs was executed directly on the host and passed: 78/78 server tests (including the Phase 14
MFA fix regression suite) and 38/38 UI tests, both via the exact `npm test` entry points the kit calls.

**One real bug found and fixed: no repo-root `.dockerignore`.** `qa/Dockerfile.test` builds from the repo
root and, after running `npm ci` in both `server/` and `client/`, does `COPY . /workspace` — which, with no
`.dockerignore` at the root, would copy the entire build context including any host `node_modules/` on top
of the just-installed clean ones (silently replacing correct-platform native bindings like `bcrypt` with
whatever the host machine has), and could pull real secrets out of a developer's `.env` files into the QA
image. Added `.dockerignore` at the repo root excluding `node_modules`, `.env*` (with `.env.example` and
`.env.docker.example` explicitly kept), `dist`, `.git` and logs — server's and client's own Dockerfiles
already had their own `.dockerignore` for their production image builds, since each of those uses its own
subdirectory as its build context; only the QA kit's root-context build was exposed.

## Phase 14 — Fix: MFA one-time TOTP/recovery-code replay in reauthentication paths

A defect report (`PRIVault_AI_Governance_Claude_Fix_Instructions.docx`) found that
`/auth/mfa/disable` and `/auth/mfa/recovery-codes` validated a submitted TOTP code via the
shared `reauthenticate()` helper but never recorded it as consumed — so the same 30-second
code could be replayed against those two endpoints, and (since consumption state lives on the
user row) a code used there could still separately be used to sign in. A second, subtler issue:
even the login path's own consumption was a non-atomic read-then-write, so two concurrent
requests carrying the same code could both read the old "last used" step before either wrote
the new one, and both would succeed.

**Fix — `server/src/lib/mfaConsume.js` (new).** Two atomic, single-use consumption functions
used by every endpoint that accepts a TOTP code or recovery code:
- `consumeTotpStep` performs validation and consumption as one conditional `UPDATE ... WHERE
  mfaLastStep IS NULL OR mfaLastStep < $step` — a database compare-and-swap, so at most one of
  two concurrent requests carrying the same code can ever succeed.
- `consumeRecoveryCode` does the equivalent for recovery codes via
  `array_remove(...) WHERE code = ANY(...)`.

**`server/src/routes/auth.js`** — three call sites updated to use these: `/auth/mfa/verify`
(login second factor), `reauthenticate()` (the actual bug — now consumes atomically, and checks
the password first so a wrong password never burns a valid code), and no change was needed to
`/auth/mfa/enable` (pre-enrolment, no prior consumable state to replay against).

**Regression tests** — 9 checks covering all 7 scenarios the fix instructions specified
(sequential replay at login, replay at reauthentication, replay across the two, genuine
concurrency via `Promise.all` on two identical requests, wrong-password-does-not-consume,
single-use recovery codes, disable/regenerate still work with a fresh code, and audit trail
intact), run against a real PostgreSQL database with real TOTP arithmetic — including real
30-second waits between codes where the scenario requires a genuinely fresh one, since a mock
clock would not have caught this class of bug. Split across `test/mfa-fix-regression-a.test.js`
and `-b.test.js` (own scratch databases) so the wall-clock cost doesn't dominate the shared
suite's run budget. Mutation-tested: reverting either fix independently makes the exact
scenario it protects fail, and nothing else.

**FRD.** Section 2's Mode A status cell was inconsistent with FR-16 (Mode A said "Not
implemented," Section 16 then documented an implemented PostgreSQL connector). Reworded to
"Partially implemented" with a pointer to Section 16 — the connector itself was not touched.

Full regression run after the fix: 69/69 server tests, 38/38 UI tests, clean build. Nothing was
removed or weakened to make a test pass.

## What Phase 13 built — accounts, tamper-evident audit, the Production gate, and a public portal

The four things flagged as the real next steps after Phase 12: user/tenant management with MFA and session
revocation, a tamper-evident audit log, a gate blocking Production without an approved DPIA, and a
self-service portal so data principals don't need a staff account to raise a request. Same rule as always:
built and run against a real database, not just written.

**Accounts & MFA**
- Real TOTP (`server/src/lib/totp.js`), verified against the RFC 6238 Appendix B test vectors (not just
  "it produces 6 digits") — a code cannot be replayed (a used 30-second step is rejected), and the shared
  secret is AES-256-GCM encrypted at rest.
- Server-side sessions: a JWT is only a handle to a `Session` row, so sessions can be listed, individually
  revoked, and time out on inactivity — logout, password change, or an admin's "revoke sessions" take effect
  immediately rather than waiting for the JWT to expire.
- Invitations and password resets are one-time links (Privault sends no email — a link is shown once to the
  admin who issues it, matching the master spec's "distinguish what Privault can execute directly"
  principle). Password policy follows NIST SP 800-63B (length over composition rules, a common-password
  blocklist) rather than arbitrary complexity rules.
- Account lockout after 5 failed attempts; timing-safe comparisons and a dummy hash on unknown emails so
  response time doesn't reveal which accounts exist.
- Org-wide "require MFA" is a real, enforced setting: turning it on immediately restricts every unenrolled
  session (including the admin's own) to `/auth/*` until they enrol — real end-to-end tests exercise the
  admin locking themselves out and self-recovering via the same enrolment endpoint, because that is the
  actual failure mode a real admin would hit.
- `scripts/create-tenant.js` onboards a new organisation from the command line (Privault has no
  platform-operator UI).

**Tamper-evident audit log** (`server/src/lib/auditChain.js`)
- Every audit row carries the SHA-256 of its own content chained to the previous row for that tenant.
  `GET /audit-logs/verify` recomputes the whole chain and reports exactly where it breaks if anything was
  edited, reordered, or removed.
- A database-level trigger additionally refuses direct `UPDATE`/`DELETE`/`TRUNCATE` on `audit_logs` — real
  end-to-end tests confirm this at the SQL level, not just through the API, including that disabling the
  trigger (what a superuser could do) is exactly the scenario the hash chain is there to catch afterwards.
- Honest limit, stated in the code and here: the chain proves nothing was altered *within* what's stored,
  but can't by itself prove the *most recent* entries weren't removed — that needs the periodically-fetched
  `head` hash anchored somewhere outside this database (a ticket, WORM storage, a signed email). Not
  automated in this phase.

**Production gate** (`server/src/lib/productionGate.js`, Section 51)
- Moving an AI system to Approved/Production is blocked while it has an unapproved DPIA (when it processes
  personal data, makes automated decisions, or touches children's data), no human oversight on automated
  decisions, a children's-data + tracking/ads combination DPDP prohibits outright, an attested restricted
  country transfer, or a linked vendor with no signed DPA.
- A documented override (≥20 characters, audited as `AI_SYSTEM_GATE_OVERRIDDEN`) is available only to roles
  with `ai_system:gate_override` — a real bug caught by the test suite: the code checked this permission
  before it had been granted to any role, so overriding silently failed for everyone until fixed.

**Public rights-request portal** (`/portal/<org-slug>`, no login)
- A submitted request is stored `UNVERIFIED` and nothing is searched, exported, or erased until staff
  confirm identity on the new Data Principal Requests page and record *how* — otherwise anyone could file an
  erasure request in someone else's name. The DSAR opened on verification uses the original submission date
  for its due-date clock, not the (later) verification date.
- A requester gets a reference and a one-time status token to check progress without an account; the status
  endpoint reveals nothing on a wrong token, not even that the reference exists.
- Honeypot field for bot submissions (silently accepted, nothing stored) plus per-IP rate limits; no CAPTCHA
  and no email/SMS delivery — identity is verified by staff contacting the requester using the details they
  supplied, which is a real limitation worth knowing rather than a hidden one.
- A nominee-raised request is checked against the `Nominee` registry from Phase 9 (DPDP s.14) — the portal
  and the direct DSAR API share the exact same mismatch check.

**Testing.** 29 new real end-to-end tests (69 total) drive actual HTTP flows against live PostgreSQL: invite
→ accept → sign in, MFA enrolment and recovery-code use, session revocation, the org-wide MFA lockout and
self-recovery, the gate blocking a risky system and an audited override, and the full portal path from
submission through staff verification to a DSAR with the correct due date. Three of the new safety
properties (gate enforcement, nominee-identity matching, MFA-restriction enforcement) were deliberately
broken and confirmed to fail the right test, then restored. 38 UI tests continue to pass against the same
real backend, extended with coverage for the gate override dialog, inviting a user, the MFA toggle, and the
portal.

**Four more real bugs this phase's tests found** (beyond the ones Phase 12 found): consent-withdrawal DSARs
had no due date (only directly-created ones did); the dashboard's Shadow AI/DSAR/incident KPI cards were
still hardcoded `null` placeholders from Phase 1, now live counts; the gate-override permission was checked
but never actually granted to any role; and turning org-wide MFA back off never released the sessions it had
restricted, which would have locked out the very admin who tried to undo it.

## What Phase 12 did — running it for real

Until now the code had been compiled and unit-tested but never run as one system. This phase did that.

**Made it runnable here.** Prisma's engine download is blocked in the build sandbox, so the project moved to
Prisma 6.19's Rust-free client with the `pg` driver adapter (no engine binary at all — also better for
air-gapped/on-prem installs). The initial migration was generated by Prisma's own schema engine (run as
WebAssembly) and is committed. Prisma's WASM `migrate deploy` fails on a Postgres `name` column type, so
`npm run migrate` applies the committed migrations with plain `pg` and records them in Prisma's own
`_prisma_migrations` format (checksums, advisory lock, one transaction per migration, refuses edited
migrations). Use `prisma migrate dev` on a normal machine to *author* new migrations.

**What was actually exercised against real PostgreSQL 16 with the real Prisma client**

| Check | Result |
|---|---|
| Initial migration applied to a fresh database; re-run is a no-op; tampering refused | 30 tables, 31 enums |
| The seed script (never previously executed) | ran; idempotent on re-run |
| 16 end-to-end API tests (9 roles, every module's read endpoints, all 7 reports, DPIA / consent → DSAR → erasure / Shadow AI → incident / breach notification / decisions / dual-approval kill switch / evidence tamper / file scan + Find Me / RAG / vendors / webhooks / DPDP settings / audit trail / tenant isolation) | pass |
| 32 UI checks: the real Vue app + real Login form in jsdom against the real backend; every page renders seeded data with **zero Vue warnings**; every create form submitted; the connector added, tested and scanned through the UI | pass |
| The container entrypoint's actual commands: config guard → migrate → seed → serve; restart against the same DB | works |
| Mutation checks (re-introducing a bug makes the right tests fail) | confirmed for the new checks |

**Real bugs this found and fixed** (none were visible to compile-time checks or to the earlier fake-database tests)

1. **Most "create" forms failed unless every optional dropdown was filled** — the UI sends `null` for an
   unselected AI system / count and four endpoints (consents, incidents, knowledge bases, compliance controls)
   rejected it with "Invalid request". Fixed, with a server test posting exactly what the UI posts and a UI test per form.
2. **DSARs auto-created by a consent withdrawal had no due date** (only hand-created ones did).
3. **The sidebar listed several entries pointing at the same page** — two items highlighted at once and Vuetify
   warned about duplicate ids. Collapsed to one entry per destination.
4. **Dashboard placeholders** — four KPI cards still read "—  Phase N" for modules that exist, and flashed "Phase N"
   while loading. Now real counts (plus new cards for pending reviews and open incidents).
5. **Prisma 6 returns `Bytes` as `Uint8Array`** — evidence downloads would have been sent as JSON. Wrapped in a Buffer.
6. **Deployment ordering** — the container ran migrations before checking configuration, so a container with
   placeholder secrets touched the database before refusing to start. The check now runs first (verified: 0 tables created).

**Deployment artefacts.** `server/Dockerfile`, `client/Dockerfile` + `nginx.conf` (SPA + `/api` proxy, no CORS
needed), a full-stack `docker-compose.yml` (`docker compose up -d db` still gives just the dev database),
`.env.docker.example`, and a production guard that refuses to start with placeholder or missing secrets.

### Still NOT verified (be careful before relying on these)
* **A real browser.** The UI tests use jsdom: they prove the app boots, loads real data, renders, and that forms and
  buttons work, but not layout, CSS, responsive behaviour or native file pickers (file upload is covered at API level only).
* **Docker.** The Dockerfiles and compose file were never built or run (no Docker here); only the commands inside
  them were run on the host. The CI workflow has likewise not been run.
* Anything at scale: no load, concurrency or large-data testing. PostgreSQL versions other than 16, TLS to the
  database, and connector types other than PostgreSQL are untested.
* The fake-database route tests do not test SQL; the real-stack E2E tests do, but only for the flows they cover.

## What Phase 11 built — the first live connector

See `docs/connectors.md` for setup and limits. Summary:

| Item | What was built | Honest limits |
|---|---|---|
| **PostgreSQL connector** (Mode A) | Create → **Test** (real connection; only success flips it to Connected) → **Scan**. Read-only sessions enforced by Postgres itself, least-privilege guidance (warns on superuser / no TLS), SSRF guard, bounded (rows, tables, timeouts), sanitised errors, encrypted credentials with rotation, overlapping scans refused. | **Samples the first N rows** per table; PostgreSQL only; scans run synchronously. |
| **Hashed PII index** | Values read from a customer DB are stored only as per-tenant keyed HMACs. Find Me in AI and DSAR impact/erasure match through the same hash. | Exact matching only; key holder + candidate can test membership. |
| **Scan-completeness** | Every scan records `scanComplete`. Find Me returns **Not found only if every linked asset was fully scanned**, otherwise **Unknown with the reason**. | Bank-scale tables will mostly be "Sampled" until full-column streaming exists. |
| **Erasure verification** | DSAR *Delete* clears Privault's index; a rescan re-surfaces the subject if the source still holds them. | Verification is by rescan, not automatic. |
| **Tests** | 32 tests (was 21): 11 new ones run against a **real PostgreSQL 16** (read-only enforcement with a role that has INSERT rights, superuser warning, password never in errors, PII by method, incomplete tables, no clear-text PII stored, stable re-scan, erasure loop, credential rotation). Mutation-checked: breaking read-only, hashing, the completeness rule and the test-before-scan gate each makes the suite fail. Fixture: `server/test/fixtures/setup-pg.sh`. | Tests skip themselves if no Postgres is reachable. CI workflow is written but has not been run. |

### Corrections to earlier phases found while building this

1. **Find Me in AI overclaimed for large files.** The upload scanner indexes at most 2,000 rows /
   500 matches per column, yet an AI system linked to a bigger file could still be reported
   "Not found". Uploads now record `scanComplete` too, and incomplete ones can only yield Unknown.
2. **Absence rule tightened.** The first version of the completeness rule said "Not found" if *any*
   linked asset was complete; the connector tests showed that is wrong when another linked table was
   only sampled. It now requires *all* linked assets to be complete.
3. **Hung requests.** In Express 4 an async route that throws never responds. The app now routes
   those errors to the central handler (`express-async-errors`), and 5xx responses return a generic
   message (details stay in the server log) instead of the internal error text.

## What Phase 10 built — closing the Phase 8 gaps

| Item | What was built | Honest limits |
|---|---|---|
| **Vendor management** (Sec. 3) | `Vendor` register: category, country, sub-processor flag, DPA signed **with a date** (the API refuses "signed" without one), security review, risk tier. AI systems link to a vendor record; a linked vendor with no DPA adds a risk factor (DPDP s.8(2)). | Facts are recorded by people; Privault does not verify a DPA exists. |
| **Evidence management** (Sec. 29) | Upload (5 MB, allow-listed types) with SHA-256 computed at upload and **re-computed from the stored bytes on every download/verify** — a mismatch returns 409 and refuses the download. Evidence links to compliance controls / AI systems, has an expiry, and a review step where **the uploader cannot review their own upload**. Lists never return file bytes. | Bytes live in the database (fine for documents, not for large media — use object storage past that). The hash proves the file is unchanged since upload, not that its contents are true. |
| **Dual approval** (Sec. 26) | Stopping an AI system that is in Production is now *requested*, and only runs when a second, different person with `emergency:approve` approves it. Requester cannot approve; either side is audited. | Only `STOP_AI_SYSTEM` is executable at all — other actions remain `REQUIRES_INTEGRATION` as before. |
| **Event delivery** (Sec. 43) | Every audited action is also a webhook event. HMAC-SHA256 signed (`timestamp.body`), secrets AES-256-GCM encrypted and shown once, ids-only payloads (no personal data), SSRF guard (https only; private / loopback / link-local / metadata addresses refused; redirects not followed), delivery log. | Best-effort, at-most-once, **no retry queue**; DNS-rebinding between check and connect is not fully closed without IP pinning / an egress proxy. Put a broker behind this if you need guaranteed delivery. |
| **Automated tests** | `npm test` (Node built-in runner, no extra deps): 13 library tests + 8 route-level tests that drive the real routers and RBAC over HTTP against an in-memory database stand-in, covering dual control, separation of duties, tamper detection, minor consent, breach closure, tenant isolation and SSRF. Mutation-checked: deliberately breaking three of those rules makes the suite fail. | The stand-in is not Postgres: it does not test SQL, migrations or query performance. There are no browser/UI tests. |
| **Schema validation** | The full Prisma schema (30 models) now passes the real `prisma validate`. | — |

## What Phase 9 built — DPDP Act, 2023 specifics

Added after the original spec, scoped strictly to obligations that come from
the DPDP Act itself (not RBI or other sector rules). Same honesty rule as
every prior phase.

| DPDP provision | What was built | Real vs. attested |
|---|---|---|
| s.9 Children's data | `processesChildrensData` / `behavioralTrackingOrAds` on AI systems; `isMinorDataSubject` / `parentalConsentVerified` on consents. The API **refuses** to record a minor's consent as Granted without parental verification. Risk engine adds two mutually-exclusive factors (children's data; children's data + tracking/ads, weighted higher). | Enforced in code. Age itself is asserted by whoever records it — Privault has no age-verification signal. |
| s.14 Right to nominate | `Nominee` model + registry; a DSAR can be raised "via nominee" and the API rejects a nominee registered for a different data principal. | Real. |
| s.8(6) Personal data breach | Incident fields: `isPersonalDataBreach`, affected count, Board / data-principal notified timestamps. **An incident flagged as a breach cannot be closed until both notifications are recorded.** New `DPDP Breach Register` CSV report. | Privault does not notify the Board or users itself — it records that a human did, and when. |
| s.8(9) DPO contact | DPO name/email/phone on the tenant, editable in DPDP Settings. | Real. |
| s.10 Significant Data Fiduciary | SDF designation flag, independent-auditor name, last/next audit dates, and a derived obligations checklist (DPO, auditor, audit, approved DPIA). | Self-reported; Privault cannot verify a government notification or an auditor's work. |
| s.8(7) Erasure when purpose served | Structured `retentionPeriodDays` on AI systems; monitoring flags systems whose period has elapsed since record creation. | A prompt to review erasure, not proof data is still held (legal-hold exceptions apply). |
| s.16 Cross-border | `crossBorderRestrictedCountry` self-attestation feeding the risk engine. | Deliberately **not** a hard-coded country list — the notified list can change and Privault has no live feed of it. |
| s.6 / rights timelines | DSARs auto-get a due date from a per-tenant `dsarResponseDays` setting; overdue DSARs are flagged in the list and monitoring. | Configurable target. Confirm exact periods for each request type against the notified DPDP Rules — Privault cannot verify what is current. |

Explicitly **not** built: a Consent Manager integration (the DPDP Consent
Manager registration framework is an external ecosystem this deployment has
no connection to), Data Protection Board complaint filing, and automatic
notification delivery. All timelines and thresholds above should be
confirmed against the currently notified Rules by counsel.

## What Phase 5–7 actually built

**AI Risk** (Section 19) — `server/src/lib/riskEngine.js`: a real,
unit-tested weighted-factor scorer (personal/sensitive data, automated
decisions without human oversight, cross-border transfer, training/RAG
usage, external vendor, missing DPIA). `POST /ai-systems/:id/assess-risk`
computes a classification **and** names every factor that fired — never an
opaque number. Verified during this build to correctly separate a
deliberately "risky" fake AI system (scored CRITICAL, 6 factors fired) from
a clean one (scored 0, UNCLASSIFIED).

**DPIA workflow** (Section 20) — `Dpia` model, 17-section structure
pre-filled by `dpiaTemplate.js` from data the platform already has (AI
system fields + the risk engine's output) rather than asked for twice.
Draft → submit → approve/reject, with approved DPIAs made immutable at the
API level.

**Compliance framework mapping** (Section 52) — `ComplianceControl` model
keeps `controlType` (legal requirement / org policy / framework control /
recommended practice) as a required, distinct field, exactly as the spec
insists these must never be conflated.

**Automated Decisions, Human Review, Appeals** (Sections 21–23) —
`AutomatedDecision` + `Appeal` models. A human reviewer can approve, reject
(reason required), override (reason required), or escalate a pending
decision; a data subject's appeal moves through submitted → under
investigation → decided, each step audited.

**Incidents** (Section 24) — `Incident` model with a linear, enforced
workflow (Detected → Classified → Contained → Investigating → Remediated →
Reviewed → Closed) — the API refuses to let a status skip ahead. Wired to
Phase 4: a Shadow AI event whose matched policy says `CREATE_INCIDENT` now
genuinely opens one, instead of the action just being a label on the event.

**Emergency Controls / Kill Switch** (Sections 25–26) — `EmergencyAction`
model. `STOP_AI_SYSTEM` is real: it sets `AiSystem.status = SUSPENDED`,
because that's the one lifecycle field Privault actually owns. Every other
action type (`DISABLE_API`, `REVOKE_CREDENTIAL`, `STOP_DATA_FEED`,
`DISABLE_AGENT`, `DISABLE_RAG`, `ROLLBACK_MODEL`, `ISOLATE_SERVICE`) is
logged as `REQUIRES_INTEGRATION` — Section 25's literal instruction
("CONTROL AVAILABLE — INTEGRATION REQUIRED... never simulate successful
execution") is enforced in the route handler, not just written in a
tooltip.

**Monitoring** (Section 27) — implemented as a `GET /monitoring` endpoint
that live-aggregates real counts across every prior phase's tables (new AI
systems, Shadow AI severity, PII uploads, consent withdrawals, pending
remediations, open DSARs, pending reviews, open incidents, missing DPIAs,
policy violations) — no new table, no cached/stale numbers.

## What Phase 8 actually built (partial)

- **Reporting** (Section 41) — `GET /reports/:type` generates six CSV
  reports (AI Inventory, AI Risk, Shadow AI, DSAR, Incidents, Audit
  Evidence) live from the database on each request, using a small
  dependency-free CSV writer (`server/src/lib/csv.js`, verified during this
  build to correctly escape commas and embedded quotes).
- **Security hardening** (Section 38, partial) — `helmet` for secure
  headers and `express-rate-limit` (300 req/15min/IP) are real middleware
  in `server/src/index.js`, not a checklist item.

Not done in Phase 8 (Vendors, Evidence and the event bus were subsequently built in Phase 10): a public/partner-facing API (Section 42, distinct from this app's own internal API), multi-region/on-premise deployment tooling (Section 36), and load/performance testing.

## What Phase 2–4 built (kept for history)

See git history / earlier revisions of this file for the phase-by-phase
detail on Data Discovery's PII engine (regex + Luhn/Verhoeff checksums +
dictionary matching), the Privacy Graph + Find Me in AI, the Consent →
DSAR → remediation pipeline, RAG Governance's real chunking, and Shadow
AI's policy engine — all still live in the code, just summarized here for
space. The short version: every one of those follows the same real-vs-
requires-integration split as everything above.

## What would make this production-ready next

Not a "phase" from the spec, but the honest next steps for anyone taking
this further, in roughly the order they'd matter:

1. **More live connectors** — Phase 11 built one (PostgreSQL, sampled rows
   only). Every other Mode A/B integration — MySQL/SQL Server/Oracle,
   cloud storage, vector stores, IAM, API gateways, Kubernetes — is still
   `NOT_CONFIGURED`/`REQUIRES_INTEGRATION`, and full (not sampled) column
   coverage for the connectors that do exist. This is the single largest
   remaining body of work, and it's infrastructure-specific per customer.
2. **Anchor the audit chain's head externally** — Phase 13's hash chain
   proves nothing *inside* the stored log was altered, but can't alone
   prove the *most recent* entries weren't removed wholesale. `GET
   /audit-logs/verify` returns a `head` hash; nothing yet posts it
   somewhere outside this database (a ticket, signed email, WORM storage)
   on a schedule.
3. **Shadow AI client software** — a real browser extension and endpoint
   agent (Section 16). Separate deployable artifacts from this backend;
   Phase 4 only built the server side that would receive their events.
4. **NLP/ML-based PII detection** for free text and unstructured documents,
   beyond the current regex/checksum/dictionary engine.
5. **Database-backed RBAC** (`roles`/`permissions` tables) instead of the
   static permission map — the `requirePermission()` call sites don't need
   to change when this happens.
6. **Global search and the AI governance assistant** (Sections 33, 48) —
   not started. Every module is searchable individually; there's no
   cross-module search or natural-language query surface.
7. **Remaining reports** (Section 41 lists 11; 7 exist) and non-CSV export
   formats (PDF, Excel).
8. **Actually build and run the Docker images and CI workflow** — both are
   written (Phase 12) but this environment has no Docker, so neither has
   been built or executed, only the commands inside them run directly on
   the host.
9. **Load testing and horizontal scaling** — nothing in this build has been
   tested past the single-tenant demo-data scale, and the connector scan
   endpoint in particular runs synchronously with no job queue.
