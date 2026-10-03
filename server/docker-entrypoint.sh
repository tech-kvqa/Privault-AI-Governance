#!/bin/sh
# Validates configuration, applies committed migrations, optionally loads demo data, then starts the API.
set -e
# Fail fast on placeholder secrets BEFORE touching the database.
node -e "try { require('./src/lib/config').assertProductionConfig(); } catch (e) { console.error(e.message); process.exit(1); }"
node scripts/migrate.js
if [ "$SEED_DEMO" = "true" ]; then
  echo "SEED_DEMO=true — loading demo data (demo users share a well-known password; never use in production)"
  node prisma/seed.js
fi
exec node src/index.js
