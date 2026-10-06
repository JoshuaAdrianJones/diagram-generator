#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { applicationFiles, sourceNames } from '../skill/diagram/scripts/application-files.mjs';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts', 'packages');
const skillFiles = ['SKILL.md', 'agents/openai.yaml', 'references/cli.md', 'references/design.md',
  'references/runtime.md', 'scripts/launcher.mjs', 'scripts/runtime.mjs', 'scripts/setup.mjs',
  'scripts/render-svg.mjs', 'scripts/application-files.mjs'];
async function copy(relative, destination) {
  if (!(await lstat(path.join(root, relative))).isFile()) throw new Error('Expected regular file: ' + relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, relative), destination);
}
async function filesIn(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await filesIn(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) files.push(relative);
    else throw new Error('Unexpected link or special file: ' + relative);
  }
  return files.sort();
}
async function zip(directory, target, entries) {
  await execute('python3', ['-c',
    'import sys,zipfile,pathlib,json\nroot=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED,compresslevel=9) as z:\n for p in json.loads(sys.argv[3]):\n  info=zipfile.ZipInfo(p,(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,(root/p).read_bytes())',
    directory, target, JSON.stringify(entries)], { maxBuffer: 1024 * 1024 });
}
let staging;
try {
  if (process.argv.length > 2) throw new Error('Usage: npm run package:skill');
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await execute('npm', ['run', 'build'], { cwd: root });
  staging = await mkdtemp(path.join(tmpdir(), 'sketch-skill-package-'));
  const runtime = path.join(staging, 'runtime');
  await mkdir(runtime);
  for (const relative of applicationFiles) await copy(relative, path.join(runtime, relative));
  for (const name of sourceNames) {
    await copy('src/' + name + '.ts', path.join(runtime, 'src', name + '.ts'));
    await copy('dist/src/' + name + '.js', path.join(runtime, 'dist', 'src', name + '.js'));
  }
  await execute('npm', ['ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: runtime, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
  });
  await rm(path.join(runtime, 'node_modules', '.bin'), { recursive: true, force: true });
  await rm(path.join(runtime, 'node_modules', '.package-lock.json'), { force: true });
  await filesIn(runtime);
  const standalone = path.join(staging, 'standalone');
  const diagram = path.join(standalone, 'diagram');
  for (const filename of skillFiles) await copy('skill/diagram/' + filename, path.join(diagram, filename));
  await mkdir(path.join(diagram, 'assets'));
  const archive = path.join(diagram, 'assets', 'runtime.tar.gz');
  await execute('tar', ['-czf', archive, '-C', runtime, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const runtimeSha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(path.join(diagram, 'bundle.json'), JSON.stringify({ application: 'sketch-diagram',
    version: metadata.version, node: metadata.engines.node,
    playwrightVersion: metadata.dependencies.playwright, runtimeSha256 }, null, 2) + '\n');
  const plugin = path.join(staging, 'plugin');
  const standaloneEntries = await filesIn(standalone);
  for (const entry of standaloneEntries) {
    const destination = path.join(plugin, 'skills', entry);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(standalone, entry), destination);
  }
  await writeFile(path.join(plugin, 'plugin.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'sketch-diagram', version: metadata.version,
    description: 'Create and revise sketch diagrams and shared canvases with SVG exports and screenshot review when a browser is available.',
  }, null, 2) + '\n');
  await mkdir(path.join(plugin, '.claude-plugin'));
  const claudeManifest = JSON.parse(await readFile(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
  await writeFile(path.join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ ...claudeManifest, skills: './skills/' }, null, 2) + '\n');
  await mkdir(output, { recursive: true });
  const skillZip = path.join(output, 'diagram-skill.zip');
  const pluginZip = path.join(output, 'sketch-diagram-plugin.zip');
  await zip(standalone, skillZip, standaloneEntries);
  await zip(plugin, pluginZip, await filesIn(plugin));
  await copy('docs/skill-installation.md', path.join(output, 'INSTALL.md'));
  const bundles = [];
  for (const filename of [skillZip, pluginZip]) {
    const bytes = await readFile(filename);
    bundles.push({ file: path.basename(filename), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ version: metadata.version,
    runtimeSha256, bundles, skillEntries: standaloneEntries }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ status: 'packaged', output, bundles }, null, 2) + '\n');
} catch (error) {
  process.stderr.write((error.stderr || error.message) + '\n');
  process.exitCode = 1;
} finally { if (staging) await rm(staging, { recursive: true, force: true }); }
