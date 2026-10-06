#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let applicationRoot;
let nodeExecutable = process.execPath;
let installedDataPath;
let portableBrowserPath;
let bundled = false;
try {
  await fs.access(path.join(skillRoot, 'bundle.json'));
  bundled = true;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!bundled) try {
  await fs.access(path.resolve(skillRoot, '../../.claude-plugin/plugin.json'));
  // A source plugin has no compiled output in Git. Prepare it outside the plugin cache.
  bundled = true;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (bundled) try {
  const { prepareRuntime } = await import('./runtime.mjs');
  const runtime = await prepareRuntime();
  applicationRoot = runtime.applicationRoot;
  installedDataPath = runtime.dataPath;
  portableBrowserPath = runtime.browserPath;
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exit(4);
}
if (!applicationRoot) try {
  const installation = JSON.parse(await fs.readFile(path.join(skillRoot, 'install.json'), 'utf8'));
  if (installation.application !== 'sketch-diagram' || !path.isAbsolute(installation.applicationRoot)) throw new Error('Invalid diagram installation metadata.');
  applicationRoot = installation.applicationRoot;
  nodeExecutable = installation.nodeExecutable || nodeExecutable;
  installedDataPath = installation.dataPath;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  applicationRoot = path.resolve(skillRoot, '..', '..');
}
const executable = path.join(applicationRoot, 'bin', 'sketch-diagram.mjs');
try {
  await fs.access(executable);
  await fs.access(path.join(applicationRoot, 'dist', 'src', 'cli.js'));
} catch {
  process.stderr.write('The diagram application moved or has not been built. Run npm run build and npm run install:local from the application directory.\n');
  process.exit(4);
}
const environment = { ...process.env };
if (!environment.SKETCH_DIAGRAM_DATA && installedDataPath) environment.SKETCH_DIAGRAM_DATA = installedDataPath;
if (!environment.PLAYWRIGHT_BROWSERS_PATH && portableBrowserPath) environment.PLAYWRIGHT_BROWSERS_PATH = portableBrowserPath;
const child = spawn(nodeExecutable, [executable, ...process.argv.slice(2)], { stdio: 'inherit', env: environment });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { process.stderr.write(`${error.message}\n`); process.exitCode = 4; });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 4;
});
