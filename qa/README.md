# PRIVault AI Governance — Docker QA Test Kit

This kit provides a reproducible PostgreSQL-backed test environment so the full server and Vue UI test suites can be executed without installing PostgreSQL or Node dependencies on the host.

## Prerequisite

Install Docker Desktop (Windows/macOS) or Docker Engine + Compose (Linux).

A repo-root `.dockerignore` excludes `node_modules`, `.env` files, and build output from the QA image's build context — without it, a host `node_modules/` or a developer's `.env` could silently override the clean `npm ci` install inside the container, or leak secrets into the image.

## Run the complete QA suite

From the repository root:

```bash
docker compose -f qa/docker-compose.qa.yml up --build --abort-on-container-exit --exit-code-from qa
```

The QA container will:

1. install the exact server and client dependencies from the lockfiles;
2. wait for PostgreSQL;
3. create the `bank_demo` connector fixture;
4. run JavaScript syntax checks;
5. run the complete server test suite against real PostgreSQL;
6. run the Vue/Vuetify UI suite, whose global setup creates a real test DB, runs migrations + seed, starts the real backend, and drives the frontend test suite.

## Keep database data

The QA compose file uses PostgreSQL `tmpfs`, so the database is disposable. This is intentional for clean regression runs.

## If the suite fails

The final exit code is non-zero. The terminal output contains the exact failing test. Do not change tests just to make them green; fix the application and rerun.

## Optional full application stack

The repository's existing root `docker-compose.yml` can still be used for the actual application:

```bash
cp .env.docker.example .env
docker compose up --build
```

Then open `http://localhost:8080`.
