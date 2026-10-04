#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  applicationRoot, argumentsFor, integrationPaths, statOptional, jsonOptional,
  resolvesTo, symlinkPointsTo, installedCodexVersion, report, writeJsonAtomic,
} from './integration.mjs';

const options = argumentsFor(process.argv.slice(2));
const targets = integrationPaths(options);
const canonicalSkill = path.join(applicationRoot, 'skill', 'diagram');
const executable = path.join(applicationRoot, 'bin', 'sketch-diagram.mjs');
const builtCLI = path.join(applicationRoot, 'dist', 'src', 'cli.js');

try {
  await fs.access(path.join(canonicalSkill, 'SKILL.md'));
  await fs.access(builtCLI);
  const existingSkill = await statOptional(targets.skillPath);
  let previousSkillMetadata = null;
  if (existingSkill) {
    previousSkillMetadata = await jsonOptional(path.join(targets.skillPath, 'install.json'));
    if (!previousSkillMetadata || previousSkillMetadata.application !== 'sketch-diagram' ||
      previousSkillMetadata.applicationRoot !== applicationRoot && !options.update) {
      throw new Error(`Preserving existing skill ${targets.skillPath}. It belongs to another installation or has no installation marker.`);
    }
    if (existingSkill.isSymbolicLink()) throw new Error(`Preserving symlinked skill ${targets.skillPath}. Choose a different --skill-root.`);
  }
  if (targets.modernSkillPath === targets.skillPath) throw new Error('Choose different --skill-root and --agents-root directories.');
  const replacements = new Set();
  for (const [target, expected] of [[targets.modernSkillPath, targets.skillPath], [targets.binPath, executable]]) {
    const existing = await statOptional(target);
    if (!existing) continue;
    const alreadyCorrect = existing.isSymbolicLink() && (await resolvesTo(target, expected) || await symlinkPointsTo(target, expected));
    const oldExecutable = previousSkillMetadata?.applicationRoot && path.join(previousSkillMetadata.applicationRoot, 'bin', 'sketch-diagram.mjs');
    const managedMovedBin = options.update && target === targets.binPath && existing.isSymbolicLink() && oldExecutable && await symlinkPointsTo(target, oldExecutable);
    if (managedMovedBin) replacements.add(target);
    else if (!alreadyCorrect) {
      throw new Error(`Preserving existing path ${target}. Choose a different installation directory.`);
    }
  }
  const packageMetadata = JSON.parse(await fs.readFile(path.join(applicationRoot, 'package.json'), 'utf8'));
  const metadata = {
    application: 'sketch-diagram', version: packageMetadata.version,
    applicationRoot, nodeExecutable: process.execPath,
    skillPath: targets.skillPath, modernSkillPath: targets.modernSkillPath,
    binPath: targets.binPath, dataPath: path.resolve(targets.dataPath),
    installedAt: new Date().toISOString(), codexVersion: installedCodexVersion(),
    discovery: 'installation_only',
    skillLocationsSource: 'https://learn.chatgpt.com/docs/build-skills',
  };
  const pathEntries = (process.env.PATH || '').split(path.delimiter).map(entry => path.resolve(entry));
  const onPath = pathEntries.includes(path.dirname(targets.binPath));
  if (options['dry-run']) {
    report({ status: 'dry_run', ...metadata, commandOnPath: onPath }, options.json);
  } else {
    const staging = `${targets.skillPath}.install-${randomUUID()}`;
    const backup = `${targets.skillPath}.backup-${randomUUID()}`;
    await fs.mkdir(path.dirname(targets.skillPath), { recursive: true });
    await fs.mkdir(path.dirname(targets.modernSkillPath), { recursive: true });
    await fs.mkdir(path.dirname(targets.binPath), { recursive: true });
    await fs.mkdir(metadata.dataPath, { recursive: true });
    let movedExisting = false;
    let installedSkill = false;
    const changedLinks = [];
    try {
      await fs.cp(canonicalSkill, staging, { recursive: true });
      await writeJsonAtomic(path.join(staging, 'install.json'), metadata);
      if (existingSkill) { await fs.rename(targets.skillPath, backup); movedExisting = true; }
      await fs.rename(staging, targets.skillPath);
      installedSkill = true;
      for (const [target, expected] of [[targets.modernSkillPath, targets.skillPath], [targets.binPath, executable]]) {
        const current = await statOptional(target);
        if (!current || replacements.has(target)) {
          const prior = current ? await fs.readlink(target) : null;
          if (current) await fs.unlink(target);
          changedLinks.push({ target, prior });
          await fs.symlink(expected, target, target === targets.modernSkillPath ? 'dir' : 'file');
        }
      }
      await fs.chmod(executable, 0o755);
      await writeJsonAtomic(targets.metadataPath, metadata);
      if (movedExisting) await fs.rm(backup, { recursive: true });
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      for (const { target, prior } of changedLinks.reverse()) {
        await fs.rm(target, { force: true });
        if (prior) await fs.symlink(prior, target);
      }
      if (installedSkill) await fs.rm(targets.skillPath, { recursive: true, force: true });
      if (movedExisting) {
        await fs.rename(backup, targets.skillPath);
      }
      throw error;
    }
    report({
      status: existingSkill ? 'updated' : 'installed', ...metadata,
      commandOnPath: onPath,
      command: onPath ? 'sketch-diagram' : targets.binPath,
      invocation: '$diagram',
      discoveryVerification: 'Query skills/list from a fresh Codex app-server or open the skill picker. Restart Codex only if the skill does not appear.',
    }, options.json);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  if (options.json) process.stdout.write(`${JSON.stringify({ status: 'installation_failed', message: error.message })}\n`);
  process.exitCode = 1;
}
