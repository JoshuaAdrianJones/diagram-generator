#!/usr/bin/env node
// Draft rendering for sandboxes without Chromium. This does not publish a revision.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareRuntime } from './runtime.mjs';

try {
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') continue;
    if (!['--spec', '--out', '--previous-layout'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: render-svg.mjs --spec <file> --out <new-directory> [--previous-layout <file>] [--json]');
    }
    options[args[i].slice(2)] = path.resolve(args[++i]);
  }
  if (!options.spec || !options.out) throw new Error('Supply --spec and --out.');
  const { applicationRoot } = await prepareRuntime();
  const load = name => import(pathToFileURL(path.join(applicationRoot, 'dist', 'src', name)).href);
  const { assertCanvas, assertSavedGraph } = await load('documents.js');
  const spec = JSON.parse(await readFile(options.spec, 'utf8'));
  const previous = options['previous-layout'] ? JSON.parse(await readFile(options['previous-layout'], 'utf8')) : undefined;
  const rendered = spec.kind === 'canvas'
    ? (await load('canvas-renderer.js')).renderCanvas(assertCanvas(spec), previous)
    : (await load('renderer.js')).renderDiagram(assertSavedGraph(spec), previous);
  // Refuse to overwrite an earlier draft and its evidence.
  await mkdir(path.dirname(options.out), { recursive: true });
  await mkdir(options.out);
  const artifacts = {};
  for (const [name, value] of Object.entries({ 'diagram.svg': rendered.svg, 'layout.json': rendered.layout, 'diagnostics.json': rendered.diagnostics, 'spec.json': spec })) {
    const filename = path.join(options.out, name);
    await writeFile(filename, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    artifacts[name] = filename;
  }
  for (const [id, svg] of Object.entries(rendered.frameSvgs || {})) {
    await mkdir(path.join(options.out, 'frames'), { recursive: true });
    const filename = path.join(options.out, 'frames', id + '.svg');
    await writeFile(filename, svg, { flag: 'wx' });
    artifacts['frames/' + id + '.svg'] = filename;
  }
  const blocked = rendered.diagnostics.some(finding => finding.severity === 'error');
  process.stdout.write(JSON.stringify({ status: blocked ? 'layout_blocked' : 'draft_svg', visualReview: 'unavailable', artifacts, findings: rendered.diagnostics }, null, 2) + '\n');
  if (blocked) process.exitCode = 3;
} catch (error) {
  process.stdout.write(JSON.stringify({ status: 'error', message: error.message }) + '\n');
  process.exitCode = error.exitCode || 4;
}
