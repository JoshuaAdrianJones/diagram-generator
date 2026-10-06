import { access, copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applicationFiles, sourceNames } from './application-files.mjs';

export const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
export function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 19 || major >= 27) {
    throw new Error('Sketch Diagram requires Node.js >=22.19.0 <27. This environment has ' + process.version + '.');
  }
}
export async function prepareRuntime() {
  checkNode();
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(skillRoot, 'bundle.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return prepareSourceRuntime(); }
  if (manifest.application !== 'sketch-diagram' || !/^[a-f0-9]{64}$/.test(manifest.runtimeSha256)) {
    throw new Error('Invalid diagram bundle manifest.');
  }
  const archive = path.join(skillRoot, 'assets', 'runtime.tar.gz');
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (digest !== manifest.runtimeSha256) throw new Error('Diagram runtime checksum mismatch. Use an intact skill package.');
  const cache = path.resolve(process.env.SKETCH_DIAGRAM_CACHE || path.join(homedir(), '.cache', 'sketch-diagram'));
  const applicationRoot = path.join(cache, 'runtime-' + digest);
  const ready = async () => {
    const marker = JSON.parse(await readFile(path.join(applicationRoot, '.bundle-ready.json'), 'utf8'));
    if (marker.runtimeSha256 !== digest) throw new Error('Invalid cached runtime marker.');
    await access(path.join(applicationRoot, 'dist', 'src', 'cli.js'));
  };
  try { await ready(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(cache, { recursive: true });
    const staging = await mkdtemp(path.join(cache, '.unpack-'));
    try {
      const { stdout } = await execute('tar', ['-tzf', archive], { maxBuffer: 8 * 1024 * 1024 });
      for (const entry of stdout.trim().split('\n')) {
        if (path.posix.isAbsolute(entry) || entry.split('/').includes('..') || entry.includes('\\')) {
          throw new Error('Unsafe path in diagram runtime archive.');
        }
      }
      await execute('tar', ['-xzf', archive, '-C', staging], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
      await writeFile(path.join(staging, '.bundle-ready.json'), JSON.stringify({ runtimeSha256: digest }));
      try { await rename(staging, applicationRoot); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
      await ready();
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  return runtimePaths(applicationRoot, cache, manifest.playwrightVersion);
}
function runtimePaths(applicationRoot, cache, playwrightVersion) {
  return {
    applicationRoot,
    dataPath: path.resolve(process.env.SKETCH_DIAGRAM_DATA || (process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support', 'sketch-diagram')
      : path.join(homedir(), '.local', 'share', 'sketch-diagram'))),
    browserPath: path.resolve(process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(cache, 'browsers', playwrightVersion)),
  };
}
async function prepareSourceRuntime() {
  const sourceRoot = path.resolve(skillRoot, '..', '..');
  const plugin = JSON.parse(await readFile(path.join(sourceRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  if (plugin.name !== 'sketch-diagram') throw new Error('Not a Sketch Diagram source plugin.');
  const metadata = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'));
  const files = [...applicationFiles, ...sourceNames.map(name => 'src/' + name + '.ts')];
  const hash = createHash('sha256');
  for (const filename of files) {
    if (!(await lstat(path.join(sourceRoot, filename))).isFile()) throw new Error('Expected regular source file: ' + filename);
    const bytes = await readFile(path.join(sourceRoot, filename));
    hash.update(filename + '\0' + bytes.length + '\0').update(bytes);
  }
  const digest = hash.digest('hex');
  const cache = path.resolve(process.env.SKETCH_DIAGRAM_CACHE || path.join(homedir(), '.cache', 'sketch-diagram'));
  const applicationRoot = path.join(cache, 'source-' + digest);
  const ready = async () => {
    const marker = JSON.parse(await readFile(path.join(applicationRoot, '.bundle-ready.json'), 'utf8'));
    if (marker.sourceSha256 !== digest) throw new Error('Invalid source runtime marker.');
    await access(path.join(applicationRoot, 'dist', 'src', 'cli.js'));
  };
  try { await ready(); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(cache, { recursive: true });
    const staging = await mkdtemp(path.join(cache, '.build-'));
    try {
      for (const filename of files) {
        await mkdir(path.dirname(path.join(staging, filename)), { recursive: true });
        await copyFile(path.join(sourceRoot, filename), path.join(staging, filename));
      }
      const options = { cwd: staging, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } };
      process.stderr.write('Preparing Sketch Diagram runtime from the pinned lockfile in a separate cache.\n');
      await execute('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], options);
      await execute('npm', ['run', 'build'], options);
      await execute('npm', ['prune', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], options);
      await writeFile(path.join(staging, '.bundle-ready.json'), JSON.stringify({ sourceSha256: digest }));
      try { await rename(staging, applicationRoot); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
      await ready();
    } catch (error) {
      throw new Error('Source plugin setup failed. Node and npm with package-registry access are required. ' + (error.stderr || error.message));
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  return runtimePaths(applicationRoot, cache, metadata.dependencies.playwright);
}
