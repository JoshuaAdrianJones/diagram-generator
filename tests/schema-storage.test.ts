import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyPatch, assertSpec, DiagramError, hashSpec, validatePatch, validateSpec, type DiagramSpec, type Patch } from '../src/schema.js';
import { DiagramStore, type ReviewRecord, type RevisionRecord } from '../src/storage.js';

function fixture(): DiagramSpec {
  return { schemaVersion: 1, id: 'test-map', title: 'A small model',
    nodes: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }],
    edges: [{ id: 'ab', source: 'a', target: 'b', direction: 'forward', certainty: 'hypothesis' }],
  };
}
function patch(operations: Patch['operations']): Patch { return { schemaVersion: 1, operations }; }
function isCode(code: string) { return (error: unknown) => error instanceof DiagramError && error.code === code; }
async function storeTest(callback: (store: DiagramStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sketch-diagram-storage-'));
  try { await callback(new DiagramStore(directory)); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function ready(store: DiagramStore, record: RevisionRecord): Promise<ReviewRecord> {
  await store.writeCandidateArtifacts(record.diagramId, record.revisionId, {
    'diagram.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'diagram.png': Buffer.from('synthetic PNG storage fixture'),
    'layout.json': { specHash: record.specHash }, 'diagnostics.json': [],
    'screenshots.json': { diagramId: record.diagramId, revisionId: record.revisionId, specHash: record.specHash,
      images: [{ path: 'screenshots/overview.png', kind: 'overview' }] },
    'screenshots/overview.png': Buffer.from('synthetic screenshot storage fixture'),
  });
  return { revisionId: record.revisionId, specHash: record.specHash, inspectedImages: ['screenshots/overview.png'],
    geometryResults: [], visualObservations: ['Synthetic fixture for storage rules.'], repairAttempts: 0,
    outstandingIssues: [], status: 'verified' };
}

test('schema rejects typos, duplicate IDs, bad references, unsupported versions, and nonfinite dimensions', () => {
  for (const mutate of [
    (spec: any) => { spec.nodes[0].lable = 'typo'; },
    (spec: any) => { spec.nodes[1].id = 'a'; },
    (spec: any) => { spec.edges[0].target = 'missing'; },
    (spec: any) => { spec.schemaVersion = 2; },
    (spec: any) => { spec.nodes[0].width = -1; },
    (spec: any) => { spec.nodes[0].position = { x: Infinity, y: 0 }; },
    (spec: any) => { spec.nodes[0].style = { font: 'unavailable' }; },
  ]) {
    const spec = fixture(); mutate(spec);
    const result = validateSpec(spec);
    assert.equal(result.valid, false);
    assert.ok(result.findings[0].path?.startsWith('/'));
  }
});

test('schema accepts parallel edges and self loops without changing meaning', () => {
  const spec = fixture();
  spec.edges!.push({ id: 'ab2', source: 'a', target: 'b', direction: 'none' }, { id: 'self', source: 'a', target: 'a', direction: 'both' });
  assert.deepEqual(assertSpec(spec), spec);
});

test('schema rejects nested groups, inconsistent membership, attachments and contradictory pins', () => {
  const spec = fixture();
  spec.groups = [{ id: 'g', title: 'Group', members: ['g'] }];
  assert.equal(validateSpec(spec).findings[0].code, 'missing_group_member');
  spec.groups[0].members = ['b']; spec.nodes[0].group = 'g';
  assert.ok(validateSpec(spec).findings.some(finding => finding.code === 'inconsistent_group'));
  delete spec.groups; delete spec.nodes[0].group;
  spec.notes = [{ id: 'n', text: 'Note', attachTo: 'absent' }];
  assert.equal(validateSpec(spec).findings[0].code, 'missing_attachment');
  delete spec.notes;
  spec.nodes[0].position = { x: 200, y: 0 }; spec.nodes[0].pinned = true;
  spec.nodes[1].position = { x: 0, y: 0 }; spec.nodes[1].pinned = true;
  spec.layout = { relative: [{ nodeId: 'a', relativeTo: 'b', direction: 'left' }] };
  assert.equal(validateSpec(spec).findings[0].code, 'conflicting_constraint');
});

test('patch schemas reject unconstrained operations and support stable node updates', () => {
  assert.equal(validatePatch({ schemaVersion: 1, operations: [{ op: 'run', command: 'anything' }] }).valid, false);
  assert.equal(validatePatch(patch([{ op: 'updateNode', id: 'a', changes: { label: 'Renamed' } }])).valid, true);
  const spec = fixture();
  const result = applyPatch(spec, patch([{ op: 'updateNode', id: 'a', changes: { label: 'Renamed' } }]));
  assert.equal(result.nodes[0].label, 'Renamed'); assert.equal(result.edges![0].certainty, 'hypothesis');
  assert.equal(spec.nodes[0].label, 'First');
});

test('node deletion requires cascade and cascade removes all semantic and placement references', () => {
  const spec = fixture();
  spec.groups = [{ id: 'g', title: 'Group', members: ['a', 'b'] }];
  spec.nodes[0].group = 'g'; spec.nodes[1].group = 'g';
  spec.notes = [{ id: 'note', text: 'Attached', attachTo: 'a' }];
  spec.layout = { order: ['a', 'b'], fixed: [{ nodeId: 'a', x: 0, y: 0 }], relative: [{ nodeId: 'b', relativeTo: 'a', direction: 'right' }] };
  spec.provenance = { supplied: ['a', 'b', 'ab', 'note'] };
  assert.throws(() => applyPatch(spec, patch([{ op: 'removeNode', id: 'a' }])), /cascade:true/);
  const result = applyPatch(spec, patch([{ op: 'removeNode', id: 'a', cascade: true }]));
  assert.deepEqual(result.nodes.map(node => node.id), ['b']); assert.deepEqual(result.edges, []); assert.deepEqual(result.notes, []);
  assert.deepEqual(result.groups![0].members, ['b']); assert.deepEqual(result.layout?.order, ['b']);
  assert.deepEqual(result.layout?.fixed, []); assert.deepEqual(result.layout?.relative, []);
  assert.deepEqual(result.provenance?.supplied, ['b']);
});

test('relayout requests apply once and stable hashes ignore object key order', () => {
  const spec = fixture(); spec.layout = { strategy: 'cycle', relayout: true };
  const changed = applyPatch(spec, patch([{ op: 'updateNode', id: 'a', changes: { label: 'Minor edit' } }]));
  assert.equal(changed.layout?.relayout, false);
  const requested = applyPatch(spec, patch([{ op: 'setLayout', layout: { strategy: 'radial', relayout: true } }]));
  assert.equal(requested.layout?.relayout, true);
  const reversed = Object.fromEntries(Object.entries(spec).reverse()) as DiagramSpec;
  assert.equal(hashSpec(spec), hashSpec(reversed));
});

test('create collisions and stale bases cannot overwrite diagram state', async () => {
  await storeTest(async store => {
    const first = await store.create(fixture());
    await assert.rejects(store.create(fixture()), isCode('revision_conflict'));
    const second = await store.revise(first.diagramId, patch([{ op: 'updateNode', id: 'a', changes: { label: 'New' } }]), first.revisionId);
    await assert.rejects(store.revise(first.diagramId, patch([{ op: 'updateNode', id: 'b', changes: { label: 'Stale' } }]), first.revisionId), isCode('revision_conflict'));
    assert.equal((await store.current(first.diagramId)).revisionId, second.revisionId);
    assert.equal(await store.latest(first.diagramId), null);
    assert.equal((await store.history(first.diagramId)).length, 0);
  });
});

test('publication requires current screenshots and leaves previous success usable after failures', async () => {
  await storeTest(async store => {
    const first = await store.create(fixture());
    const review = await ready(store, first);
    await assert.rejects(store.publish(first.diagramId, first.revisionId, { ...review, specHash: 'stale' }), isCode('stale_review'));
    await assert.rejects(store.publish(first.diagramId, first.revisionId, { ...review, status: 'visual_review_unavailable' }), isCode('review_required'));
    await store.publish(first.diagramId, first.revisionId, review);
    const second = await store.revise(first.diagramId, patch([{ op: 'updateNode', id: 'a', changes: { label: 'Candidate' } }]), first.revisionId);
    const secondReview = await ready(store, second);
    secondReview.inspectedImages = ['screenshots/old.png'];
    await assert.rejects(store.publish(second.diagramId, second.revisionId, secondReview), isCode('review_required'));
    assert.equal((await store.latest(first.diagramId))?.revisionId, first.revisionId);
    assert.equal((await store.readRevision(first.diagramId, first.revisionId)).spec.nodes[0].label, 'First');
    await store.markFailed(second.diagramId, second.revisionId, []);
    assert.equal((await store.current(first.diagramId)).status, 'failed');
    assert.equal((await store.history(first.diagramId)).length, 1);
    await assert.rejects(store.writeCandidateArtifacts(first.diagramId, first.revisionId, { 'diagram.svg': 'overwrite' }), isCode('revision_conflict'));
  });
});

test('unchanged edits create no revision, and restore makes a new revision while retaining later history', async () => {
  await storeTest(async store => {
    const first = await store.create(fixture()); await store.publish(first.diagramId, first.revisionId, await ready(store, first));
    const unchanged = await store.revise(first.diagramId, patch([{ op: 'updateNode', id: 'a', changes: { label: 'First' } }]), first.revisionId);
    assert.equal(unchanged.revisionId, first.revisionId); assert.equal(unchanged.unchanged, true);
    const second = await store.revise(first.diagramId, patch([{ op: 'updateNode', id: 'a', changes: { label: 'Second version' } }]), first.revisionId);
    await store.publish(second.diagramId, second.revisionId, await ready(store, second));
    const restored = await store.restore(first.diagramId, first.revisionId, second.revisionId);
    assert.notEqual(restored.revisionId, first.revisionId); assert.equal(restored.restoredFrom, first.revisionId);
    assert.equal(restored.spec.nodes[0].label, 'First');
    await store.publish(restored.diagramId, restored.revisionId, await ready(store, restored));
    assert.equal((await store.history(first.diagramId)).length, 3);
    assert.equal((await store.readRevision(first.diagramId, second.revisionId)).spec.nodes[0].label, 'Second version');
    const pointer = JSON.parse(await readFile(path.join(store.diagramPath(first.diagramId), 'latest.json'), 'utf8'));
    assert.equal(pointer.revisionId, restored.revisionId);
  });
});

test('per diagram locking admits one concurrent update and rejects unsafe artifact paths', async () => {
  await storeTest(async store => {
    const first = await store.create(fixture());
    const results = await Promise.allSettled([
      store.revise(first.diagramId, patch([{ op: 'updateNode', id: 'a', changes: { label: 'One writer' } }]), first.revisionId),
      store.revise(first.diagramId, patch([{ op: 'updateNode', id: 'a', changes: { label: 'Other writer' } }]), first.revisionId),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const current = await store.current(first.diagramId);
    await assert.rejects(store.writeCandidateArtifacts(first.diagramId, current.revisionId, { '../outside.txt': 'bad' }), isCode('validation_failure'));
    await assert.rejects(store.current('../outside'), isCode('validation_failure'));
  });
});

test('interrupted publication recovers its public pointer and orphan attempts do not block future revisions', async () => {
  await storeTest(async store => {
    const first = await store.create(fixture()); const review = await ready(store, first);
    await store.publish(first.diagramId, first.revisionId, review);
    await rm(path.join(store.diagramPath(first.diagramId), 'latest.json'));
    await store.publish(first.diagramId, first.revisionId, review);
    assert.equal((await store.latest(first.diagramId))?.revisionId, first.revisionId);
    await cp(store.candidatePath(first.diagramId, first.revisionId), store.candidatePath(first.diagramId, 'r000002'), { recursive: true });
    const changed = await store.revise(first.diagramId, patch([{ op: 'updateNode', id: 'a', changes: { label: 'After interruption' } }]), first.revisionId);
    assert.equal(changed.revisionId, 'r000003');
    assert.equal((await store.latest(first.diagramId))?.revisionId, first.revisionId);
  });
});
