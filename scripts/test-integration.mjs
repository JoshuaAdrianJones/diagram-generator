#!/usr/bin/env node
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applicationRoot, statOptional } from './integration.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sketch-diagram-integration-'));
const metadataPath = path.join(applicationRoot, '.installation.json');
let priorMetadata = null;
try { priorMetadata = await fs.readFile(metadataPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const legacyRoot = path.join(root, 'legacy-skills');
const agentsRoot = path.join(root, 'agent-skills');
const binRoot = path.join(root, 'bin');
const dataRoot = path.join(root, 'data');
const args = ['--json', '--skill-root', legacyRoot, '--agents-root', agentsRoot, '--bin-dir', binRoot, '--data-dir', dataRoot];
const run = (script, extra = [], expectedStatus = 0) => {
  const result = spawnSync(process.execPath, [path.join(applicationRoot, 'scripts', script), ...args, ...extra], { encoding: 'utf8' });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
try {
  const dry = run('install.mjs', ['--dry-run']);
  assert.equal(dry.status, 'dry_run');
  assert.equal(await statOptional(legacyRoot), null);

  await fs.mkdir(path.join(legacyRoot, 'unrelated'), { recursive: true });
  await fs.writeFile(path.join(legacyRoot, 'unrelated', 'SKILL.md'), 'keep this skill');
  const installed = run('install.mjs');
  assert.equal(installed.status, 'installed');
  assert.equal(installed.applicationRoot, applicationRoot);
  assert.equal(await fs.realpath(path.join(agentsRoot, 'diagram')), await fs.realpath(path.join(legacyRoot, 'diagram')));
  assert.equal(await fs.realpath(path.join(binRoot, 'sketch-diagram')), await fs.realpath(path.join(applicationRoot, 'bin', 'sketch-diagram.mjs')));
  const marker = JSON.parse(await fs.readFile(path.join(legacyRoot, 'diagram', 'install.json'), 'utf8'));
  assert.equal(marker.applicationRoot, applicationRoot);
  assert.equal(marker.dataPath, dataRoot);
  await fs.writeFile(path.join(dataRoot, 'preserve.txt'), 'user diagram sentinel');
  await fs.writeFile(path.join(legacyRoot, 'diagram', 'stale-resource.txt'), 'remove on update');
  const updated = run('install.mjs');
  assert.equal(updated.status, 'updated');
  assert.equal(await statOptional(path.join(legacyRoot, 'diagram', 'stale-resource.txt')), null);
  assert.equal(await fs.readFile(path.join(legacyRoot, 'unrelated', 'SKILL.md'), 'utf8'), 'keep this skill');

  const movedRoot = path.join(root, 'previous-application-location');
  await fs.writeFile(path.join(legacyRoot, 'diagram', 'install.json'), JSON.stringify({ ...marker, applicationRoot: movedRoot }));
  await fs.unlink(path.join(binRoot, 'sketch-diagram'));
  await fs.symlink(path.join(movedRoot, 'bin', 'sketch-diagram.mjs'), path.join(binRoot, 'sketch-diagram'));
  run('install.mjs', [], 1);
  const relocated = run('install.mjs', ['--update']);
  assert.equal(relocated.status, 'updated');
  assert.equal(await fs.realpath(path.join(binRoot, 'sketch-diagram')), await fs.realpath(path.join(applicationRoot, 'bin', 'sketch-diagram.mjs')));

  const uninstalled = run('uninstall.mjs');
  assert.equal(uninstalled.status, 'uninstalled');
  assert.equal(await statOptional(path.join(legacyRoot, 'diagram')), null);
  assert.equal(await statOptional(path.join(agentsRoot, 'diagram')), null);
  assert.equal(await statOptional(path.join(binRoot, 'sketch-diagram')), null);
  assert.equal(await fs.readFile(path.join(dataRoot, 'preserve.txt'), 'utf8'), 'user diagram sentinel');
  assert.equal(await fs.readFile(path.join(legacyRoot, 'unrelated', 'SKILL.md'), 'utf8'), 'keep this skill');

  await fs.mkdir(path.join(legacyRoot, 'diagram'));
  await fs.writeFile(path.join(legacyRoot, 'diagram', 'SKILL.md'), 'unmanaged diagram skill');
  const collision = run('install.mjs', [], 1);
  assert.equal(collision.status, 'installation_failed');
  assert.equal(await fs.readFile(path.join(legacyRoot, 'diagram', 'SKILL.md'), 'utf8'), 'unmanaged diagram skill');
  await fs.rm(path.join(legacyRoot, 'diagram'), { recursive: true });
  await fs.writeFile(path.join(binRoot, 'sketch-diagram'), 'unrelated executable');
  run('install.mjs', [], 1);
  assert.equal(await statOptional(path.join(legacyRoot, 'diagram')), null);
  assert.equal(await fs.readFile(path.join(binRoot, 'sketch-diagram'), 'utf8'), 'unrelated executable');
  process.stdout.write('Integration checks passed: dry run, install, update, moved-application update, symlink resolution, unrelated paths, collision refusal, and data-preserving uninstall.\n');
} finally {
  if (priorMetadata) await fs.writeFile(metadataPath, priorMetadata);
  else await fs.rm(metadataPath, { force: true });
  await fs.rm(root, { recursive: true, force: true });
}
