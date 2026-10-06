#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { prepareRuntime } from './runtime.mjs';

try {
  const options = process.argv.slice(2);
  if (options.some(option => !['--browser', '--json'].includes(option))) throw new Error('Usage: node scripts/setup.mjs [--browser] [--json]');
  const runtime = await prepareRuntime();
  if (options.includes('--browser')) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(runtime.applicationRoot, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium'], {
        stdio: ['ignore', 'stderr', 'stderr'], env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: runtime.browserPath },
      });
      child.on('error', reject);
      child.on('exit', code => resolve(code));
    });
    if (code !== 0) throw new Error('Chromium installation failed. Use draft SVG mode or resolve browser/network requirements.');
  }
  process.stdout.write(JSON.stringify({ status: 'prepared', ...runtime, browserInstallRequested: options.includes('--browser') }, null, 2) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'runtime_unavailable', message: error.message }) + '\n');
  process.exitCode = 4;
}
