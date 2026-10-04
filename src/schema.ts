import { Ajv } from 'ajv';
import { createHash } from 'node:crypto';
import { Type, type Static, type TSchema } from '@sinclair/typebox';

export interface Finding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  ids: string[];
  message: string;
  path?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  repairClasses: string[];
}

export class DiagramError extends Error {
  constructor(message: string, public readonly code: string, public readonly exitCode = 2, public readonly findings: Finding[] = []) {
    super(message);
    this.name = 'DiagramError';
  }
}

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$', maxLength: 64 });
const text = (maxLength = 4000) => Type.String({ minLength: 1, maxLength });
const color = Type.String({ pattern: '^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent|none)$' });
const coordinate = Type.Number({ minimum: -100000, maximum: 100000 });
const dimension = Type.Number({ exclusiveMinimum: 0, maximum: 10000 });
const position = object({ x: coordinate, y: coordinate });
const enumeration = <T extends string>(values: T[]) => Type.Union(values.map(value => Type.Literal(value)));

export const StyleSchema = object({
  font: Type.Optional(enumeration(['body', 'heading'])),
  fontSize: Type.Optional(Type.Number({ minimum: 12, maximum: 96 })),
  stroke: Type.Optional(color), fill: Type.Optional(color),
  roughness: Type.Optional(Type.Number({ minimum: 0, maximum: 3 })),
  strokeWidth: Type.Optional(Type.Number({ minimum: 0.25, maximum: 8 })),
  emphasis: Type.Optional(enumeration(['normal', 'strong', 'muted'])),
});
export type Style = Static<typeof StyleSchema>;

export const NodeSchema = object({
  id, label: text(),
  shape: Type.Optional(enumeration(['text', 'rectangle', 'roundedRectangle', 'ellipse'])),
  group: Type.Optional(id), style: Type.Optional(StyleSchema),
  width: Type.Optional(dimension), height: Type.Optional(dimension),
  position: Type.Optional(position), pinned: Type.Optional(Type.Boolean()),
});
export type NodeSpec = Static<typeof NodeSchema>;

export const EdgeSchema = object({
  id, source: id, target: id,
  direction: Type.Optional(enumeration(['forward', 'both', 'none'])),
  label: Type.Optional(text()),
  certainty: Type.Optional(enumeration(['asserted', 'hypothesis'])),
  routing: Type.Optional(enumeration(['auto', 'straight', 'curve', 'outside'])),
  style: Type.Optional(StyleSchema),
});
export type EdgeSpec = Static<typeof EdgeSchema>;

export const GroupSchema = object({
  id, title: text(1000), members: Type.Array(id, { uniqueItems: true, maxItems: 500 }),
  boundary: Type.Optional(enumeration(['solid', 'dashed', 'none'])),
  fill: Type.Optional(color), style: Type.Optional(StyleSchema),
});
export type GroupSpec = Static<typeof GroupSchema>;

export const NoteSchema = object({
  id, text: text(), attachTo: Type.Optional(id),
  position: Type.Optional(position), style: Type.Optional(StyleSchema),
});
export type NoteSpec = Static<typeof NoteSchema>;

export const LayoutSchema = object({
  strategy: Type.Optional(enumeration(['flow', 'radial', 'cycle', 'manual'])),
  orientation: Type.Optional(enumeration(['horizontal', 'vertical'])),
  gap: Type.Optional(Type.Number({ minimum: 16, maximum: 1000 })),
  order: Type.Optional(Type.Array(id, { uniqueItems: true, maxItems: 500 })),
  alignment: Type.Optional(enumeration(['start', 'center', 'end'])),
  relative: Type.Optional(Type.Array(object({
    nodeId: id, relativeTo: id,
    direction: enumeration(['left', 'right', 'above', 'below']),
    gap: Type.Optional(Type.Number({ minimum: 0, maximum: 1000 })),
  }), { maxItems: 1000 })),
  fixed: Type.Optional(Type.Array(object({ nodeId: id, x: coordinate, y: coordinate }), { maxItems: 500 })),
  pins: Type.Optional(Type.Array(id, { uniqueItems: true, maxItems: 500 })),
  relayout: Type.Optional(Type.Boolean()),
});
export type Layout = Static<typeof LayoutSchema>;

export const ThemeSchema = object({
  preset: Type.Optional(enumeration(['sketch', 'clean'])),
  background: Type.Optional(color), ...StyleSchema.properties,
});
export type Theme = Static<typeof ThemeSchema>;

export const DiagramSpecSchema = object({
  schemaVersion: Type.Literal(1), id, title: text(1000),
  subtitle: Type.Optional(text()), legend: Type.Optional(text()),
  nodes: Type.Array(NodeSchema, { minItems: 1, maxItems: 500 }),
  edges: Type.Optional(Type.Array(EdgeSchema, { maxItems: 2000 })),
  groups: Type.Optional(Type.Array(GroupSchema, { maxItems: 100 })),
  notes: Type.Optional(Type.Array(NoteSchema, { maxItems: 500 })),
  layout: Type.Optional(LayoutSchema), theme: Type.Optional(ThemeSchema),
  provenance: Type.Optional(object({
    supplied: Type.Optional(Type.Array(id, { uniqueItems: true, maxItems: 3100 })),
    inferred: Type.Optional(Type.Array(id, { uniqueItems: true, maxItems: 3100 })),
    unresolvedQuestions: Type.Optional(Type.Array(text(), { maxItems: 100 })),
    sourceSummary: Type.Optional(text()),
  })),
});
DiagramSpecSchema.$id = 'https://sketch-diagram.local/schema/diagram-v1.json';
export type DiagramSpec = Static<typeof DiagramSpecSchema>;

const nodeChanges = Type.Partial(Type.Omit(NodeSchema, ['id']), { additionalProperties: false });
const edgeChanges = Type.Partial(Type.Omit(EdgeSchema, ['id']), { additionalProperties: false });
const groupChanges = Type.Partial(Type.Omit(GroupSchema, ['id']), { additionalProperties: false });
const noteChanges = Type.Partial(Type.Omit(NoteSchema, ['id']), { additionalProperties: false });
const op = <const N extends string, T extends Record<string, TSchema>>(name: N, properties: T) => object({ op: Type.Literal(name), ...properties });
export const PatchSchema = object({
  schemaVersion: Type.Literal(1),
  operations: Type.Array(Type.Union([
    op('addNode', { node: NodeSchema }), op('updateNode', { id, changes: nodeChanges }),
    op('removeNode', { id, cascade: Type.Optional(Type.Boolean()) }),
    op('addEdge', { edge: EdgeSchema }), op('updateEdge', { id, changes: edgeChanges }), op('removeEdge', { id }),
    op('addGroup', { group: GroupSchema }), op('updateGroup', { id, changes: groupChanges }),
    op('removeGroup', { id, cascade: Type.Optional(Type.Boolean()) }),
    op('addNote', { note: NoteSchema }), op('updateNote', { id, changes: noteChanges }), op('removeNote', { id }),
    op('setTheme', { theme: ThemeSchema }), op('setLayout', { layout: LayoutSchema }),
    op('setTitle', { title: text(1000), subtitle: Type.Optional(text()), legend: Type.Optional(text()) }),
  ]), { minItems: 1, maxItems: 1000 }),
});
PatchSchema.$id = 'https://sketch-diagram.local/schema/patch-v1.json';
export type Patch = Static<typeof PatchSchema>;

const ajv = new Ajv({ allErrors: true, strict: true });
const checkSpec = ajv.compile(DiagramSpecSchema);
const checkPatch = ajv.compile(PatchSchema);
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

export function hashSpec(spec: unknown): string {
  function ordered(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(ordered);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered((value as Record<string, unknown>)[key])]));
    }
    return value;
  }
  return createHash('sha256').update(JSON.stringify(ordered(spec))).digest('hex');
}

function schemaFindings(errors: typeof checkSpec.errors, input: unknown): Finding[] {
  return (errors ?? []).map(error => {
    const extra = error.keyword === 'additionalProperties' ? `/${String(error.params.additionalProperty)}` :
      error.keyword === 'required' ? `/${String(error.params.missingProperty)}` : '';
    const path = `${error.instancePath}${extra}` || '/';
    let element: unknown = input;
    const ids: string[] = [];
    for (const segment of error.instancePath.split('/').filter(Boolean)) {
      if (!element || typeof element !== 'object') break;
      element = (element as Record<string, unknown>)[segment.replace(/~1/g, '/').replace(/~0/g, '~')];
      if (element && typeof element === 'object' && typeof (element as Record<string, unknown>).id === 'string') ids.push((element as { id: string }).id);
    }
    return { severity: 'error', code: 'schema_validation', ids: [...new Set(ids)], path,
      message: `${path}: ${error.message ?? 'invalid value'}`, repairClasses: ['specification'] };
  });
}

function documentSize(input: unknown): Finding[] {
  try {
    if (Buffer.byteLength(JSON.stringify(input) ?? '') <= MAX_DOCUMENT_BYTES) return [];
    return [{ severity: 'error', code: 'document_too_large', ids: [], path: '/',
      message: 'The specification exceeds the 2 MiB document limit.', repairClasses: ['specification'] }];
  } catch {
    return [{ severity: 'error', code: 'invalid_document', ids: [], path: '/',
      message: 'The input must be a finite JSON document.', repairClasses: ['specification'] }];
  }
}

export function validateSpec(input: unknown): { valid: boolean; spec?: DiagramSpec; findings: Finding[] } {
  const size = documentSize(input);
  if (size.length) return { valid: false, findings: size };
  if (!checkSpec(input)) return { valid: false, findings: schemaFindings(checkSpec.errors, input) };
  const spec = structuredClone(input) as DiagramSpec;
  const findings: Finding[] = [];
  const fail = (code: string, ids: string[], path: string, message: string) => findings.push({
    severity: 'error', code, ids, path, message: `${path}: ${message}`, repairClasses: ['specification'],
  });
  const nodes = new Map(spec.nodes.map(node => [node.id, node]));
  const groups = new Map((spec.groups ?? []).map(group => [group.id, group]));
  const allIds = new Set<string>();
  for (const kind of ['nodes', 'edges', 'groups', 'notes'] as const) {
    (spec[kind] ?? []).forEach((element, index) => {
      if (allIds.has(element.id)) fail('duplicate_id', [element.id], `/${kind}/${index}/id`, `ID ${element.id} already exists.`);
      allIds.add(element.id);
    });
  }
  (spec.edges ?? []).forEach((edge, index) => {
    for (const endpoint of ['source', 'target'] as const) if (!nodes.has(edge[endpoint])) {
      fail('missing_endpoint', [edge.id, edge[endpoint]], `/edges/${index}/${endpoint}`, `Node ${edge[endpoint]} does not exist.`);
    }
  });
  const membership = new Map<string, string>();
  (spec.groups ?? []).forEach((group, index) => group.members.forEach((member, memberIndex) => {
    if (!nodes.has(member)) fail('missing_group_member', [group.id, member], `/groups/${index}/members/${memberIndex}`, 'Groups may contain existing nodes only. Nested groups are unsupported.');
    if (membership.has(member)) fail('multiple_groups', [member, group.id, membership.get(member)!], `/groups/${index}/members/${memberIndex}`, `Node ${member} already belongs to another group.`);
    membership.set(member, group.id);
  }));
  spec.nodes.forEach((node, index) => {
    if (node.group && !groups.has(node.group)) fail('missing_group', [node.id, node.group], `/nodes/${index}/group`, `Group ${node.group} does not exist.`);
    if (node.group && membership.get(node.id) !== node.group) fail('inconsistent_group', [node.id, node.group], `/nodes/${index}/group`, `Group ${node.group} must include ${node.id} in its members.`);
  });
  (spec.notes ?? []).forEach((note, index) => {
    if (note.attachTo && note.attachTo !== spec.id && note.attachTo !== 'diagram' && !nodes.has(note.attachTo) && !groups.has(note.attachTo)) {
      fail('missing_attachment', [note.id, note.attachTo], `/notes/${index}/attachTo`, 'Notes may attach to a node, group, or diagram.');
    }
  });
  const positions = new Map(spec.nodes.filter(node => node.position).map(node => [node.id, node.position!]));
  const fixedIds = new Set<string>();
  (spec.layout?.fixed ?? []).forEach((pin, index) => {
    if (!nodes.has(pin.nodeId)) fail('missing_layout_node', [pin.nodeId], `/layout/fixed/${index}/nodeId`, 'The fixed node does not exist.');
    if (fixedIds.has(pin.nodeId)) fail('duplicate_fixed_position', [pin.nodeId], `/layout/fixed/${index}`, 'A node may have only one fixed position.');
    const node = nodes.get(pin.nodeId);
    if (node?.pinned && node.position && (node.position.x !== pin.x || node.position.y !== pin.y)) fail('conflicting_pin', [pin.nodeId], `/layout/fixed/${index}`, 'A fixed position conflicts with the node pinned position.');
    fixedIds.add(pin.nodeId); positions.set(pin.nodeId, { x: pin.x, y: pin.y });
  });
  const pinned = new Set([...spec.nodes.filter(node => node.pinned).map(node => node.id), ...(spec.layout?.pins ?? []), ...fixedIds]);
  for (const nodeId of pinned) {
    if (!nodes.has(nodeId)) fail('missing_layout_node', [nodeId], '/layout/pins', 'The pinned node does not exist.');
    else if (!positions.has(nodeId)) fail('missing_pin_position', [nodeId], '/layout/pins', 'A pinned node requires a position or a fixed constraint.');
  }
  (spec.layout?.order ?? []).forEach((nodeId, index) => {
    if (!nodes.has(nodeId)) fail('missing_layout_node', [nodeId], `/layout/order/${index}`, 'The ordered node does not exist.');
  });
  const dependencies = new Map<string, string[]>();
  (spec.layout?.relative ?? []).forEach((constraint, index) => {
    for (const key of ['nodeId', 'relativeTo'] as const) if (!nodes.has(constraint[key])) fail('missing_layout_node', [constraint[key]], `/layout/relative/${index}/${key}`, 'The constrained node does not exist.');
    if (constraint.nodeId === constraint.relativeTo) fail('self_relative_constraint', [constraint.nodeId], `/layout/relative/${index}`, 'A node cannot have a relative constraint to itself.');
    const list = dependencies.get(constraint.nodeId) ?? []; list.push(constraint.relativeTo); dependencies.set(constraint.nodeId, list);
    if (pinned.has(constraint.nodeId) && pinned.has(constraint.relativeTo)) {
      const a = positions.get(constraint.nodeId), b = positions.get(constraint.relativeTo);
      if (a && b) {
        const ok = constraint.direction === 'left' ? a.x < b.x : constraint.direction === 'right' ? a.x > b.x : constraint.direction === 'above' ? a.y < b.y : a.y > b.y;
        if (!ok) fail('conflicting_constraint', [constraint.nodeId, constraint.relativeTo], `/layout/relative/${index}`, 'Pinned positions contradict the requested relative direction.');
      }
    }
  });
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(nodeId: string): boolean {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const target of dependencies.get(nodeId) ?? []) if (visit(target)) return true;
    visiting.delete(nodeId); visited.add(nodeId); return false;
  }
  for (const nodeId of dependencies.keys()) if (visit(nodeId)) {
    fail('cyclic_relative_constraints', [nodeId], '/layout/relative', 'Relative constraints must form an acyclic placement order.'); break;
  }
  for (const key of ['supplied', 'inferred'] as const) (spec.provenance?.[key] ?? []).forEach((elementId, index) => {
    if (!allIds.has(elementId)) fail('missing_provenance_element', [elementId], `/provenance/${key}/${index}`, 'The provenance element does not exist.');
  });
  const supplied = new Set(spec.provenance?.supplied ?? []);
  for (const elementId of spec.provenance?.inferred ?? []) if (supplied.has(elementId)) fail('conflicting_provenance', [elementId], '/provenance', 'An element cannot be both supplied and inferred.');
  return { valid: findings.length === 0, spec: findings.length ? undefined : spec, findings };
}

export function assertSpec(input: unknown): DiagramSpec {
  const result = validateSpec(input);
  if (!result.valid) throw new DiagramError(result.findings[0]?.message ?? 'Invalid specification.', 'validation_failure', 2, result.findings);
  return result.spec!;
}

export function validatePatch(input: unknown): { valid: boolean; patch?: Patch; findings: Finding[] } {
  const size = documentSize(input);
  if (size.length) return { valid: false, findings: size };
  if (!checkPatch(input)) return { valid: false, findings: schemaFindings(checkPatch.errors, input) };
  return { valid: true, patch: structuredClone(input) as Patch, findings: [] };
}

export function assertPatch(input: unknown): Patch {
  const result = validatePatch(input);
  if (!result.valid) throw new DiagramError(result.findings[0]?.message ?? 'Invalid patch.', 'validation_failure', 2, result.findings);
  return result.patch!;
}

export function applyPatch(input: DiagramSpec, inputPatch: Patch): DiagramSpec {
  const spec = structuredClone(assertSpec(input));
  const patch = assertPatch(inputPatch);
  // Relayout requests apply to one revision. Ordinary edits reuse its saved geometry.
  if (spec.layout?.relayout && !patch.operations.some(operation => operation.op === 'setLayout')) spec.layout.relayout = false;
  const missing = (kind: string, elementId: string) => new DiagramError(`Cannot change ${kind} ${elementId}: it does not exist.`, 'validation_failure');
  const removeReferences = (elementId: string) => {
    if (spec.provenance) for (const key of ['supplied', 'inferred'] as const) if (spec.provenance[key]) spec.provenance[key] = spec.provenance[key]!.filter(value => value !== elementId);
  };
  for (const operation of patch.operations) {
    if (operation.op === 'setTheme') { spec.theme = operation.theme; continue; }
    if (operation.op === 'setLayout') { spec.layout = operation.layout; continue; }
    if (operation.op === 'setTitle') {
      spec.title = operation.title;
      if (operation.subtitle !== undefined) spec.subtitle = operation.subtitle;
      if (operation.legend !== undefined) spec.legend = operation.legend;
      continue;
    }
    if (operation.op === 'addNode') { spec.nodes.push(operation.node); continue; }
    if (operation.op === 'addEdge') { (spec.edges ??= []).push(operation.edge); continue; }
    if (operation.op === 'addGroup') { (spec.groups ??= []).push(operation.group); continue; }
    if (operation.op === 'addNote') { (spec.notes ??= []).push(operation.note); continue; }
    if (operation.op === 'updateNode') {
      const item = spec.nodes.find(node => node.id === operation.id); if (!item) throw missing('node', operation.id);
      Object.assign(item, operation.changes); continue;
    }
    if (operation.op === 'updateEdge') {
      const item = spec.edges?.find(edge => edge.id === operation.id); if (!item) throw missing('edge', operation.id);
      Object.assign(item, operation.changes); continue;
    }
    if (operation.op === 'updateGroup') {
      const item = spec.groups?.find(group => group.id === operation.id); if (!item) throw missing('group', operation.id);
      Object.assign(item, operation.changes); continue;
    }
    if (operation.op === 'updateNote') {
      const item = spec.notes?.find(note => note.id === operation.id); if (!item) throw missing('note', operation.id);
      Object.assign(item, operation.changes); continue;
    }
    if (operation.op === 'removeNode') {
      if (!spec.nodes.some(node => node.id === operation.id)) throw missing('node', operation.id);
      const edges = (spec.edges ?? []).filter(edge => edge.source === operation.id || edge.target === operation.id);
      const notes = (spec.notes ?? []).filter(note => note.attachTo === operation.id);
      const groups = (spec.groups ?? []).filter(group => group.members.includes(operation.id));
      if (!operation.cascade && (edges.length || notes.length || groups.length)) throw new DiagramError(`Node ${operation.id} has attached edges, notes, or group membership. Use cascade:true to remove its references.`, 'validation_failure');
      spec.nodes = spec.nodes.filter(node => node.id !== operation.id);
      if (operation.cascade) {
        const removedIds = new Set([...edges.map(edge => edge.id), ...notes.map(note => note.id)]);
        spec.edges = spec.edges?.filter(edge => !removedIds.has(edge.id));
        spec.notes = spec.notes?.filter(note => !removedIds.has(note.id));
        spec.groups?.forEach(group => { group.members = group.members.filter(member => member !== operation.id); });
        if (spec.layout) {
          spec.layout.order = spec.layout.order?.filter(value => value !== operation.id);
          spec.layout.pins = spec.layout.pins?.filter(value => value !== operation.id);
          spec.layout.fixed = spec.layout.fixed?.filter(value => value.nodeId !== operation.id);
          spec.layout.relative = spec.layout.relative?.filter(value => value.nodeId !== operation.id && value.relativeTo !== operation.id);
        }
        for (const removedId of removedIds) removeReferences(removedId);
      }
      removeReferences(operation.id); continue;
    }
    if (operation.op === 'removeGroup') {
      const group = spec.groups?.find(item => item.id === operation.id); if (!group) throw missing('group', operation.id);
      const notes = (spec.notes ?? []).filter(note => note.attachTo === operation.id);
      if (!operation.cascade && (group.members.length || notes.length)) throw new DiagramError(`Group ${operation.id} has members or notes. Use cascade:true to dissolve the group and remove attached notes.`, 'validation_failure');
      spec.groups = spec.groups?.filter(item => item.id !== operation.id);
      if (operation.cascade) {
        spec.nodes.forEach(node => { if (node.group === operation.id) delete node.group; });
        spec.notes = spec.notes?.filter(note => note.attachTo !== operation.id);
        notes.forEach(note => removeReferences(note.id));
      }
      removeReferences(operation.id); continue;
    }
    if (operation.op === 'removeEdge') {
      if (!spec.edges?.some(edge => edge.id === operation.id)) throw missing('edge', operation.id);
      spec.edges = spec.edges.filter(edge => edge.id !== operation.id); removeReferences(operation.id); continue;
    }
    if (operation.op === 'removeNote') {
      if (!spec.notes?.some(note => note.id === operation.id)) throw missing('note', operation.id);
      spec.notes = spec.notes.filter(note => note.id !== operation.id); removeReferences(operation.id);
    }
  }
  return assertSpec(spec);
}
