import { Ajv } from 'ajv';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { DiagramSpecSchema, NodeSchema, EdgeSchema, GroupSchema, NoteSchema, StyleSchema, ThemeSchema, LayoutSchema, PatchSchema, assertSpec, applyPatch, DiagramError, MAX_DOCUMENT_BYTES, type DiagramSpec, type Finding } from './schema.js';

const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const id = NodeSchema.properties.id;
const text = (maxLength = 4000) => Type.String({ minLength: 1, maxLength });
const choice = <T extends string>(values: T[]) => Type.Union(values.map(value => Type.Literal(value)));
const position = NodeSchema.properties.position;
const dimension = NodeSchema.properties.width;
const requiredDimension = Type.Number({exclusiveMinimum:0,maximum:10000});
const requiredPosition = object({x:Type.Number({minimum:-100000,maximum:100000}),y:Type.Number({minimum:-100000,maximum:100000})});
export const DocumentStyleSchema = object({ ...StyleSchema.properties,
  font: Type.Optional(choice(['body', 'heading', 'sans'])),
  highlight: Type.Optional(StyleSchema.properties.fill),
  presentation: Type.Optional(choice(['plain', 'sticky'])),
});
export type DocumentStyle = Static<typeof DocumentStyleSchema>;
export const DocumentThemeSchema = object({ ...ThemeSchema.properties, ...DocumentStyleSchema.properties });
export type DocumentTheme = Static<typeof DocumentThemeSchema>;
export const GraphNodeSchema = object({ ...NodeSchema.properties,
  shape: Type.Optional(choice(['text', 'rectangle', 'roundedRectangle', 'ellipse', 'circle'])),
  style: Type.Optional(DocumentStyleSchema),
  labelPosition: Type.Optional(choice(['inside', 'above', 'below', 'left', 'right'])),
  caption: Type.Optional(text()), lane: Type.Optional(id), row: Type.Optional(id),
});
export type GraphNode = Static<typeof GraphNodeSchema>;
export const GraphEdgeSchema = object({ ...EdgeSchema.properties, style: Type.Optional(DocumentStyleSchema) });
export const GraphGroupSchema = object({ ...GroupSchema.properties, style: Type.Optional(DocumentStyleSchema) });
export const GraphNoteSchema = object({ ...NoteSchema.properties, style: Type.Optional(DocumentStyleSchema) });
export const GraphLayoutSchema = object({ ...LayoutSchema.properties,
  strategy: Type.Optional(choice(['flow', 'radial', 'cycle', 'manual', 'path', 'dag', 'force', 'lanes'])),
});
export const LaneSchema = object({ id, label: text(1000), caption: Type.Optional(text(1000)) });
export const GraphSchema = object({ ...DiagramSpecSchema.properties,
  schemaVersion: Type.Literal(2), kind: Type.Literal('graph'),
  model: Type.Optional(choice(['path', 'dag', 'network', 'lanes'])),
  nodes: Type.Array(GraphNodeSchema, { minItems: 1, maxItems: 500 }),
  edges: Type.Optional(Type.Array(GraphEdgeSchema, { maxItems: 2000 })),
  groups: Type.Optional(Type.Array(GraphGroupSchema, { maxItems: 100 })),
  notes: Type.Optional(Type.Array(GraphNoteSchema, { maxItems: 500 })),
  layout: Type.Optional(GraphLayoutSchema), theme: Type.Optional(DocumentThemeSchema),
  lanes: Type.Optional(Type.Array(LaneSchema, { minItems: 1, maxItems: 100 })),
  rows: Type.Optional(Type.Array(LaneSchema, { minItems: 1, maxItems: 100 })),
});
GraphSchema.$id = 'https://sketch-diagram.local/schema/graph-v2.json';
export type GraphSpec = Static<typeof GraphSchema>;
// This structural type accepts legacy graphs without extending their validation contract.
export type RenderGraph = Omit<GraphSpec, 'schemaVersion' | 'kind'> & { schemaVersion: 1 | 2; kind?: 'graph' };
export type SavedGraph = DiagramSpec | GraphSpec;

const legacyOps = PatchSchema.properties.operations.items.anyOf;
export const GraphPatchSchema = object({ schemaVersion: Type.Literal(2), operations: Type.Array(Type.Union([
  ...legacyOps.filter(op => !['addNode','updateNode','addEdge','updateEdge','addGroup','updateGroup','addNote','updateNote','setLayout','setTheme'].includes(op.properties.op.const as string)),
  ...(['Node','Edge','Group','Note'] as const).flatMap(kind => {
    const schema = { Node: GraphNodeSchema, Edge: GraphEdgeSchema, Group: GraphGroupSchema, Note: GraphNoteSchema }[kind];
    return [object({ op: Type.Literal('add'+kind), [kind.toLowerCase()]: schema }), object({ op: Type.Literal('update'+kind), id, changes: Type.Partial(Type.Omit(schema, ['id']), { additionalProperties: false }) })];
  }),
  object({ op: Type.Literal('setLayout'), layout: GraphLayoutSchema }),
  object({ op: Type.Literal('setTheme'), theme: DocumentThemeSchema }),
  object({ op: Type.Literal('setModel'), model: choice(['path','dag','network','lanes']) }),
  object({ op: Type.Literal('setLanes'), lanes: Type.Array(LaneSchema, { minItems: 1, maxItems: 100 }), rows: Type.Optional(Type.Array(LaneSchema, { maxItems: 100 })) }),
]), { minItems: 1, maxItems: 1000 }) });
GraphPatchSchema.$id = 'https://sketch-diagram.local/schema/graph-patch-v2.json';
// Operations are schema validated before interpretation; the dynamic add/update schema needs a runtime index signature.
export interface GraphPatch { schemaVersion: 2; operations: Array<Record<string, any> & { op: string }> }
export const PanelBlockSchema = object({
  kind: choice(['heading', 'paragraph', 'quote', 'list']), text: Type.Optional(text()),
  items: Type.Optional(Type.Array(text(), { minItems: 1, maxItems: 100 })),
  emphasis: Type.Optional(choice(['normal', 'strong', 'muted'])), style: Type.Optional(DocumentStyleSchema),
});
const frameProperties = { id, title: Type.Optional(text(1000)), caption: Type.Optional(text()), position,
  width: dimension, height: NodeSchema.properties.height, theme: Type.Optional(DocumentThemeSchema),
  source: Type.Optional(object({ diagramId: id, revisionId: Type.String({ pattern: '^r[0-9]{6,12}$' }), specHash: Type.String({ pattern: '^[a-f0-9]{64}$' }) })),
};
const snapshotPosition = object({x:Type.Number(),y:Type.Number(),seed:Type.Integer({minimum:1,maximum:2147483646})});
const snapshotSeed = object({seed:Type.Integer({minimum:1,maximum:2147483646})});
export const GraphSnapshotSchema = object({
  nodes:Type.Record(id,snapshotPosition,{maxProperties:500}),
  notes:Type.Optional(Type.Record(id,snapshotPosition,{maxProperties:500})),
  groups:Type.Optional(Type.Record(id,snapshotSeed,{maxProperties:100})),
  edges:Type.Optional(Type.Record(id,snapshotSeed,{maxProperties:2000})),
});
export const FrameSchema = Type.Union([
  object({ ...frameProperties, kind: Type.Literal('graph'), graph: GraphSchema, initialLayout:Type.Optional(GraphSnapshotSchema) }),
  object({ ...frameProperties, kind: Type.Literal('panel'), blocks: Type.Array(PanelBlockSchema, { minItems: 1, maxItems: 500 }) }),
]);
export type FrameSpec = Static<typeof FrameSchema>;
export const FrameReferenceSchema = object({ frameId: id, elementIds: Type.Optional(Type.Array(id, { minItems: 1, uniqueItems: true, maxItems: 500 })) });
export const LinkSchema = object({ id, source: FrameReferenceSchema, target: object({ frameId: id }), label: text(1000),
  provenance: Type.Optional(choice(['supplied', 'inferred'])), style: Type.Optional(DocumentStyleSchema),
});
export const RegionSchema = object({ id, title: text(1000), shape: choice(['rectangle', 'ellipse']),
  position: requiredPosition, width: requiredDimension, height: requiredDimension,
  members: Type.Array(id, { uniqueItems: true, maxItems: 500 }), style: Type.Optional(DocumentStyleSchema),
});
export const CanvasAnnotationSchema = object({ id, text: text(), position: requiredPosition, style: Type.Optional(DocumentStyleSchema) });
export const CanvasLayoutSchema = object({ strategy: Type.Optional(choice(['grid','row','column','manual'])),
  gap: LayoutSchema.properties.gap, relayout: Type.Optional(Type.Boolean()),
});
export const CanvasSchema = object({ schemaVersion: Type.Literal(2), kind: Type.Literal('canvas'), id, title: text(1000),
  subtitle: Type.Optional(text()), frames: Type.Array(FrameSchema, { minItems: 1, maxItems: 100 }),
  links: Type.Optional(Type.Array(LinkSchema, { maxItems: 500 })), regions: Type.Optional(Type.Array(RegionSchema, { maxItems: 100 })),
  annotations: Type.Optional(Type.Array(CanvasAnnotationSchema, { maxItems: 500 })),
  layout: Type.Optional(CanvasLayoutSchema), theme: Type.Optional(DocumentThemeSchema),
});
CanvasSchema.$id = 'https://sketch-diagram.local/schema/canvas-v2.json';
export type CanvasSpec = Static<typeof CanvasSchema>;
const operation = (op: string, properties: Record<string, TSchema>) => object({ op: Type.Literal(op), ...properties });
const graphFrameChanges = Type.Partial(Type.Omit(FrameSchema.anyOf[0], ['id','kind','graph','initialLayout']), { additionalProperties: false });
export const CanvasPatchSchema = object({ schemaVersion: Type.Literal(2), operations: Type.Array(Type.Union([
  operation('addFrame', { frame: FrameSchema }), operation('updateFrame', { id, changes: graphFrameChanges }),
  operation('removeFrame', { id, cascade: Type.Optional(Type.Boolean()) }),
  operation('patchGraph', { id, patch: GraphPatchSchema, cascade: Type.Optional(Type.Boolean()) }),
  operation('setPanel', { id, blocks: Type.Array(PanelBlockSchema, { minItems: 1, maxItems: 500 }) }),
  ...(['Link','Region','Annotation'] as const).flatMap(kind => {
    const schema = { Link: LinkSchema, Region: RegionSchema, Annotation: CanvasAnnotationSchema }[kind];
    return [operation('add'+kind, { [kind.toLowerCase()]: schema }), operation('update'+kind, { id, changes: Type.Partial(Type.Omit(schema,['id']), { additionalProperties: false }) }), operation('remove'+kind, { id, cascade: Type.Optional(Type.Boolean()) })];
  }),
  operation('setTheme', { theme: DocumentThemeSchema }), operation('setLayout', { layout: CanvasLayoutSchema }),
  operation('setTitle', { title: text(1000), subtitle: Type.Optional(text()) }),
]), { minItems: 1, maxItems: 1000 }) });
CanvasPatchSchema.$id = 'https://sketch-diagram.local/schema/canvas-patch-v2.json';
export interface CanvasPatch { schemaVersion: 2; operations: Array<Record<string, any> & { op: string }> }
const ajv = new Ajv({ allErrors: true, strict: true });
const graphCheck = ajv.compile(GraphSchema), canvasCheck = ajv.compile(CanvasSchema);
const graphPatchCheck = ajv.compile(GraphPatchSchema), canvasPatchCheck = ajv.compile(CanvasPatchSchema);
function checked<T>(check: ReturnType<typeof ajv.compile>, input: unknown): T {
  let encoded:string;try{encoded=JSON.stringify(input)??'';}catch{throw new DiagramError('Input must be a finite JSON document.','invalid_document');}
  if (Buffer.byteLength(encoded) > MAX_DOCUMENT_BYTES) throw new DiagramError('Document exceeds 2 MiB.', 'document_too_large');
  if (!check(input)) throw new DiagramError(ajv.errorsText(check.errors), 'validation_failure', 2, (check.errors ?? []).map(e => ({ severity: 'error', code: 'schema_validation', ids: [], path: e.instancePath, message: e.message ?? 'Invalid value', repairClasses: ['specification'] })));
  return structuredClone(input) as T;
}
function fail(message: string, ids: string[] = []): never { throw new DiagramError(message,'validation_failure',2,[{severity:'error',code:'invalid_reference_or_model',ids,message,repairClasses:['specification']}]); }
function legacyView(graph: GraphSpec): DiagramSpec {
  const copy: any = structuredClone(graph); copy.schemaVersion = 1;
  delete copy.kind; delete copy.model; delete copy.lanes; delete copy.rows;
  if (copy.layout && !['flow','radial','cycle','manual'].includes(copy.layout.strategy)) copy.layout.strategy = 'manual';
  for (const node of copy.nodes) { if(node.shape === 'circle') node.shape = 'ellipse'; for(const key of ['caption','labelPosition','lane','row']) delete node[key]; }
  for (const style of [copy.theme, ...['nodes','edges','groups','notes'].flatMap(k => (copy[k] ?? []).map((e:any)=>e.style))]) if(style) { if(style.font === 'sans') style.font = 'body'; delete style.highlight; delete style.presentation; }
  return copy;
}
export function assertGraph(input: unknown): GraphSpec {
  const graph = checked<GraphSpec>(graphCheck,input); assertSpec(legacyView(graph));
  const laneIds = new Set<string>(), rowIds = new Set<string>();
  for (const [values, ids] of [[graph.lanes,laneIds],[graph.rows,rowIds]] as const) for (const item of values ?? []) { if(ids.has(item.id)) fail('Duplicate lane or row ID.',[item.id]); ids.add(item.id); }
  for(const node of graph.nodes) {
    if(node.lane && !laneIds.has(node.lane)) fail('Unknown lane.',[node.id,node.lane]);
    if(node.row && !rowIds.has(node.row)) fail('Unknown row.',[node.id,node.row]);
    if(node.shape === 'circle' && node.width && node.height && node.width !== node.height) fail('Circle width and height must match.',[node.id]);
  }
  if(graph.model === 'lanes' || graph.layout?.strategy === 'lanes') {
    if(!graph.lanes?.length || graph.nodes.some(n=>!n.lane || (graph.rows?.length && !n.row))) fail('Lane graphs require a lane for every node, and a row when rows are supplied.');
  }
  const model = graph.model ?? 'network';
  if(model === 'path' || model === 'dag' || graph.layout?.strategy === 'path' || graph.layout?.strategy === 'dag') {
    const incoming = new Map(graph.nodes.map(n=>[n.id,0])), outgoing = new Map(graph.nodes.map(n=>[n.id,[] as string[]]));
    for(const edge of graph.edges ?? []) { if(edge.direction && edge.direction !== 'forward') fail('Path and DAG models require forward directed edges.',[edge.id]); outgoing.get(edge.source)!.push(edge.target); incoming.set(edge.target,incoming.get(edge.target)!+1); }
    const queue = graph.nodes.filter(n=>incoming.get(n.id) === 0).map(n=>n.id), roots = queue.length; let count=0;
    for(let i=0;i<queue.length;i++) { count++; for(const target of outgoing.get(queue[i])!) { incoming.set(target,incoming.get(target)!-1); if(incoming.get(target) === 0) queue.push(target); } }
    if(count !== graph.nodes.length) fail('Path and DAG models must be acyclic.');
    if(model === 'path' || graph.layout?.strategy === 'path') {
      if(roots !== 1 || (graph.edges?.length ?? 0) !== graph.nodes.length-1 || [...outgoing.values()].some(v=>v.length>1) || graph.nodes.some(n=>(graph.edges??[]).filter(e=>e.target===n.id).length>1)) fail('A path must be one connected nonbranching sequence.');
    }
  }
  const strategy = graph.layout?.strategy;
  if(strategy === 'path' && model !== 'path' || strategy === 'dag' && !['dag','path'].includes(model) || strategy === 'lanes' && model !== 'lanes') fail('Layout strategy conflicts with the graph model.');
  return graph;
}
export function assertSavedGraph(input: unknown): SavedGraph { return (input as any)?.schemaVersion === 2 ? assertGraph(input) : assertSpec(input); }
export function assertCanvas(input: unknown): CanvasSpec {
  const canvas=checked<CanvasSpec>(canvasCheck,input), ids=new Set<string>();
  for(const item of [...canvas.frames,...canvas.links??[],...canvas.regions??[],...canvas.annotations??[]]) { if(ids.has(item.id)) fail('Duplicate canvas ID.',[item.id]); ids.add(item.id); }
  const frames=new Map(canvas.frames.map(f=>[f.id,f])), regions=new Map((canvas.regions??[]).map(r=>[r.id,r]));
  for(const frame of canvas.frames) {
    if(frame.kind==='graph') {assertGraph(frame.graph);if(frame.initialLayout)for(const kind of ['nodes','edges','groups','notes'] as const){const ids=new Set((frame.graph[kind]??[]).map(e=>e.id));for(const id of Object.keys(frame.initialLayout[kind]??{}))if(!ids.has(id))fail('Unknown snapshot element.',[frame.id,id]);}}
    else for(const block of frame.blocks) if(block.kind==='list' ? !block.items?.length || !!block.text : !block.text || !!block.items) fail('Panel lists require items; other blocks require text.',[frame.id]);
  }
  for(const link of canvas.links??[]) {
    if(!frames.has(link.source.frameId) || !frames.has(link.target.frameId)) fail('Link frame does not exist.',[link.id]);
    const source=frames.get(link.source.frameId)!;
    const elements=source.kind==='graph'?new Set([...source.graph.nodes,...source.graph.edges??[],...source.graph.groups??[],...source.graph.notes??[]].map(e=>e.id)):new Set<string>();
    for(const element of link.source.elementIds??[]) if(!elements.has(element)) fail('Link element does not exist.',[link.id,element]);
    if(link.source.frameId === link.target.frameId) fail('Explanatory links connect different frames.',[link.id]);
  }
  const owner=new Map<string,string>();
  for(const region of canvas.regions??[]) for(const member of region.members) {
    if(!frames.has(member) && !regions.has(member)) fail('Unknown region member.',[region.id,member]);
    if(owner.has(member)) fail('A canvas item belongs to at most one region.',[member]); owner.set(member,region.id);
  }
  for(const region of regions.values()) { const visited=new Set<string>(); let next:string|undefined=region.id; while(next) { if(visited.has(next)) fail('Region containment must be acyclic.',[region.id]); visited.add(next); next=owner.get(next); } }
  return canvas;
}
export function validateDocument(input: unknown) { try { const spec=(input as any)?.kind==='canvas'?assertCanvas(input):assertSavedGraph(input); return {valid:true,spec,findings:[] as Finding[]}; } catch(error) { const e=error as DiagramError; return {valid:false,findings:e.findings?.length?e.findings:[{severity:'error' as const,code:e.code,ids:[],message:e.message,repairClasses:['specification']}]}; } }
export function assertGraphPatch(input: unknown): GraphPatch { return checked(graphPatchCheck,input); }
export function assertCanvasPatch(input: unknown): CanvasPatch { return checked(canvasPatchCheck,input); }
export function importGraph(graph: SavedGraph): GraphSpec {
  if(graph.schemaVersion===2) {const copy=structuredClone(graph);if(copy.layout?.relayout)copy.layout.relayout=false;return copy;}
  const copy:any=structuredClone(graph); copy.schemaVersion=2; copy.kind='graph'; copy.model='network';
  // Legacy clean still uses handwritten labels. Explicit font choices preserve it after import.
  copy.theme={...copy.theme,font:copy.theme?.font??'body'};
  copy.layout={...copy.layout,strategy:copy.layout?.strategy??'flow',relayout:false};
  for(const [kind,font] of [['groups','heading'],['edges','body'],['notes','body']])for(const item of copy[kind]??[])item.style={...item.style,font:item.style?.font??font};
  if(copy.theme.preset==='clean'){copy.theme.roughness=0;for(const kind of ['nodes','edges','groups','notes'])for(const item of copy[kind]??[])item.style={...item.style,roughness:0};}
  return assertGraph(copy);
}
export function applyGraphPatch(input: GraphSpec, patchInput: GraphPatch): GraphSpec {
  const graph=structuredClone(assertGraph(input)), patch=assertGraphPatch(patchInput);
  if(graph.layout?.relayout && !patch.operations.some(o=>o.op==='setLayout')) graph.layout.relayout=false;
  for(const operation of patch.operations) {
    const o=operation as any;
    if(o.op==='setModel') {graph.model=o.model;continue;} if(o.op==='setLanes') {graph.lanes=o.lanes;graph.rows=o.rows;continue;}
    if(o.op==='setTheme') {graph.theme=o.theme;continue;} if(o.op==='setLayout') {graph.layout=o.layout;continue;}
    if(o.op.startsWith('add') || o.op.startsWith('update')) {
      const kind=o.op.replace(/^(add|update)/,'').toLowerCase(), key=kind==='group'?'groups':kind+'s';
      const items=((graph as any)[key]??=[]) as any[];
      if(o.op.startsWith('add')) items.push(o[kind]); else {const item=items.find(i=>i.id===o.id);if(!item) fail('Unknown graph element.',[o.id]);Object.assign(item,o.changes);} continue;
    }
    // Reuse the established cascade rules, then retain v2 properties on surviving elements.
    const legacy=applyPatch(legacyView(graph), {schemaVersion:1,operations:[o]} as any);
    for(const key of ['nodes','edges','groups','notes'] as const) {
      const old=new Map((graph[key]??[]).map(e=>[e.id,e]));
      const schema={nodes:NodeSchema,edges:EdgeSchema,groups:GroupSchema,notes:NoteSchema}[key];
      (graph as any)[key]=legacy[key]?.map(e=>{const original=old.get(e.id);const extras=Object.fromEntries(Object.entries(original??{}).filter(([name])=>!(name in schema.properties)));return {...e,...extras,...(key==='nodes' && (original as any)?.shape==='circle'?{shape:'circle'}:{})};});
      for(const item of (graph as any)[key]??[]) if(old.get(item.id)?.style) item.style=(old.get(item.id) as any).style;
    }
    if(o.op==='setTitle') {graph.title=legacy.title;graph.subtitle=legacy.subtitle;graph.legend=legacy.legend;}
    graph.provenance=legacy.provenance;
    if(graph.layout) graph.layout={...graph.layout,order:legacy.layout?.order,pins:legacy.layout?.pins,fixed:legacy.layout?.fixed,relative:legacy.layout?.relative};
  }
  return assertGraph(graph);
}
export function applyCanvasPatch(input: CanvasSpec, patchInput: CanvasPatch): CanvasSpec {
  const canvas=structuredClone(assertCanvas(input)), patch=assertCanvasPatch(patchInput);
  if(canvas.layout?.relayout && !patch.operations.some(o=>o.op==='setLayout')) canvas.layout.relayout=false;
  for(const frame of canvas.frames) if(frame.kind==='graph' && frame.graph.layout?.relayout) frame.graph.layout.relayout=false;
  for(const o of patch.operations) {
    if(o.op==='setTitle') {canvas.title=o.title;if(o.subtitle!==undefined)canvas.subtitle=o.subtitle;continue;}
    if(o.op==='setTheme') {canvas.theme=o.theme;continue;} if(o.op==='setLayout') {canvas.layout=o.layout;continue;}
    if(o.op==='patchGraph' || o.op==='setPanel') {
      const frame=canvas.frames.find(f=>f.id===o.id);if(!frame)fail('Unknown frame.',[o.id]);
      if(o.op==='setPanel') {if(frame.kind!=='panel')fail('Frame is not a panel.',[o.id]);frame.blocks=o.blocks;}
      else {if(frame.kind!=='graph')fail('Frame is not a graph.',[o.id]);frame.graph=applyGraphPatch(frame.graph,o.patch);
        if(frame.initialLayout)for(const kind of ['nodes','edges','groups','notes'] as const){const ids=new Set((frame.graph[kind]??[]).map(e=>e.id));(frame.initialLayout as any)[kind]=Object.fromEntries(Object.entries(frame.initialLayout[kind]??{}).filter(([id])=>ids.has(id)));}
        const elements=new Set([...frame.graph.nodes,...frame.graph.edges??[],...frame.graph.groups??[],...frame.graph.notes??[]].map(e=>e.id));
        for(const link of canvas.links??[]) if(link.source.frameId===o.id && link.source.elementIds?.some(id=>!elements.has(id))) {
          if(!o.cascade)fail('Removed elements have canvas references. Use cascade:true.',[link.id]);
          link.source.elementIds=link.source.elementIds.filter(id=>elements.has(id));if(!link.source.elementIds.length)delete link.source.elementIds;
        }
      }continue;
    }
    const action=o.op.match(/^(add|update|remove)(Frame|Link|Region|Annotation)$/);if(!action)fail('Unknown operation.');
    const kind=action[2].toLowerCase(), key=(kind==='annotation'?'annotations':kind+'s') as 'frames'|'links'|'regions'|'annotations';
    const items=((canvas as any)[key]??=[]) as any[];
    if(action[1]==='add') {items.push(o[kind]);continue;}
    const item=items.find(i=>i.id===o.id);if(!item)fail('Unknown canvas item.',[o.id]);
    if(action[1]==='update') {Object.assign(item,o.changes);continue;}
    const attached=(canvas.links??[]).filter(l=>l.source.frameId===o.id || l.target.frameId===o.id), parents=(canvas.regions??[]).filter(r=>r.members.includes(o.id));
    if(!o.cascade && (attached.length || parents.length || (kind==='region' && item.members.length)))fail('Item has references. Use cascade:true.',[o.id]);
    (canvas as any)[key]=items.filter(i=>i.id!==o.id);
    if(o.cascade) {canvas.links=canvas.links?.filter(l=>!attached.includes(l));canvas.regions?.forEach(r=>r.members=r.members.filter(id=>id!==o.id));}
  }
  return assertCanvas(canvas);
}
