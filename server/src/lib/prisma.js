require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

// Local development uses SQLite. Production keeps the original PostgreSQL
// schema/adapter configuration separately (see prisma/schema.postgres.prisma).
module.exports = new PrismaClient();
