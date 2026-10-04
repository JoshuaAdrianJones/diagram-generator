import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderDiagram, measureText, type Bounds } from '../src/renderer.js';
import { assertSpec, hashSpec, type DiagramSpec } from '../src/schema.js';
import { boundary, center, pathHitsBox, right, bottom } from '../src/geometry.js';

function fixture(name: string): DiagramSpec { return assertSpec(JSON.parse(readFileSync(new URL(`../../fixtures/${name}.json`, import.meta.url), 'utf8'))); }
function base(): DiagramSpec { return { schemaVersion: 1, id: 'geometry', title: 'Geometry test', nodes: [{ id: 'a', label: 'First concept' }, { id: 'b', label: 'Second concept' }, { id: 'c', label: 'Third concept' }], edges: [{ id: 'ab', source: 'a', target: 'b', label: 'informs' }, { id: 'bc', source: 'b', target: 'c', label: 'relates to' }] }; }
function fits(inner: Bounds, outer: Bounds): boolean { return inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer); }

test('renderer measures bundled fonts, wraps long paragraphs and retains escaped inert text', () => {
  const spec = base(); spec.title = '<script>alert("test")</script>';
  spec.nodes[0]!.label = 'A long concept description that keeps all of the original words and wraps across several lines.\nSecond paragraph.';
  spec.nodes[0]!.width = 220;
  const result = renderDiagram(spec), node = result.layout.nodes.a!;
  assert(node.lines.length > 2); assert(node.lines.includes('Second paragraph.'));
  assert(fits(node.textBounds, node)); assert(result.svg.includes('&lt;script&gt;alert(&quot;test&quot;)&lt;/script&gt;'));
  assert(!result.svg.includes('<script>')); assert(result.svg.includes('data:font/ttf;base64,'));
  assert.equal(result.layout.specHash, hashSpec(spec));
  assert(measureText('WWWW') > measureText('iiii'));
  assert.equal(result.diagnostics.filter(d => d.severity === 'error').length, 0, JSON.stringify(result.diagnostics));
});

test('small rename preserves unrelated coordinates and every deterministic element seed', () => {
  const spec = base(), first = renderDiagram(spec);
  const renamed = structuredClone(spec); renamed.nodes[0]!.label = 'First concept!';
  const next = renderDiagram(renamed, first.layout);
  for (const id of ['a', 'b', 'c']) { assert.equal(next.layout.nodes[id]!.x, first.layout.nodes[id]!.x); assert.equal(next.layout.nodes[id]!.y, first.layout.nodes[id]!.y); assert.equal(next.layout.nodes[id]!.seed, first.layout.nodes[id]!.seed); }
  for (const id of ['ab', 'bc']) assert.equal(next.layout.edges[id]!.seed, first.layout.edges[id]!.seed);
  const unchanged = renderDiagram(renamed, next.layout); assert.equal(unchanged.svg, next.svg);
  assert.notEqual(first.layout.specHash, next.layout.specHash);
});

test('new connected concept preserves existing coordinates; explicit relayout changes arrangement', () => {
  const spec = base(), first = renderDiagram(spec), added = structuredClone(spec);
  added.nodes.push({ id: 'd', label: 'New concept' }); added.edges!.push({ id: 'cd', source: 'c', target: 'd' });
  const second = renderDiagram(added, first.layout);
  for (const id of ['a', 'b', 'c']) { assert.equal(second.layout.nodes[id]!.x, first.layout.nodes[id]!.x); assert.equal(second.layout.nodes[id]!.y, first.layout.nodes[id]!.y); }
  const relayout = structuredClone(added); relayout.layout = { strategy: 'cycle', relayout: true };
  const changed = renderDiagram(relayout, second.layout);
  assert(Object.keys(second.layout.nodes).some(id => second.layout.nodes[id]!.x !== changed.layout.nodes[id]!.x));
  for (const id of Object.keys(second.layout.nodes)) assert.equal(second.layout.nodes[id]!.seed, changed.layout.nodes[id]!.seed);
});

test('impossible overlapping pins produce blockers without moving their coordinates', () => {
  const spec = base(); spec.nodes[0]!.position = { x: 100, y: 180 }; spec.nodes[0]!.pinned = true; spec.nodes[1]!.position = { x: 110, y: 185 }; spec.nodes[1]!.pinned = true;
  const result = renderDiagram(spec), finding = result.diagnostics.find(d => d.code === 'pinned_overlap');
  assert(finding); assert.equal(finding.severity, 'error'); assert.deepEqual(new Set(finding.ids), new Set(['a', 'b']));
  assert.equal(result.layout.nodes.a!.x, 100); assert.equal(result.layout.nodes.b!.y, 185);
  assert(finding.bounds.width > 0); assert(finding.repairClasses.includes('change_constraints')); assert(result.debugSvg.includes('pinned_overlap'));
});

test('unbreakable words and explicit undersized heights are reported rather than clipped silently', () => {
  const spec = base(); spec.nodes[0]!.label = 'Supercalifragilisticexpialidocious'.repeat(3); spec.nodes[0]!.width = 100; spec.nodes[0]!.height = 25;
  const result = renderDiagram(spec);
  assert(result.diagnostics.some(d => d.code === 'unbreakable_label' && d.severity === 'error'));
  assert(result.diagnostics.some(d => d.code === 'text_outside_shape'));
  assert(fits(result.layout.nodes.a!.textBounds, result.layout.viewport));
  assert(result.svg.includes(spec.nodes[0]!.label));
});

test('missing font glyphs block publication instead of relying on browser fallback metrics', () => {
  const spec = base(); spec.nodes[0]!.label = '中文 concept 🐈';
  const result = renderDiagram(spec), findings = result.diagnostics.filter(d => d.code === 'unsupported_glyph');
  assert(findings.some(finding => finding.ids.includes('a') && finding.severity === 'error'));
  assert(result.svg.includes('中文')); assert(result.svg.includes('🐈'));
});

test('parallel and reciprocal paths are distinguishable, self-loop bounds expand, and arrow directions persist', () => {
  const result = renderDiagram(fixture('parallel-self-loop')), edges = result.layout.edges;
  assert.notEqual(edges.signal!.path, edges.response!.path); assert.notDeepEqual(edges.signal!.points[32], edges.response!.points[32]);
  assert.equal(edges.signal!.arrowheads.length, 1); assert.equal(edges.shared!.arrowheads.length, 2);
  assert.equal(edges.reflect!.arrowheads.length, 1); assert(edges.reflect!.points.length > 50);
  assert(edges.reflect!.points.some(p => p.y < result.layout.nodes.receiver!.y || p.x > right(result.layout.nodes.receiver!)));
  for (const edge of Object.values(edges)) for (const box of edge.arrowheads) assert(fits(box, result.layout.viewport));
  assert.equal(result.diagnostics.filter(d => d.severity === 'error').length, 0, JSON.stringify(result.diagnostics));
});

test('shape-boundary endpoint geometry and unrelated-node routing', () => {
  const ellipse = { x: 10, y: 20, width: 120, height: 70 }, p = boundary(ellipse, { x: 170, y: 100 }, true), c = center(ellipse);
  assert(Math.abs(((p.x - c.x) / 60) ** 2 + ((p.y - c.y) / 35) ** 2 - 1) < 1e-9);
  const spec: DiagramSpec = { schemaVersion: 1, id: 'obstacle', title: 'Obstacle test', nodes: [{ id: 'a', label: 'A', position: { x: 80, y: 250 }, pinned: true }, { id: 'b', label: 'B', position: { x: 580, y: 250 }, pinned: true }, { id: 'c', label: 'Obstacle', position: { x: 320, y: 250 }, pinned: true }], edges: [{ id: 'ab', source: 'a', target: 'b', label: 'connects' }] };
  const result = renderDiagram(spec); assert(!pathHitsBox(result.layout.edges.ab!.points, result.layout.nodes.c!));
  assert(!result.diagnostics.some(d => d.code === 'edge_through_node'));
});

test('group title space, note attachment, and transparent self-contained exports', () => {
  const spec = fixture('groups-notes'); spec.theme = { ...spec.theme, background: 'transparent' };
  const result = renderDiagram(spec);
  for (const group of Object.values(result.layout.groups)) { for (const id of spec.groups!.find(g => g.id === group.id)!.members) { const node = result.layout.nodes[id]!; assert(fits(node, group)); assert(node.y > bottom(group.titleBounds)); } }
  assert(Object.keys(result.layout.notes).length > 0); assert(result.svg.includes('stroke-dasharray="3 6"'));
  assert(/id="diagram-background"[^>]*fill="none"/.test(result.svg)); assert(!result.svg.includes('class="label-background"'));
  assert(!result.svg.includes('diagnostics-overlay')); assert(result.debugSvg.includes('diagnostics-overlay'));
  assert.equal(result.diagnostics.filter(d => d.severity === 'error').length, 0, JSON.stringify(result.diagnostics));
});

test('all acceptance fixtures retain every rendered element and full measured bounds', () => {
  for (const name of ['concept-map', 'cycle', 'parallel-self-loop', 'groups-notes', 'long-label', 'dense-20']) {
    const spec = fixture(name), result = renderDiagram(spec);
    assert.equal(Object.keys(result.layout.nodes).length, spec.nodes.length);
    assert.equal(Object.keys(result.layout.edges).length, spec.edges?.length ?? 0);
    assert.equal(result.diagnostics.filter(d => d.severity === 'error').length, 0, `${name}: ${JSON.stringify(result.diagnostics)}`);
    if (name === 'cycle') assert(result.diagnostics.some(finding => finding.code === 'edge_crossing' && finding.ids.includes('ie') && finding.ids.includes('eo') && finding.severity === 'warning'));
    for (const item of [...spec.nodes, ...(spec.edges ?? []), ...(spec.groups ?? []), ...(spec.notes ?? [])]) assert(result.svg.includes(`data-element-id="${item.id}"`), item.id);
  }
});
