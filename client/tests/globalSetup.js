// Prepares a real backend for the UI smoke test: scratch database -> migrations -> real seed ->
// real API server on :4100. If PostgreSQL (or the server's dependencies) are not available the UI
// test detects that and skips itself.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../server');
let child;

async function healthy() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://127.0.0.1:4100/health')).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

export default async function setup() {
  const admin = process.env.E2E_ADMIN_URL || 'postgresql://privault:privault@127.0.0.1:5432/postgres';
  const dbUrl = admin.replace(/\/[^/]*$/, '/privault_ui');
  const env = { ...process.env, DATABASE_URL: dbUrl, JWT_SECRET: 'ui-secret', PORT: '4100', CORS_ORIGIN: 'http://localhost:5173', RATE_LIMIT_MAX: '100000', CONNECTOR_ALLOW_PRIVATE: 'true' };
  try {
    execFileSync('node', ['-e', "const {Client}=require('pg');(async()=>{const c=new Client({connectionString:process.argv[1]});await c.connect();await c.query('DROP DATABASE IF EXISTS privault_ui');await c.query('CREATE DATABASE privault_ui');await c.end()})()", admin], { cwd: serverDir, stdio: 'pipe' });
    execFileSync('node', ['scripts/migrate.js'], { cwd: serverDir, env, stdio: 'pipe' });
    execFileSync('node', ['prisma/seed.js'], { cwd: serverDir, env, stdio: 'pipe' });
    child = spawn('node', ['src/index.js'], { cwd: serverDir, env, stdio: 'ignore' });
    if (!(await healthy())) console.warn('[ui-smoke] backend did not become healthy');
  } catch (e) {
    console.warn('[ui-smoke] backend not started — UI smoke test will skip:', String(e.message).split('\n')[0]);
  }
  return async () => { if (child) child.kill(); };
}
