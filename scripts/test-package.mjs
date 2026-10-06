#!/usr/bin/env node
import assert from 'node:assert/strict';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'sketch-package-test-'));
const env = { ...process.env, SKETCH_DIAGRAM_CACHE: path.join(temporary, 'cache'),
  SKETCH_DIAGRAM_DATA: path.join(temporary, 'data'), PLAYWRIGHT_BROWSERS_PATH: path.join(temporary, 'missing-browser') };
const run = async (script, args = [], environment = env) => JSON.parse((await execute(process.execPath,
  [script, ...args], { cwd: temporary, env: environment, maxBuffer: 8 * 1024 * 1024 })).stdout);
try {
  const manifest = JSON.parse(await readFile(path.join(root, 'artifacts/packages/manifest.json'), 'utf8'));
  for (const bundle of manifest.bundles) {
    const filename = path.join(root, 'artifacts/packages', bundle.file);
    const bytes = await readFile(filename);
    assert.equal(bytes.length, bundle.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), bundle.sha256);
    const destination = path.join(temporary, bundle.file);
    await execute('python3', ['-c',
      'import zipfile,sys,pathlib\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert all(not pathlib.PurePosixPath(n).is_absolute() and ".." not in pathlib.PurePosixPath(n).parts for n in z.namelist())\n z.extractall(sys.argv[2])',
      filename, destination]);
  }
  const skill = path.join(temporary, 'diagram-skill.zip', 'diagram');
  const plugin = path.join(temporary, 'sketch-diagram-plugin.zip');
  const pluginMetadata = JSON.parse(await readFile(path.join(plugin, 'plugin.json'), 'utf8'));
  assert.equal(pluginMetadata.name, 'sketch-diagram');
  const claudeMetadata = JSON.parse(await readFile(path.join(plugin, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(claudeMetadata.name, 'sketch-diagram');
  assert.equal(claudeMetadata.skills, './skills/');
  const setup = path.join(skill, 'scripts/setup.mjs');
  // Repeated/concurrent preparation must reuse a complete runtime outside the skill.
  const prepared = await Promise.all([run(setup), run(setup)]);
  assert.equal(prepared[0].applicationRoot, prepared[1].applicationRoot);
  const runtime = prepared[0].applicationRoot;
  assert(runtime.startsWith(env.SKETCH_DIAGRAM_CACHE + path.sep));
  assert.equal((await run(path.join(plugin, 'skills/diagram/scripts/setup.mjs'))).applicationRoot, runtime);
  for (const name of ['.installation.json', 'installation.json', '.local', 'artifacts', '.git']) {
    await assert.rejects(access(path.join(runtime, name)), error => error.code === 'ENOENT');
  }
  assert.deepEqual(await readFile(path.join(runtime, 'package-lock.json')), await readFile(path.join(root, 'package-lock.json')));
  for (const filename of ['src/cli.ts', 'dist/src/cli.js']) {
    assert.deepEqual(await readFile(path.join(runtime, filename)), await readFile(path.join(root, filename)));
  }
  const svgScript = path.join(skill, 'scripts/render-svg.mjs');
  const fixture = path.join(runtime, 'fixtures/concept-map.json');
  const draft = await run(svgScript, ['--spec', fixture, '--out', path.join(temporary, 'draft')]);
  assert.equal(draft.status, 'draft_svg');
  assert.equal(draft.visualReview, 'unavailable');
  assert((await readFile(draft.artifacts['diagram.svg'], 'utf8')).includes('data:font/ttf;base64,'));
  await assert.rejects(run(svgScript, ['--spec', fixture, '--out', path.join(temporary, 'draft')]));
  const revised = await run(svgScript, ['--spec', fixture, '--out', path.join(temporary, 'draft-again'),
    '--previous-layout', draft.artifacts['layout.json']]);
  assert.deepEqual(JSON.parse(await readFile(revised.artifacts['layout.json'], 'utf8')),
    JSON.parse(await readFile(draft.artifacts['layout.json'], 'utf8')));
  const canvas = await run(svgScript, ['--spec', path.join(runtime, 'fixtures/canvas-overview-detail.json'),
    '--out', path.join(temporary, 'canvas')]);
  assert.equal(canvas.status, 'draft_svg');
  assert(Object.keys(canvas.artifacts).some(name => name.startsWith('frames/')));
  const launcher = path.join(skill, 'scripts/launcher.mjs');
  assert.equal((await run(launcher, ['validate', '--spec', fixture, '--json'])).status, 'valid');
  // A corrupt bundle must fail even when a healthy cached runtime already exists.
  const archive = path.join(skill, 'assets/runtime.tar.gz');
  const original = await readFile(archive);
  try {
    await writeFile(archive, 'damaged archive');
    await assert.rejects(run(setup), error => error.stdout.includes('checksum mismatch'));
    await assert.rejects(run(launcher, ['validate', '--spec', fixture]), error => error.stderr.includes('checksum mismatch'));
  } finally { await writeFile(archive, original); }
  const browserEnv = { ...env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(root, '.local/browsers') };
  const doctor = await run(launcher, ['doctor', '--json'], browserEnv);
  assert.equal(doctor.status, 'ok');
  assert.equal(doctor.checks.find(check => check.name === 'integration').mode, 'portable_bundle');
  const created = await run(launcher, ['create', '--spec', fixture, '--json'], browserEnv);
  const rendered = await run(launcher, ['render', '--diagram', created.diagramId, '--json'], browserEnv);
  assert.equal(rendered.status, 'rendered');
  const inspected = await run(launcher, ['inspect', '--diagram', created.diagramId, '--revision', created.revisionId, '--json'], browserEnv);
  assert.equal(inspected.status, 'awaiting_visual_review');
  assert(inspected.screenshots.images.some(image => image.kind === 'overview'));
  const exported = await run(launcher, ['export', '--diagram', created.diagramId, '--draft', '--revision', created.revisionId, '--format', 'svg,png', '--json'], browserEnv);
  assert.equal(exported.status, 'unverified');
  assert.equal((await readFile(exported.artifacts.png)).toString('hex', 0, 8), '89504e470d0a1a0a');
  const qa = path.join(root, 'artifacts/packages/qa');
  await mkdir(qa, { recursive: true });
  await copyFile(exported.artifacts.png, path.join(qa, 'concept-map.png'));
  // Keep evidence for human/agent inspection without distributing it.
  process.stdout.write(JSON.stringify({ status: 'passed', checks: [
    'ZIP layout and hashes', 'isolated offline runtime and concurrent setup', 'unchanged lockfile',
    'diagram and canvas draft SVGs', 'layout reuse and overwrite refusal', 'checksum failure',
    'portable doctor', 'create/render/inspect and draft SVG/PNG exports',
  ], screenshot: path.join(qa, 'concept-map.png') }, null, 2) + '\n');
} finally { await rm(temporary, { recursive: true, force: true }); }
