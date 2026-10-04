#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  applicationRoot, argumentsFor, integrationPaths, statOptional, jsonOptional,
  resolvesTo, symlinkPointsTo, report,
} from './integration.mjs';

const options = argumentsFor(process.argv.slice(2));
const defaults = integrationPaths(options);

try {
  const saved = await jsonOptional(defaults.metadataPath);
  if (saved && (saved.application !== 'sketch-diagram' || saved.applicationRoot !== applicationRoot)) throw new Error('Installation metadata belongs to another application.');
  const targets = { ...defaults, ...(saved || {}) };
  const existingSkill = await statOptional(targets.skillPath);
  if (existingSkill) {
    const marker = await jsonOptional(path.join(targets.skillPath, 'install.json'));
    if (!marker || marker.application !== 'sketch-diagram' || marker.applicationRoot !== applicationRoot) throw new Error(`Preserving unmanaged skill ${targets.skillPath}.`);
  }
  const removable = [];
  for (const [target, expected] of [[targets.modernSkillPath, targets.skillPath], [targets.binPath, path.join(applicationRoot, 'bin', 'sketch-diagram.mjs')]]) {
    const existing = await statOptional(target);
    if (!existing) continue;
    if (!existing.isSymbolicLink() || !(await resolvesTo(target, expected) || await symlinkPointsTo(target, expected))) throw new Error(`Preserving unmanaged path ${target}.`);
    removable.push(target);
  }
  if (existingSkill) removable.push(targets.skillPath);
  if (saved) removable.push(defaults.metadataPath);
  if (!options['dry-run']) for (const target of removable) await fs.rm(target, { recursive: true, force: true });
  report({ status: options['dry-run'] ? 'dry_run' : 'uninstalled', removedPaths: removable, preservedDataPath: targets.dataPath, preservedApplicationRoot: applicationRoot }, options.json);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  if (options.json) process.stdout.write(`${JSON.stringify({ status: 'uninstall_failed', message: error.message })}\n`);
  process.exitCode = 1;
}
