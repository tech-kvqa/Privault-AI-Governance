#!/usr/bin/env node
// Onboards a new organisation: creates the tenant and its first Super Admin (as an invitation — no password
// is ever chosen for anyone). Privault has no platform-operator UI; this is the supported way to add a tenant.
//   node scripts/create-tenant.js --name "Example Bank" --slug example-bank --admin-email ceo@example.com --admin-name "A. Person"
require('dotenv').config();
const crypto = require('crypto');
const prisma = require('../src/lib/prisma');
const { hashPassword } = require('../src/lib/password');
const { newToken, hashToken } = require('../src/lib/tokens');
const { appendAudit } = require('../src/lib/auditChain');

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const name = arg('name'), slug = (arg('slug') || '').toLowerCase(), email = (arg('admin-email') || '').toLowerCase(), adminName = arg('admin-name');
  if (!name || !slug || !email || !adminName) throw new Error('Usage: create-tenant.js --name <org> --slug <handle> --admin-email <email> --admin-name <name>');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/.test(slug)) throw new Error('slug must be lowercase letters, digits and hyphens (max 60)');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('admin-email is not a valid email');
  if (await prisma.tenant.findUnique({ where: { slug } })) throw new Error(`An organisation with slug "${slug}" already exists`);

  const tenant = await prisma.tenant.create({ data: { name, slug } });
  const user = await prisma.user.create({
    data: { tenantId: tenant.id, email, name: adminName, role: 'SUPER_ADMIN', isActive: false, passwordHash: await hashPassword(crypto.randomBytes(24).toString('hex')) },
  });
  const token = newToken();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  await prisma.userToken.create({ data: { tenantId: tenant.id, userId: user.id, type: 'INVITE', tokenHash: hashToken(token), expiresAt } });
  await appendAudit({ tenantId: tenant.id, userId: null, role: 'SYSTEM', action: 'TENANT_CREATED', objectType: 'Tenant', objectId: tenant.id, newValue: { name, slug }, source: 'cli' });

  console.log(`Created organisation "${name}" (${slug}) and Super Admin ${email}.`);
  console.log(`Give the administrator this one-time link (valid 72h, shown only now):`);
  console.log(`  <your-app-url>/accept-invite?token=${token}`);
  console.log(`Public rights-request portal: <your-app-url>/portal/${slug}`);
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error('Error:', e.message); await prisma.$disconnect().catch(() => {}); process.exit(1); });
