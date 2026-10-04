import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (['--json', '--dry-run', '--update'].includes(argument)) options[argument.slice(2)] = true;
    else if (['--skill-root', '--agents-root', '--bin-dir', '--data-dir'].includes(argument)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${argument} requires a path`);
      options[argument.slice(2)] = path.resolve(argv[++i]);
    } else throw new Error(`Unknown option ${argument}`);
  }
  return options;
}

export function integrationPaths(options = {}) {
  const homeDirectory = os.homedir();
  const codexDirectory = process.env.CODEX_HOME || path.join(homeDirectory, '.codex');
  return {
    applicationRoot,
    skillPath: path.join(options['skill-root'] || path.join(codexDirectory, 'skills'), 'diagram'),
    modernSkillPath: path.join(options['agents-root'] || path.join(homeDirectory, '.agents', 'skills'), 'diagram'),
    binPath: path.join(options['bin-dir'] || path.join(homeDirectory, '.local', 'bin'), 'sketch-diagram'),
    dataPath: options['data-dir'] || process.env.SKETCH_DIAGRAM_DATA || path.join(homeDirectory, 'Library', 'Application Support', 'sketch-diagram'),
    metadataPath: path.join(applicationRoot, '.installation.json'),
  };
}

export async function statOptional(target) {
  try { return await fs.lstat(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function jsonOptional(target) {
  try { return JSON.parse(await fs.readFile(target, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function resolvesTo(target, expected) {
  try { return (await fs.realpath(target)) === (await fs.realpath(expected)); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function symlinkPointsTo(target, expected) {
  try { return path.resolve(path.dirname(target), await fs.readlink(target)) === path.resolve(expected); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'EINVAL') return false; throw error; }
}

export function installedCodexVersion() {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function report(value, asJson) {
  if (asJson) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else {
    process.stdout.write(`${value.status}\n`);
    for (const [key, item] of Object.entries(value)) if (key !== 'status') process.stdout.write(`${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}\n`);
  }
}

export async function writeJsonAtomic(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  try { await fs.rename(temporary, target); }
  finally { await fs.rm(temporary, { force: true }); }
}
