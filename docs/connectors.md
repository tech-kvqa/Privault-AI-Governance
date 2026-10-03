# Live PostgreSQL connector (Phase 11)

The first connector that reads a customer system directly (master spec Mode A).

## 1. Create a least-privilege role in the database you want to scan

```sql
CREATE ROLE privault_scanner LOGIN PASSWORD '<strong password>';
GRANT CONNECT ON DATABASE <db> TO privault_scanner;
GRANT USAGE ON SCHEMA public TO privault_scanner;            -- repeat per schema
GRANT SELECT ON ALL TABLES IN SCHEMA public TO privault_scanner;
```

The scanner only sees tables and columns the role can see, so **grant SELECT only on what
should be scanned**. Privault warns if you connect as a superuser or with TLS off.

## 2. Add it in Privault → Connectors

Prefer TLS `verify-full`. `require` encrypts but does not verify the server certificate.
The password is encrypted at rest (AES-256-GCM) and is never returned by the API.
For databases on a private network set `CONNECTOR_ALLOW_PRIVATE=true` on the server.

## 3. Test, then scan

A connector is **Not configured** until *Test* succeeds. A scan then:

* opens a session in `BEGIN READ ONLY` with `default_transaction_read_only=on` — Postgres
  itself rejects writes (verified by a test using a role that *has* INSERT privilege);
* reads the **first N rows** (default 1000, max 2000) of each visible table, values cut to
  200 characters, up to 200 tables, 30 s per query;
* classifies columns with the same engine as file uploads (regex, Luhn/Verhoeff checksums,
  column-name dictionary);
* stores each personal-data value only as a **keyed HMAC-SHA256** (per-tenant key from
  `PII_INDEX_KEY`) — Privault holds no readable copy;
* links only tables that actually contain personal data to the chosen AI system;
* re-scans update assets in place, so DSAR and lineage references stay valid.

## What this can and cannot tell you

| Question | Answer |
|---|---|
| "Is this identifier in a table I scanned completely?" | Yes — Find Me in AI reports **Found**. |
| "Is it absent?" | Only if **every** data asset linked to the AI system was scanned completely. |
| A table larger than the row limit | Marked **Sampled**. Find Me reports **Unknown** for any system linked to it — never "Not found". |
| Phone written `+91 98…` vs `98…` | Different values: matching is exact after trim + lower-casing. |
| Free-text columns (notes, comments) | Not classified as PII, so not indexed. |

**Erasure verification loop.** A DSAR *Delete* removes the subject from **Privault's index
only**. Rescan the connector afterwards: if the source database still holds the person,
they reappear in Find Me in AI — that is your evidence the source erasure was not done.

## Known limits (be aware before relying on it)

* **Sampling, not full coverage.** On real bank-sized tables almost everything will be
  *Sampled*, so Find Me will mostly answer Unknown. Full-column streaming into the hashed
  index (server-side cursor, classify on a sample, hash every value of classified columns)
  is the natural next step.
* **Synchronous scans.** The HTTP request stays open for the whole scan. Large estates need
  a background job queue.
* **PostgreSQL only.** MySQL, SQL Server, Oracle, MongoDB, S3/Blob, Snowflake and vector
  stores are still `NOT_CONFIGURED`.
* Anyone holding `PII_INDEX_KEY` *and* a candidate identifier can test whether it is in the
  index. Keep the key secret and separate from `JWT_SECRET`.
