#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applicationFiles, sourceNames } from '../skill/diagram/scripts/application-files.mjs';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'sketch-claude-plugin-test-'));
const source = path.join(temporary, 'source');
const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(temporary, 'claude-config'),
  CLAUDE_CODE_PLUGIN_CACHE_DIR: path.join(temporary, 'claude-config', 'plugins'),
  SKETCH_DIAGRAM_CACHE: path.join(temporary, 'runtime-cache'), SKETCH_DIAGRAM_DATA: path.join(temporary, 'data'),
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(root, '.local/browsers'),
  DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' };
async function copy(relative) {
  const destination = path.join(source, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, relative), destination);
}
async function copySkill(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const filename = path.join(relative, entry.name);
    if (entry.isDirectory()) await copySkill(filename);
    else if (entry.isFile()) await copy(filename);
    else throw new Error('Unexpected skill symlink: ' + filename);
  }
}
const claude = args => execute('claude', ['plugin', ...args], { cwd: temporary, env, maxBuffer: 4 * 1024 * 1024 });
const run = async (script, args = []) => JSON.parse((await execute(process.execPath, [script, ...args],
  { cwd: temporary, env, maxBuffer: 8 * 1024 * 1024 })).stdout);
try {
  for (const filename of [...applicationFiles, ...sourceNames.map(name => 'src/' + name + '.ts'),
    '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']) await copy(filename);
  await copySkill('skill/diagram');
  await claude(['validate', source]);
  await claude(['validate', path.join(source, '.claude-plugin/plugin.json')]);
  await claude(['marketplace', 'add', source]);
  await claude(['install', 'sketch-diagram@sketch-diagram-marketplace', '--scope', 'user']);
  const listed = JSON.parse((await claude(['list', '--json'])).stdout);
  const installed = (Array.isArray(listed) ? listed : listed.installed).find(plugin => plugin.id === 'sketch-diagram@sketch-diagram-marketplace');
  assert(installed, JSON.stringify(listed));
  assert(installed.enabled);
  const details = (await claude(['details', 'sketch-diagram'])).stdout;
  assert(details.includes('diagram'), details);
  const pluginRoot = installed.installPath;
  assert(pluginRoot, JSON.stringify(installed));
  const beforeSetup = (await readdir(pluginRoot)).sort();
  const skill = path.join(pluginRoot, 'skill', 'diagram');
  const setup = await run(path.join(skill, 'scripts/setup.mjs'), ['--json']);
  assert(setup.applicationRoot.startsWith(env.SKETCH_DIAGRAM_CACHE + path.sep));
  assert.deepEqual(await readFile(path.join(setup.applicationRoot, 'package-lock.json')), await readFile(path.join(root, 'package-lock.json')));
  const again = await run(path.join(skill, 'scripts/setup.mjs'), ['--json']);
  assert.equal(again.applicationRoot, setup.applicationRoot);
  assert.deepEqual((await readdir(pluginRoot)).sort(), beforeSetup, 'Runtime preparation changed the installed plugin directory');
  // Claude itself may install package dependencies during plugin installation.
  for (const directory of ['dist', '.installation.json']) {
    assert(!beforeSetup.includes(directory), 'Claude installation produced ' + directory + ' in ' + pluginRoot);
  }
  const launcher = path.join(skill, 'scripts/launcher.mjs');
  const doctor = await run(launcher, ['doctor', '--json']);
  assert.equal(doctor.status, 'ok');
  const created = await run(launcher, ['create', '--spec', path.join(setup.applicationRoot, 'fixtures/concept-map.json'), '--json']);
  const rendered = await run(launcher, ['render', '--diagram', created.diagramId, '--json']);
  assert.equal(rendered.status, 'rendered');
  await claude(['uninstall', 'sketch-diagram@sketch-diagram-marketplace']);
  await access(created.artifacts.spec);
  await access(setup.applicationRoot);
  process.stdout.write(JSON.stringify({ status: 'passed', checks: ['Claude manifest validation',
    'isolated marketplace add/install', 'plugin skill discovery', 'source runtime build and reuse',
    'unchanged lockfile', 'setup leaves plugin unchanged', 'doctor/create/render', 'uninstall preserves diagrams'] }, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
