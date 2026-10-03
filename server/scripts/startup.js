#!/usr/bin/env node

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
          new Error(
            `${command} ${args.join(' ')} exited with code ${code}`
          )
        );
      }
    });
  });
}

async function main() {
  console.log('========================================');
  console.log(' Privault AI Governance - Startup');
  console.log('========================================');

  // 1. Create/update the SQLite schema
  console.log('\n[1/3] Preparing SQLite database...');
  await run('npx', ['prisma', 'db', 'push']);

  // 2. Automatically load the predefined dataset
  console.log('\n[2/3] Loading predefined dataset...');
  await run('node', ['prisma/seed.js']);

  // 3. Start the application
  console.log('\n[3/3] Starting application...');
  await run('node', ['src/index.js']);
}

main().catch((error) => {
  console.error('\n========================================');
  console.error(' STARTUP FAILED');
  console.error('========================================');
  console.error(error);

  process.exit(1);
});