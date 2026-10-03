#!/usr/bin/env node

require('dotenv').config();

const { spawn } = require('child_process');

function run(command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n> ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32'
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`${command} ${args.join(' ')} exited with code ${code}`)
        );
      }
    });
  });
}

async function main() {
  console.log('========================================');
  console.log(' Privault AI Governance - Startup');
  console.log('========================================');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured.');
  }

  /*
   * 1. Apply database migrations.
   *
   * Your project already has scripts/migrate.js which applies
   * the committed Prisma migrations safely.
   */
  console.log('\n[1/3] Applying database migrations...');
  await run('node', ['scripts/migrate.js']);

  /*
   * 2. Load the predefined demo dataset.
   *
   * This is your existing prisma/seed.js.
   *
   * It is intentionally run every time the server starts because
   * you want a fresh Render database/session to automatically
   * contain the predefined dataset.
   */
  console.log('\n[2/3] Loading predefined demo dataset...');
  await run('node', ['prisma/seed.js']);

  /*
   * 3. Start the actual Express application.
   */
  console.log('\n[3/3] Starting Privault AI Governance server...');

  await run('node', ['src/index.js']);
}

main().catch((error) => {
  console.error('\nStartup failed:');
  console.error(error);
  process.exit(1);
});