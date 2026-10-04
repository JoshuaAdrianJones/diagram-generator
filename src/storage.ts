import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { applyPatch, assertSpec, DiagramError, hashSpec, type DiagramSpec, type Finding, type Patch } from './schema.js';
import type { LayoutState } from './renderer.js';

export interface RevisionMetadata {
  diagramId: string;
  revisionId: string;
  specHash: string;
  status: 'candidate' | 'published' | 'failed';
  baseRevision: string | null;
  basePublishedRevision: string | null;
  createdAt: string;
  publishedAt?: string;
  restoredFrom?: string;
}
export interface RevisionRecord extends RevisionMetadata {
  path: string;
  spec: DiagramSpec;
  layout?: LayoutState;
  unchanged?: boolean;
}
export interface ReviewRecord {
  revisionId: string;
  specHash: string;
  inspectedImages: string[];
  geometryResults: Finding[];
  visualObservations: Array<string | { ids: string[]; observation: string }>;
  repairAttempts: number;
  outstandingIssues: Finding[];
  status: 'verified' | 'visual_review_unavailable' | 'blocked';
}
interface DiagramMetadata {
  schemaVersion: 1;
  id: string;
  headRevision: string;
  counter: number;
  createdAt: string;
}
interface LatestPointer { revisionId: string; specHash: string; publishedAt: string }
interface ScreenshotManifest {
  diagramId: string;
  revisionId: string;
  specHash: string;
  images: Array<{ path: string; kind: string }>;
}
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SAFE_REVISION = /^r[0-9]{6,12}$/;
const ARTIFACTS = ['diagram.svg', 'diagram.png', 'layout.json', 'diagnostics.json', 'screenshots.json'];

function assertId(value: string, revision = false): void {
  if (!(revision ? SAFE_REVISION : SAFE_ID).test(value)) throw new DiagramError(`Invalid ${revision ? 'revision' : 'diagram'} ID: ${value}`, 'validation_failure');
}
export function defaultDataRoot(): string {
  return path.resolve(process.env.SKETCH_DIAGRAM_DATA || path.join(homedir(), 'Library', 'Application Support', 'sketch-diagram'));
}
export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
async function readJson<T>(file: string): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new DiagramError(`Saved data does not exist: ${file}`, 'not_found', 2);
    if (error instanceof SyntaxError) throw new DiagramError(`Saved JSON is invalid: ${file}`, 'invalid_saved_data', 2);
    throw error;
  }
}
async function optionalJson<T>(file: string): Promise<T | null> {
  try { return await readJson<T>(file); }
  catch (error) { if (error instanceof DiagramError && error.code === 'not_found') return null; throw error; }
}
function relativeArtifact(root: string, name: string): string {
  if (path.isAbsolute(name) || name.split(/[\\/]/).some(part => part === '..' || part === '.' || part.length === 0) || !/^[A-Za-z0-9_./-]+$/.test(name)) {
    throw new DiagramError(`Artifact path must be relative and contained in its revision: ${name}`, 'validation_failure');
  }
  return path.join(root, name);
}

export class DiagramStore {
  readonly dataRoot: string;
  constructor(dataRoot = defaultDataRoot()) { this.dataRoot = path.resolve(dataRoot); }
  diagramPath(diagramId: string): string { assertId(diagramId); return path.join(this.dataRoot, 'diagrams', diagramId); }
  candidatePath(diagramId: string, revisionId: string): string { assertId(revisionId, true); return path.join(this.diagramPath(diagramId), 'attempts', revisionId); }
  revisionPath(diagramId: string, revisionId: string): string { assertId(revisionId, true); return path.join(this.diagramPath(diagramId), 'revisions', revisionId); }

  private async locked<T>(diagramId: string, action: () => Promise<T>): Promise<T> {
    const lockRoot = path.join(this.dataRoot, 'locks');
    await mkdir(lockRoot, { recursive: true });
    const lock = path.join(lockRoot, `${diagramId}.lock`);
    assertId(diagramId);
    try { await mkdir(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = await optionalJson<{ pid: number; token: string }>(path.join(lock, 'owner.json'));
      let alive = true;
      if (owner) {
        try { process.kill(owner.pid, 0); }
        catch (killError) { alive = (killError as NodeJS.ErrnoException).code !== 'ESRCH'; }
      } else {
        // An ownerless lock can be the narrow interval between mkdir and writing owner.json.
        alive = Date.now() - (await stat(lock)).mtimeMs < 30_000;
      }
      if (alive) throw new DiagramError(`Diagram ${diagramId} is being changed by another process. Retry with its current base revision.`, 'revision_conflict', 5);
      await rm(lock, { recursive: true, force: true });
      try { await mkdir(lock); }
      catch { throw new DiagramError(`Diagram ${diagramId} is being changed by another process.`, 'revision_conflict', 5); }
    }
    const token = randomUUID();
    await atomicWriteJson(path.join(lock, 'owner.json'), { pid: process.pid, token });
    try { return await action(); }
    finally {
      const owner = await optionalJson<{ token: string }>(path.join(lock, 'owner.json'));
      if (owner?.token === token) await rm(lock, { recursive: true, force: true });
    }
  }
  private async record(directory: string): Promise<RevisionRecord> {
    const metadata = await readJson<RevisionMetadata>(path.join(directory, 'metadata.json'));
    const spec = assertSpec(await readJson(path.join(directory, 'spec.json')));
    if (hashSpec(spec) !== metadata.specHash) throw new DiagramError(`Specification hash mismatch in ${directory}`, 'invalid_saved_data', 2);
    const layout = await optionalJson<LayoutState>(path.join(directory, 'layout.json'));
    return { ...metadata, path: directory, spec, ...(layout ? { layout } : {}) };
  }
  async readRevision(diagramId: string, revisionId: string): Promise<RevisionRecord> {
    return this.record(this.revisionPath(diagramId, revisionId));
  }
  async readCandidate(diagramId: string, revisionId: string): Promise<RevisionRecord> {
    const published = await optionalJson<RevisionMetadata>(path.join(this.revisionPath(diagramId, revisionId), 'metadata.json'));
    if (published) return this.readRevision(diagramId, revisionId);
    return this.record(this.candidatePath(diagramId, revisionId));
  }
  async readAny(diagramId: string, revisionId: string): Promise<RevisionRecord> { return this.readCandidate(diagramId, revisionId); }
  async latest(diagramId: string): Promise<RevisionRecord | null> {
    const pointer = await optionalJson<LatestPointer>(path.join(this.diagramPath(diagramId), 'latest.json'));
    return pointer ? this.readRevision(diagramId, pointer.revisionId) : null;
  }
  async current(diagramId: string): Promise<RevisionRecord> {
    const metadata = await readJson<DiagramMetadata>(path.join(this.diagramPath(diagramId), 'diagram.json'));
    return this.readCandidate(diagramId, metadata.headRevision);
  }
  private async newCandidate(metadata: DiagramMetadata, spec: DiagramSpec, base: RevisionRecord | null, restoredFrom?: string): Promise<RevisionRecord> {
    // A crash can leave a complete attempt before the head metadata was replaced.
    // Reserve beyond those orphaned attempts instead of blocking future revisions.
    let counter = metadata.counter;
    try {
      for (const entry of await readdir(path.join(this.diagramPath(spec.id), 'attempts'))) {
        if (SAFE_REVISION.test(entry)) counter = Math.max(counter, Number(entry.slice(1)));
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const revisionId = `r${String(counter + 1).padStart(6, '0')}`;
    const latest = await this.latest(spec.id);
    const record: RevisionMetadata = {
      diagramId: spec.id, revisionId, specHash: hashSpec(spec), status: 'candidate',
      baseRevision: base?.revisionId ?? null, basePublishedRevision: latest?.revisionId ?? null,
      createdAt: new Date().toISOString(), ...(restoredFrom ? { restoredFrom } : {}),
    };
    const destination = this.candidatePath(spec.id, revisionId);
    const stage = `${destination}.${randomUUID()}.staging`;
    try {
      await mkdir(stage, { recursive: true });
      await atomicWriteJson(path.join(stage, 'spec.json'), spec);
      await atomicWriteJson(path.join(stage, 'metadata.json'), record);
      // A previous layout is an input to rendering, never the candidate's output.
      if (base?.layout) await atomicWriteJson(path.join(stage, 'previous-layout.json'), base.layout);
      await rename(stage, destination);
      await atomicWriteJson(path.join(this.diagramPath(spec.id), 'diagram.json'), {
        ...metadata, headRevision: revisionId, counter: counter + 1,
      });
    } finally { await rm(stage, { recursive: true, force: true }); }
    return { ...record, path: destination, spec };
  }
  async create(input: DiagramSpec): Promise<RevisionRecord> {
    const spec = assertSpec(input);
    return this.locked(spec.id, async () => {
      const directory = this.diagramPath(spec.id);
      try { await mkdir(directory); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new DiagramError(`Diagram ${spec.id} already exists. Choose another ID or revise it with its current base revision.`, 'revision_conflict', 5);
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await mkdir(path.dirname(directory), { recursive: true });
        await mkdir(directory);
      }
      try {
        const metadata: DiagramMetadata = { schemaVersion: 1, id: spec.id, headRevision: '', counter: 0, createdAt: new Date().toISOString() };
        return await this.newCandidate(metadata, spec, null);
      } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    });
  }
  async revise(diagramId: string, patch: Patch, baseRevision: string): Promise<RevisionRecord> {
    assertId(baseRevision, true);
    return this.locked(diagramId, async () => {
      const metadata = await readJson<DiagramMetadata>(path.join(this.diagramPath(diagramId), 'diagram.json'));
      if (metadata.headRevision !== baseRevision) throw this.conflict(diagramId, baseRevision, metadata.headRevision);
      const base = await this.readCandidate(diagramId, baseRevision);
      const spec = applyPatch(base.spec, patch);
      if (hashSpec(spec) === base.specHash) return { ...base, unchanged: true };
      return this.newCandidate(metadata, spec, base);
    });
  }
  async restore(diagramId: string, sourceRevision: string, baseRevision?: string): Promise<RevisionRecord> {
    return this.locked(diagramId, async () => {
      const metadata = await readJson<DiagramMetadata>(path.join(this.diagramPath(diagramId), 'diagram.json'));
      if (baseRevision && metadata.headRevision !== baseRevision) throw this.conflict(diagramId, baseRevision, metadata.headRevision);
      const source = await this.readRevision(diagramId, sourceRevision);
      const head = await this.readCandidate(diagramId, metadata.headRevision);
      const candidate = await this.newCandidate(metadata, source.spec, head, sourceRevision);
      if (source.layout) await atomicWriteJson(path.join(candidate.path, 'previous-layout.json'), source.layout);
      return candidate;
    });
  }
  private conflict(diagramId: string, expected: string, actual: string): DiagramError {
    return new DiagramError(`Revision conflict for ${diagramId}: expected base ${expected}, current base is ${actual}.`, 'revision_conflict', 5);
  }
  async writeCandidateArtifacts(diagramId: string, revisionId: string, files: Record<string, unknown>): Promise<void> {
    return this.locked(diagramId, async () => {
      const record = await this.readCandidate(diagramId, revisionId);
      if (record.status === 'published') throw new DiagramError('Successful revisions are immutable. Create a candidate to change artifacts.', 'revision_conflict', 5);
      for (const [name, value] of Object.entries(files)) {
        if (['metadata.json', 'spec.json', 'review.json'].includes(name)) throw new DiagramError(`Reserved artifact name: ${name}`, 'validation_failure');
        const target = relativeArtifact(record.path, name);
        await mkdir(path.dirname(target), { recursive: true });
        if (typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array) {
          const temporary = `${target}.${randomUUID()}.tmp`;
          try { await writeFile(temporary, value, { flag: 'wx' }); await rename(temporary, target); }
          finally { await rm(temporary, { force: true }); }
        } else await atomicWriteJson(target, value);
      }
    });
  }
  async markFailed(diagramId: string, revisionId: string, findings: Finding[]): Promise<void> {
    await this.locked(diagramId, async () => {
      const candidate = await this.readCandidate(diagramId, revisionId);
      if (candidate.status === 'published') return;
      await atomicWriteJson(path.join(candidate.path, 'failure.json'), { findings, failedAt: new Date().toISOString() });
      const { spec: _spec, layout: _layout, path: _path, unchanged: _unchanged, ...metadata } = candidate;
      await atomicWriteJson(path.join(candidate.path, 'metadata.json'), { ...metadata, status: 'failed' });
    });
  }
  async markRendered(diagramId: string, revisionId: string): Promise<void> {
    await this.locked(diagramId, async () => {
      const candidate = await this.readCandidate(diagramId, revisionId);
      if (candidate.status === 'published') return;
      const { spec: _spec, layout: _layout, path: _path, unchanged: _unchanged, ...metadata } = candidate;
      await atomicWriteJson(path.join(candidate.path, 'metadata.json'), { ...metadata, status: 'candidate' });
      await rm(path.join(candidate.path, 'failure.json'), { force: true });
    });
  }
  async publish(diagramId: string, revisionId: string, review: ReviewRecord): Promise<RevisionRecord> {
    return this.locked(diagramId, async () => {
      const metadata = await readJson<DiagramMetadata>(path.join(this.diagramPath(diagramId), 'diagram.json'));
      if (metadata.headRevision !== revisionId) throw this.conflict(diagramId, revisionId, metadata.headRevision);
      const candidate = await this.readCandidate(diagramId, revisionId);
      const latest = await this.latest(diagramId);
      if (candidate.status === 'published') {
        if (latest?.revisionId === revisionId) return candidate;
        // Recover a crash after committing the immutable bundle but before its pointer.
        if ((latest?.revisionId ?? null) !== candidate.basePublishedRevision) throw new DiagramError('The published base changed while this candidate was being prepared.', 'revision_conflict', 5);
        await atomicWriteJson(path.join(this.diagramPath(diagramId), 'latest.json'), {
          revisionId, specHash: candidate.specHash, publishedAt: candidate.publishedAt!,
        });
        return candidate;
      }
      if ((latest?.revisionId ?? null) !== candidate.basePublishedRevision) throw new DiagramError('The published base changed while this candidate was being prepared.', 'revision_conflict', 5);
      await this.checkReview(candidate, review);
      const destination = this.revisionPath(diagramId, revisionId);
      const stage = `${destination}.${randomUUID()}.staging`;
      const publishedAt = new Date().toISOString();
      const { spec: _spec, layout: _layout, path: _path, unchanged: _unchanged, ...recordMetadata } = candidate;
      try {
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(candidate.path, stage, { recursive: true, errorOnExist: true, force: false });
        await atomicWriteJson(path.join(stage, 'review.json'), review);
        await atomicWriteJson(path.join(stage, 'metadata.json'), { ...recordMetadata, status: 'published', publishedAt });
        await rename(stage, destination);
        // All assets are immutable and complete before the single public pointer changes.
        await atomicWriteJson(path.join(this.diagramPath(diagramId), 'latest.json'), { revisionId, specHash: candidate.specHash, publishedAt });
      } finally { await rm(stage, { recursive: true, force: true }); }
      return this.readRevision(diagramId, revisionId);
    });
  }
  private async checkReview(candidate: RevisionRecord, review: ReviewRecord): Promise<void> {
    const reject = (message: string, code = 'review_required', exitCode = 3): never => { throw new DiagramError(message, code, exitCode); };
    if (!review || review.revisionId !== candidate.revisionId || review.specHash !== candidate.specHash) reject('Review revision or specification hash does not match the candidate.', 'stale_review', 5);
    if (review.status !== 'verified') reject(`Candidate review status is ${review.status ?? 'missing'}. Only visually verified candidates can be published.`);
    if (!Array.isArray(review.inspectedImages) || !review.inspectedImages.length) reject('The review must identify screenshots that were inspected.');
    if (!Array.isArray(review.geometryResults) || !Array.isArray(review.outstandingIssues) || !Array.isArray(review.visualObservations) || !review.visualObservations.length) reject('The review requires geometry results, visual observations, and outstanding issues.');
    if (!Number.isInteger(review.repairAttempts) || review.repairAttempts < 0 || review.repairAttempts > 3) reject('Repair attempts must be an integer between 0 and 3.');
    if ([...review.geometryResults, ...review.outstandingIssues].some(finding => finding.severity === 'error')) reject('Blocking review findings remain.');
    for (const name of ARTIFACTS) {
      try { const info = await lstat(relativeArtifact(candidate.path, name)); if (!info.isFile() || info.size === 0) reject(`Required artifact is empty or invalid: ${name}`); }
      catch (error) { if (error instanceof DiagramError) throw error; reject(`Required artifact is missing: ${name}`); }
    }
    const layout = await readJson<LayoutState>(path.join(candidate.path, 'layout.json'));
    if (layout.specHash !== candidate.specHash) reject('Layout specification hash does not match the candidate.', 'stale_review', 5);
    const diagnostics = await readJson<Finding[]>(path.join(candidate.path, 'diagnostics.json'));
    if (!Array.isArray(diagnostics) || diagnostics.some(finding => finding.severity === 'error')) reject('Blocking geometry diagnostics remain.');
    const manifest = await readJson<ScreenshotManifest>(path.join(candidate.path, 'screenshots.json'));
    if (manifest.diagramId !== candidate.diagramId || manifest.revisionId !== candidate.revisionId || manifest.specHash !== candidate.specHash) reject('Screenshot manifest revision or specification hash does not match the candidate.', 'stale_review', 5);
    if (!Array.isArray(manifest.images)) reject('The screenshot manifest has no images.');
    const inspected = new Set(review.inspectedImages);
    if (!manifest.images.some(image => image.kind === 'overview' && inspected.has(image.path))) reject('The candidate overview screenshot must be inspected.');
    const root = await realpath(candidate.path);
    for (const imagePath of review.inspectedImages) {
      if (!manifest.images.some(image => image.path === imagePath)) reject(`Reviewed image is absent from the candidate manifest: ${imagePath}`, 'stale_review', 5);
      const file = relativeArtifact(root, imagePath);
      try {
        const resolved = await realpath(file);
        if (!resolved.startsWith(`${root}${path.sep}`)) reject('Screenshot resolves outside its revision.');
        const info = await stat(file); if (!info.isFile() || info.size === 0) reject(`Reviewed screenshot is empty: ${imagePath}`);
      } catch (error) { if (error instanceof DiagramError) throw error; reject(`Reviewed screenshot is missing: ${imagePath}`); }
    }
  }
  async history(diagramId: string, includeAttempts = false): Promise<RevisionMetadata[]> {
    const collect = async (directory: string): Promise<RevisionMetadata[]> => {
      let entries: string[];
      try { entries = await readdir(directory); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
      const records = await Promise.all(entries.filter(entry => SAFE_REVISION.test(entry)).map(entry => readJson<RevisionMetadata>(path.join(directory, entry, 'metadata.json'))));
      return records;
    };
    const successful = await collect(path.join(this.diagramPath(diagramId), 'revisions'));
    if (!includeAttempts) return successful.sort((a, b) => a.revisionId.localeCompare(b.revisionId));
    const ids = new Set(successful.map(record => record.revisionId));
    const attempts = await collect(path.join(this.diagramPath(diagramId), 'attempts'));
    return [...successful, ...attempts.filter(record => !ids.has(record.revisionId))].sort((a, b) => a.revisionId.localeCompare(b.revisionId));
  }
  async cleanupAttempts(diagramId: string, keepLast = 10): Promise<string[]> {
    if (!Number.isInteger(keepLast) || keepLast < 0) throw new DiagramError('keepLast must be a nonnegative integer.', 'validation_failure');
    return this.locked(diagramId, async () => {
      const metadata = await readJson<DiagramMetadata>(path.join(this.diagramPath(diagramId), 'diagram.json'));
      const attempts = (await this.history(diagramId, true)).filter(item => item.status !== 'published' && item.revisionId !== metadata.headRevision).reverse();
      const removed = attempts.slice(keepLast).map(item => item.revisionId);
      for (const revisionId of removed) await rm(this.candidatePath(diagramId, revisionId), { recursive: true, force: true });
      return removed;
    });
  }
}
