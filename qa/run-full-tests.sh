#!/usr/bin/env bash
set -uo pipefail

SERVER_DIR=/workspace/server
CLIENT_DIR=/workspace/client
DB_HOST="${PGHOST:-db}"
DB_PORT="${PGPORT:-5432}"
DB_USER="${PGUSER:-privault}"
DB_PASSWORD="${PGPASSWORD:-privault}"
DB_NAME="${PGDATABASE:-privault_ai_governance}"
export E2E_ADMIN_URL="${E2E_ADMIN_URL:-postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/postgres}"
export DATABASE_URL="${DATABASE_URL:-postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}}"
export JWT_SECRET="${JWT_SECRET:-qa-test-secret-please-change-32-chars-min}"
export WEBHOOK_ENC_KEY="${WEBHOOK_ENC_KEY:-0123456789abcdef0123456789abcdef}"
export PII_INDEX_KEY="${PII_INDEX_KEY:-abcdef0123456789abcdef0123456789}"
export NODE_ENV=test

wait_for_db() {
  echo "[qa] Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
  for i in $(seq 1 60); do
    if PGPASSWORD="$DB_PASSWORD" pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres >/dev/null 2>&1; then
      echo "[qa] PostgreSQL is ready."
      return 0
    fi
    sleep 1
  done
  echo "[qa] PostgreSQL did not become ready."
  return 1
}

wait_for_db || exit 2

echo "[qa] Preparing connector fixture..."
PGHOST="$DB_HOST" PGPORT="$DB_PORT" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD" \
  bash "$SERVER_DIR/test/fixtures/setup-pg.sh"

# Verify the current source before executing tests.
echo "[qa] JavaScript syntax check..."
find "$SERVER_DIR/src" "$CLIENT_DIR/src" -name '*.js' -print0 | xargs -0 -n1 node --check

printf '\n[qa] ===== SERVER TESTS =====\n'
(cd "$SERVER_DIR" && npm test)
SERVER_RC=$?

printf '\n[qa] ===== CLIENT/UI TESTS =====\n'
# globalSetup starts the real backend in this same container and uses E2E_ADMIN_URL.
(cd "$CLIENT_DIR" && npm test)
CLIENT_RC=$?

printf '\n[qa] ===== RESULT =====\n'
if [ "$SERVER_RC" -eq 0 ] && [ "$CLIENT_RC" -eq 0 ]; then
  echo "[qa] ALL TEST SUITES PASSED"
  exit 0
fi

echo "[qa] SERVER_TEST_EXIT=$SERVER_RC"
echo "[qa] CLIENT_TEST_EXIT=$CLIENT_RC"
exit 1
