import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import rough from 'roughjs';
import type { RoughGenerator } from 'roughjs/bin/generator.js';
import { hashSpec } from './schema.js';
import type { RenderGraph as DiagramSpec, GraphNode as NodeSpec, DocumentStyle as Style } from './documents.js';
import type { Static } from '@sinclair/typebox';
import type { GraphEdgeSchema } from './documents.js';
import { placeModel, nodeFootprint } from './graph-layout.js';
type EdgeSpec = Static<typeof GraphEdgeSchema>;
export type FontName = 'body' | 'heading' | 'sans';
export { hashSpec } from './schema.js';
import { boundary, bottom, center, contains, cubic, expand, overlaps, pathBounds, pathHitsBox, pathsIntersect, polyline, quadratic, right, union, type Bounds, type Point } from './geometry.js';
export type { Bounds, Point } from './geometry.js';

export interface Diagnostic { severity: 'error' | 'warning' | 'info'; code: string; ids: string[]; bounds: Bounds; message: string; repairClasses: string[] }
export interface NodeGeometry extends Bounds { captionBounds?: Bounds; captionLines?: string[]; labelPosition?: NodeSpec['labelPosition']; id: string; bounds?: Bounds; seed: number; textBounds: Bounds; lines: string[]; fontSize: number; font: FontName }
export interface EdgeGeometry { id: string; bounds?: Bounds; path: string; points: Point[]; seed: number; labelBounds?: Bounds; labelLines?: string[]; arrowheads: Bounds[]; arrowPolygons: Point[][]; fontSize: number; font?: FontName }
export interface GroupGeometry extends Bounds { id: string; bounds?: Bounds; seed: number; titleBounds: Bounds; titleLines: string[] }
export interface NoteGeometry extends Bounds { id: string; bounds?: Bounds; seed: number; textBounds: Bounds; lines: string[]; fontSize: number; font?: FontName }
export interface LayoutState {
  specHash: string; engineVersion: string; fontVersion: string;
  nodes: Record<string, NodeGeometry>; edges: Record<string, EdgeGeometry>; groups: Record<string, GroupGeometry>; notes: Record<string, NoteGeometry>;
  lanes?: Record<string, LaneGeometry>; rows?: Record<string, LaneGeometry>;
  viewport: Bounds; bounds?: Bounds; titleBounds?: Bounds; subtitleBounds?: Bounds; legendBounds?: Bounds;
}
export interface LaneGeometry extends Bounds { id: string; titleBounds: Bounds; titleLines: string[]; captionBounds?: Bounds; captionLines?: string[] }
export interface RenderResult { svg: string; debugSvg: string; layout: LayoutState; diagnostics: Diagnostic[] }
export const ENGINE_VERSION = '1.0.0';
export const FONT_VERSION = 'bangers-regular-caveat-variable-2026-10';
const PADDING = 16, TITLE_SIZE = 32, BODY_SIZE = 24, EDGE_SIZE = 22;
const generator: RoughGenerator = (rough as unknown as { generator(): RoughGenerator }).generator();
interface Fonts { body: fontkit.Font; heading: fontkit.Font; bodyData: string; headingData: string }
let fonts: Fonts | undefined;
export function fontPaths(): { body: string; heading: string } {
  const roots = ['../assets/fonts/', '../../assets/fonts/'].map(path => new URL(path, import.meta.url));
  const root = roots.find(path => existsSync(new URL('Caveat-Regular.ttf', path))) ?? roots[0]!;
  return { body: fileURLToPath(new URL('Caveat-Regular.ttf', root)), heading: fileURLToPath(new URL('Bangers-Regular.ttf', root)) };
}
function getFonts(): Fonts {
  if (fonts) return fonts;
  const paths = fontPaths();
  for (const [name, path] of Object.entries(paths)) if (!existsSync(path)) throw new Error(`Missing bundled ${name} font: ${path}. Run the installation/update command to restore fonts.`);
  fonts = { body: fontkit.openSync(paths.body) as fontkit.Font, heading: fontkit.openSync(paths.heading) as fontkit.Font, bodyData: readFileSync(paths.body).toString('base64'), headingData: readFileSync(paths.heading).toString('base64') };
  return fonts;
}
let sans: { font: fontkit.Font; data: string } | undefined;
function getSans() {
  if(sans) return sans;
  const filename = fileURLToPath(new URL('NotoSans-Variable.ttf', new URL('.', 'file://' + fontPaths().body)));
  if(!existsSync(filename)) throw new Error('Missing bundled Noto Sans font. Restore application assets.');
  sans = {font: fontkit.openSync(filename) as fontkit.Font, data: readFileSync(filename).toString('base64')};
  return sans;
}
export function getFont(font: FontName): fontkit.Font { return font === 'sans' ? getSans().font : getFonts()[font]; }
export function fontCss(includeSans = false): string {
  const loaded=getFonts();
  return `@font-face{font-family:SketchBody;src:url(data:font/ttf;base64,${loaded.bodyData}) format('truetype');font-weight:400;font-style:normal}@font-face{font-family:SketchHeading;src:url(data:font/ttf;base64,${loaded.headingData}) format('truetype');font-weight:400;font-style:normal}${includeSans ? `@font-face{font-family:DiagramSans;src:url(data:font/ttf;base64,${getSans().data}) format('truetype');font-weight:400;font-style:normal}` : ''}text{font-kerning:normal}`;
}
function defaultFont(spec: DiagramSpec, heading = false): FontName { return spec.schemaVersion === 2 ? (heading ? spec.theme?.font === 'sans' || spec.theme?.preset === 'clean' && !spec.theme?.font ? 'sans' : 'heading' : spec.theme?.font ?? (spec.theme?.preset === 'clean' ? 'sans' : 'body')) : heading ? 'heading' : 'body'; }
function seed(id: string, old?: number): number { return old ?? (parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16) % 2147483646) + 1; }
export function measureText(text: string, size = BODY_SIZE, font: FontName = 'body'): number {
  const loaded = getFont(font);
  return loaded.layout(text).positions.reduce((sum, item) => sum + item.xAdvance, 0) / loaded.unitsPerEm * size;
}
export function lineHeight(size: number): number { return size * 1.4; }
export function wrapText(text: string, maxWidth: number, size: number, font: FontName = 'body'): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureText(next, size, font) > maxWidth) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
export function textMeasure(lines: string[], size: number, font: FontName = 'body'): { width: number; height: number } {
  return { width: Math.max(1, ...lines.map(line => measureText(line, size, font))), height: Math.max(1, lines.length) * lineHeight(size) };
}
function diagnostic(severity: Diagnostic['severity'], code: string, ids: string[], bounds: Bounds, message: string, repairClasses: string[]): Diagnostic { return { severity, code, ids, bounds, message, repairClasses }; }
function styleFor(spec: DiagramSpec, style?: Style): Required<Pick<Style, 'stroke' | 'fill' | 'strokeWidth' | 'roughness' | 'font' | 'fontSize' | 'emphasis'>> {
  const theme = spec.theme;
  return { stroke: style?.stroke ?? theme?.stroke ?? '#28303a', fill: style?.fill ?? theme?.fill ?? '#ffffff', strokeWidth: (style?.strokeWidth ?? theme?.strokeWidth ?? 1.5) * (style?.emphasis === 'strong' ? 1.4 : 1), roughness: spec.schemaVersion === 1 && theme?.preset === 'clean' ? 0 : (style?.roughness ?? theme?.roughness ?? (theme?.preset === 'clean' ? 0 : 0.6)), font: style?.font ?? (spec.schemaVersion===1?theme?.font??'body':defaultFont(spec)), fontSize: style?.fontSize ?? theme?.fontSize ?? BODY_SIZE, emphasis: style?.emphasis ?? theme?.emphasis ?? 'normal' };
}
function makeNode(spec: DiagramSpec, node: NodeSpec, previous?: NodeGeometry): NodeGeometry {
  const style = styleFor(spec, node.style), size = style.fontSize;
  const lines = wrapText(node.label, (node.labelPosition && node.labelPosition !== 'inside' ? Math.max(node.width ?? 0,280) : node.width ?? 280) - PADDING * 2, size, style.font);
  const measured = textMeasure(lines, size, style.font);
  const outside = node.labelPosition && node.labelPosition !== 'inside';
  const ellipseFactor = node.shape === 'ellipse' || node.shape === 'circle' ? Math.SQRT2 : 1;
  let width = node.width ?? (outside ? 80 : Math.max(100, measured.width * ellipseFactor + PADDING * 2)), height = node.height ?? (outside ? 80 : Math.max(58, measured.height * ellipseFactor + PADDING * 2));
  if(node.shape === 'circle') width = height = node.width ?? node.height ?? Math.max(width,height);
  const captionLines=node.caption ? wrapText(node.caption,Math.max(248,width),20,style.font) : undefined;
  const captionBounds=captionLines ? {x:0,y:0,...textMeasure(captionLines,20,style.font)} : undefined;
  const geometry: NodeGeometry = { captionLines, captionBounds, labelPosition: node.labelPosition, id: node.id, x: previous?.x ?? 0, y: previous?.y ?? 0, width, height, seed: seed(`node:${node.id}`, previous?.seed), lines, fontSize: size, font: style.font, textBounds: { x: 0, y: 0, ...measured } };
  updateNodeText(geometry); return geometry;
}
function updateNodeText(node: NodeGeometry) {
  node.textBounds.x = node.x + (node.width - node.textBounds.width) / 2; node.textBounds.y = node.y + (node.height - node.textBounds.height) / 2;
  if(node.labelPosition === 'above') node.textBounds.y = node.y - node.textBounds.height - 12;
  if(node.labelPosition === 'below') node.textBounds.y = bottom(node) + 12;
  if(node.labelPosition === 'left') node.textBounds.x = node.x - node.textBounds.width - 12;
  if(node.labelPosition === 'right') node.textBounds.x = right(node) + 12;
  if(node.captionBounds) {node.captionBounds.x=node.x+(node.width-node.captionBounds.width)/2;node.captionBounds.y=Math.max(bottom(node),bottom(node.textBounds))+12;}
}
function pinnedIds(spec: DiagramSpec): Set<string> { return new Set([...spec.nodes.filter(node => node.pinned).map(node => node.id), ...(spec.layout?.pins ?? []), ...(spec.layout?.fixed ?? []).map(item => item.nodeId)]); }
function groupMembers(spec: DiagramSpec, id: string): string[] { return [...new Set([...(spec.groups?.find(g => g.id === id)?.members ?? []), ...spec.nodes.filter(node => node.group === id).map(node => node.id)])]; }
function nodeBoundary(node: NodeGeometry, spec: NodeSpec, toward: Point): Point {
  const radius = !spec.shape || spec.shape === 'roundedRectangle' ? Math.min(14, node.width / 4, node.height / 4) : 0;
  return boundary(node, toward, spec.shape === 'ellipse' || spec.shape === 'circle', radius);
}
function orderedNodes(spec: DiagramSpec): NodeSpec[] {
  const order = spec.layout?.order ?? [], rank = new Map(order.map((id, i) => [id, i]));
  return [...spec.nodes].sort((a, b) => (rank.get(a.id) ?? 100000) - (rank.get(b.id) ?? 100000));
}
function initialPositions(spec: DiagramSpec, nodes: Record<string, NodeGeometry>, startY: number): void {
  if(placeModel(spec,nodes,startY)) return;
  const gap = spec.layout?.gap ?? 80, strategy = spec.layout?.strategy ?? 'flow';
  const list = orderedNodes(spec).map(node => nodes[node.id]!);
  if (strategy === 'cycle' || strategy === 'radial') {
    const radius = Math.max(170, list.length * (Math.max(...list.map(n => n.width), 140) + gap) / (2 * Math.PI));
    const origin = { x: 80 + radius + Math.max(...list.map(n => n.width), 0) / 2, y: startY + radius + Math.max(...list.map(n => n.height), 0) / 2 };
    list.forEach((node, i) => { const angle = i * 2 * Math.PI / Math.max(1, list.length) - Math.PI / 2; node.x = origin.x + Math.cos(angle) * radius - node.width / 2; node.y = origin.y + Math.sin(angle) * radius - node.height / 2; });
    return;
  }
  // Keep initial group members together, with title and boundary clearance.
  const assigned = new Set<string>(), clusters: NodeGeometry[][] = [];
  for (const group of spec.groups ?? []) { const members = groupMembers(spec, group.id).map(id => nodes[id]).filter((node): node is NodeGeometry => !!node); if (members.length) { clusters.push(members); members.forEach(node => assigned.add(node.id)); } }
  const loose = list.filter(node => !assigned.has(node.id));
  if (loose.length) clusters.push(loose);
  let clusterX = 80, clusterY = startY + 48;
  for (const cluster of clusters) {
    const columns = Math.min(cluster.length, Math.max(1, Math.ceil(Math.sqrt(cluster.length))));
    const cellWidth = Math.max(...cluster.map(node => node.width)) + gap, cellHeight = Math.max(...cluster.map(node => node.height)) + gap;
    cluster.forEach((node, i) => {
      const alignment = spec.layout?.alignment === 'end' ? 1 : spec.layout?.alignment === 'center' ? 0.5 : 0;
      const offsetX = (cellWidth - gap - node.width) * alignment, offsetY = (cellHeight - gap - node.height) * alignment;
      if (spec.layout?.orientation === 'vertical') { node.x = clusterX + Math.floor(i / columns) * cellWidth + offsetX; node.y = clusterY + (i % columns) * cellHeight + offsetY; }
      else { node.x = clusterX + (i % columns) * cellWidth + offsetX; node.y = clusterY + Math.floor(i / columns) * cellHeight + offsetY; }
    });
    const bound = union(cluster);
    if (clusters.length > 1 && clusters.reduce((sum, c) => sum + c.length, 0) > 12) { clusterY = bottom(bound) + gap + 80; } else clusterX = right(bound) + gap + 80;
  }
}
function placeNodes(spec: DiagramSpec, previous: LayoutState | undefined, diagnostics: Diagnostic[], startY: number): Record<string, NodeGeometry> {
  const nodes = Object.fromEntries(spec.nodes.map(node => [node.id, makeNode(spec, node, previous?.nodes[node.id])])), pinned = pinnedIds(spec);
  const preserve = previous && !spec.layout?.relayout;
  initialPositions(spec, nodes, startY);
  if (preserve) {
    for (const node of spec.nodes) if (previous.nodes[node.id]) { nodes[node.id]!.x = previous.nodes[node.id]!.x; nodes[node.id]!.y = previous.nodes[node.id]!.y; }
    for (const node of spec.nodes) if (!previous.nodes[node.id] && !node.position) {
      const neighbours = (spec.edges ?? []).filter(edge => edge.source === node.id || edge.target === node.id).map(edge => nodes[edge.source === node.id ? edge.target : edge.source]).filter((item): item is NodeGeometry => !!item && !!previous.nodes[item.id]);
      if (neighbours.length) { nodes[node.id]!.x = right(neighbours[0]!) + (spec.layout?.gap ?? 80); nodes[node.id]!.y = neighbours[0]!.y; }
    }
  }
  for (const node of spec.nodes) if (node.position) { nodes[node.id]!.x = node.position.x; nodes[node.id]!.y = node.position.y; }
  for (const fixed of spec.layout?.fixed ?? []) if (nodes[fixed.nodeId]) { nodes[fixed.nodeId]!.x = fixed.x; nodes[fixed.nodeId]!.y = fixed.y; }
  const relatives = spec.layout?.relative ?? [], orderedConstraints: typeof relatives = [], visited = new Set<string>();
  const visit = (id: string) => { if (visited.has(id)) return; visited.add(id); for (const constraint of relatives.filter(item => item.nodeId === id)) { visit(constraint.relativeTo); orderedConstraints.push(constraint); } };
  for (const constraint of relatives) visit(constraint.nodeId);
  for (const constraint of orderedConstraints) {
    const node = nodes[constraint.nodeId], other = nodes[constraint.relativeTo];
    if (!node || !other) continue;
    const gap = constraint.gap ?? spec.layout?.gap ?? 80;
    const desired = { x: node.x, y: node.y };
    const horizontal = constraint.direction === 'right' || constraint.direction === 'left';
    const hasOrthogonal = relatives.some(item => item.nodeId === node.id && (item.direction === 'right' || item.direction === 'left') !== horizontal);
    const alignment = spec.layout?.alignment === 'end' ? 1 : spec.layout?.alignment === 'start' ? 0 : 0.5;
    if (!hasOrthogonal) { if (horizontal) desired.y = other.y + (other.height - node.height) * alignment; else desired.x = other.x + (other.width - node.width) * alignment; }
    if (constraint.direction === 'right') desired.x = right(other) + gap;
    if (constraint.direction === 'left') desired.x = other.x - gap - node.width;
    if (constraint.direction === 'below') desired.y = bottom(other) + gap;
    if (constraint.direction === 'above') desired.y = other.y - gap - node.height;
    if (pinned.has(node.id) && (Math.abs(node.x - desired.x) > 0.5 || Math.abs(node.y - desired.y) > 0.5)) diagnostics.push(diagnostic('error', 'pinned_constraint_conflict', [node.id, other.id], union([node, other]), 'The pinned position conflicts with a relative placement constraint.', ['change_constraints']));
    else { node.x = desired.x; node.y = desired.y; }
  }
  for(const node of Object.values(nodes)) updateNodeText(node);
  const list = Object.values(nodes), moved = new Set<string>();
  for (let pass = 0; pass < list.length * 3; pass++) {
    let changed = false;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      if (!overlaps(nodeFootprint(a), nodeFootprint(b), 20) || (pinned.has(a.id) && pinned.has(b.id))) continue;
      const moving = pinned.has(b.id) ? a : b, fixed = moving === a ? b : a;
      const candidates = [
        { x: right(nodeFootprint(fixed)) + 24 + moving.x - nodeFootprint(moving).x, y: moving.y }, { x: moving.x, y: bottom(nodeFootprint(fixed)) + 24 + moving.y - nodeFootprint(moving).y },
        { x: fixed.x - moving.width - 24, y: moving.y }, { x: moving.x, y: fixed.y - moving.height - 24 },
      ].filter(p => p.y >= startY && p.x >= 28).sort((p, q) => Math.hypot(p.x - moving.x, p.y - moving.y) - Math.hypot(q.x - moving.x, q.y - moving.y));
      const valid = candidates.find(p => {const candidate={...moving,...p,textBounds:{...moving.textBounds},captionBounds:moving.captionBounds?{...moving.captionBounds}:undefined};updateNodeText(candidate);return !list.some(other => other !== moving && overlaps(nodeFootprint(candidate), nodeFootprint(other), 20));}) ?? candidates[0];
      if (valid) { moving.x = valid.x; moving.y = valid.y; updateNodeText(moving); moved.add(moving.id); changed = true; }
    }
    if (!changed) break;
  }
  for (const node of list) updateNodeText(node);
  if (preserve) for (const id of moved) if (previous.nodes[id] && (previous.nodes[id]!.x !== nodes[id]!.x || previous.nodes[id]!.y !== nodes[id]!.y)) diagnostics.push(diagnostic('info', 'local_node_movement', [id], nodes[id]!, 'Moved this unpinned node locally to preserve text and shape clearance.', ['review_local_movement']));
  return nodes;
}
function makeGroups(spec: DiagramSpec, nodes: Record<string, NodeGeometry>, previous?: LayoutState): Record<string, GroupGeometry> {
  return Object.fromEntries((spec.groups ?? []).map(group => {
    const members = groupMembers(spec, group.id).map(id => nodes[id]!).filter(Boolean), titleSize = group.style?.fontSize ?? 25;
    const memberBounds = members.length ? union(members.map(nodeFootprint)) : { x: 80, y: 160, width: 180, height: 90 };
    const font = group.style?.font ?? defaultFont(spec,true);
    const lines = wrapText(group.title, Math.max(180, memberBounds.width), titleSize, font), measured = textMeasure(lines, titleSize, font);
    const x = memberBounds.x - 28, y = memberBounds.y - measured.height - 40, width = Math.max(memberBounds.width + 56, measured.width + 56), height = memberBounds.height + measured.height + 68;
    const value: GroupGeometry = { id: group.id, x, y, width, height, seed: seed(`group:${group.id}`, previous?.groups[group.id]?.seed), titleLines: lines, titleBounds: { x: x + 24, y: y + 14, ...measured } };
    return [group.id, value];
  }));
}
function makeLanes(spec: DiagramSpec, nodes: Record<string,NodeGeometry>): {lanes: Record<string,LaneGeometry>; rows: Record<string,LaneGeometry>} {
  const lanes: Record<string,LaneGeometry>={}, rows: Record<string,LaneGeometry>={};
  if(spec.schemaVersion===1 || !spec.lanes?.length) return {lanes,rows};
  const all=Object.values(nodes).map(nodeFootprint), bounds=union(all), font=defaultFont(spec,true);
  const maxWidth=Math.max(180,...all.map(n=>n.width));
  for(const [index,lane] of spec.lanes.entries()) {
    const members=spec.nodes.filter(n=>n.lane===lane.id).map(n=>nodeFootprint(nodes[n.id]));
    const local=members.length?union(members):{x:140+index*(maxWidth+(spec.layout?.gap??96)+64),y:bounds.y,width:maxWidth,height:bounds.height};
    const width=Math.max(180,local.width+48),titleLines=wrapText(lane.label,width-24,24,font),titleSize=textMeasure(titleLines,24,font);
    const captionLines=lane.caption?wrapText(lane.caption,width-24,20,defaultFont(spec)):undefined,captionSize=captionLines?textMeasure(captionLines,20,defaultFont(spec)):undefined;
    const y=bounds.y-titleSize.height-(captionSize?.height??0)-40;
    const value:LaneGeometry={id:lane.id,x:local.x-24,y,width,height:bottom(bounds)-y+28,titleBounds:{x:local.x-12,y:y+12,...titleSize},titleLines};
    if(captionSize)value.captionBounds={x:local.x-12,y:bottom(value.titleBounds)+8,...captionSize};value.captionLines=captionLines;lanes[lane.id]=value;
  }
  for(const row of spec.rows??[]) {
    const members=spec.nodes.filter(n=>n.row===row.id).map(n=>nodeFootprint(nodes[n.id]));if(!members.length)continue;
    const local=union(members),titleLines=wrapText(row.label,110,22,font),size=textMeasure(titleLines,22,font);
    rows[row.id]={id:row.id,x:bounds.x-140,y:local.y,width:120,height:local.height,titleBounds:{x:bounds.x-140,y:local.y+(local.height-size.height)/2,...size},titleLines};
  }
  return {lanes,rows};
}
function routeEdge(spec: DiagramSpec, edge: EdgeSpec, nodes: Record<string, NodeGeometry>, index: number, parallelCount: number, previous?: EdgeGeometry, annotations: Bounds[] = []): EdgeGeometry {
  const source = nodes[edge.source]!, target = nodes[edge.target]!, a = center(source), b = center(target);
  const sourceSpec = spec.nodes.find(node => node.id === edge.source)!, targetSpec = spec.nodes.find(node => node.id === edge.target)!;
  const obstacles: Bounds[] = [...Object.values(nodes).filter(node => node.id !== edge.source && node.id !== edge.target).map(nodeFootprint), ...annotations];
  let path = '', points: Point[] = [];
  const offset = (index - (parallelCount - 1) / 2) * 68 * (edge.source <= edge.target ? 1 : -1);
  const n = (p: Point) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  if (edge.source === edge.target) {
    const extent = 85 + index * 48;
    const candidates = [
      [{ x: right(source) + extent, y: source.y - extent }, { x: source.x - extent, y: source.y - extent }],
      [{ x: right(source) + extent, y: bottom(source) + extent }, { x: source.x - extent, y: bottom(source) + extent }],
      [{ x: right(source) + extent, y: source.y - extent }, { x: right(source) + extent, y: bottom(source) + extent }],
      [{ x: source.x - extent, y: source.y - extent }, { x: source.x - extent, y: bottom(source) + extent }],
    ].map(([c1, c2]) => {
      const start = nodeBoundary(source, sourceSpec, c1!), end = nodeBoundary(source, sourceSpec, c2!);
      return { path: `M ${n(start)} C ${n(c1!)} ${n(c2!)} ${n(end)}`, points: cubic(start, c1!, c2!, end) };
    });
    const selected = candidates.sort((p, q) => obstacles.filter(box => pathHitsBox(p.points, expand(box, 9))).length - obstacles.filter(box => pathHitsBox(q.points, expand(box, 9))).length)[0]!;
    path = selected.path; points = selected.points;
  } else {
    const length = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    const curve = (amount: number): { path: string; points: Point[] } => {
      const control = { x: (a.x + b.x) / 2 + normal.x * amount, y: (a.y + b.y) / 2 + normal.y * amount };
      const start = nodeBoundary(source, sourceSpec, control), end = nodeBoundary(target, targetSpec, control);
      return { path: `M ${n(start)} Q ${n(control)} ${n(end)}`, points: quadratic(start, control, end) };
    };
    const start = nodeBoundary(source, sourceSpec, b), end = nodeBoundary(target, targetSpec, a);
    const straight = { path: `M ${n(start)} L ${n(end)}`, points: polyline([start, end]) };
    const hits = (candidate: { points: Point[] }) => obstacles.filter(node => pathHitsBox(candidate.points, expand(node, 9))).length;
    let candidate = edge.routing === 'straight' && parallelCount === 1 ? straight : edge.routing === 'curve' || parallelCount > 1 ? curve(offset || 65) : straight;
    if (edge.routing === 'outside' || (edge.routing !== 'straight' && hits(candidate))) {
      const candidates = [curve(offset + 120), curve(offset - 120), curve(offset + 240), curve(offset - 240), curve(offset + 420), curve(offset - 420)];
      const all = union(Object.values(nodes));
      for (const lane of [all.y - 70 - index * 34, bottom(all) + 70 + index * 34]) {
        const c1 = { x: a.x, y: lane }, c2 = { x: b.x, y: lane }, s = nodeBoundary(source, sourceSpec, c1), t = nodeBoundary(target, targetSpec, c2);
        candidates.push({ path: `M ${n(s)} C ${n(c1)} ${n(c2)} ${n(t)}`, points: cubic(s, c1, c2, t) });
      }
      if (edge.routing === 'outside') candidate = candidates.slice(-2).sort((p, q) => hits(p) - hits(q))[0]!;
      else candidate = [candidate, ...candidates].sort((p, q) => hits(p) - hits(q))[0]!;
    }
    path = candidate.path; points = candidate.points;
  }
  const arrowPolygons: Point[][] = [];
  const arrowAt = (tip: Point, before: Point) => {
    const angle = Math.atan2(tip.y - before.y, tip.x - before.x), length = 13, spread = 5.5;
    arrowPolygons.push([tip, { x: tip.x - Math.cos(angle) * length + Math.sin(angle) * spread, y: tip.y - Math.sin(angle) * length - Math.cos(angle) * spread }, { x: tip.x - Math.cos(angle) * length - Math.sin(angle) * spread, y: tip.y - Math.sin(angle) * length + Math.cos(angle) * spread }]);
  };
  if ((edge.direction ?? 'forward') !== 'none') arrowAt(points[points.length - 1]!, points[points.length - 3] ?? points[0]!);
  if (edge.direction === 'both') arrowAt(points[0]!, points[2] ?? points[points.length - 1]!);
  return { id: edge.id, path, points, seed: seed(`edge:${edge.id}`, previous?.seed), arrowheads: arrowPolygons.map(p => pathBounds(p, 2)), arrowPolygons, fontSize: edge.style?.fontSize ?? EDGE_SIZE, font: edge.style?.font ?? defaultFont(spec) };
}
function placeEdgeLabels(spec: DiagramSpec, edges: Record<string, EdgeGeometry>, nodes: Record<string, NodeGeometry>, groups: Record<string, GroupGeometry>, annotations: Bounds[] = []): void {
  const labels: Bounds[] = [], nodeBounds = Object.values(nodes), titleBounds = [...Object.values(groups).map(group => group.titleBounds), ...annotations];
  for (const edgeSpec of spec.edges ?? []) {
    const edge = edges[edgeSpec.id]!;
    if (!edgeSpec.label && edgeSpec.certainty !== 'hypothesis') continue;
    const content = `${edgeSpec.label ?? ''}${edgeSpec.certainty === 'hypothesis' ? ' ?' : ''}`.trim();
    const lines = wrapText(content, 240, edge.fontSize, edge.font), measured = textMeasure(lines, edge.fontSize, edge.font), width = measured.width + 12, height = measured.height + 6;
    const candidates: Bounds[] = [];
    for (const fraction of [0.5, 0.35, 0.65, 0.25, 0.75]) {
      const sample = (edge.points.length - 1) * fraction, i = Math.min(edge.points.length - 2, Math.floor(sample)), before = edge.points[i]!, q = edge.points[i + 1]!, t = sample - i;
      const p = { x: before.x + (q.x - before.x) * t, y: before.y + (q.y - before.y) * t }, angle = Math.atan2(q.y - before.y, q.x - before.x);
      for (const displacement of [height / 2 + 7, -(height / 2 + 7), height + 36, -height - 36, height * 2 + 48, -height * 2 - 48]) candidates.push({ x: p.x - Math.sin(angle) * displacement - width / 2, y: p.y + Math.cos(angle) * displacement - height / 2, width, height });
    }
    const score = (box: Bounds) => {
      const midpoint = center(box), ownPathDistance = Math.min(...edge.points.map(point => Math.hypot(point.x - midpoint.x, point.y - midpoint.y)));
      return nodeBounds.filter(node => overlaps(box, node, 5)).length * 1000 + labels.filter(other => overlaps(box, other, 5)).length * 500 + titleBounds.filter(other => overlaps(box, other, 6)).length * 1000 + Object.values(edges).filter(other => other.id !== edge.id && pathHitsBox(other.points, expand(box, 3))).length * 80 + ownPathDistance / 4;
    };
    edge.labelBounds = candidates.sort((a, b) => score(a) - score(b))[0]!; edge.labelLines = lines; labels.push(edge.labelBounds);
  }
}
function makeNotes(spec: DiagramSpec, nodes: Record<string, NodeGeometry>, groups: Record<string, GroupGeometry>, edges: Record<string, EdgeGeometry>, previous?: LayoutState): Record<string, NoteGeometry> {
  const notes: Record<string, NoteGeometry> = {}, obstacleBounds: Bounds[] = [...Object.values(nodes), ...Object.values(groups).map(g => g.titleBounds), ...Object.values(edges).map(e => e.labelBounds).filter((b): b is Bounds => !!b)];
  const drawing = union([...Object.values(nodes), ...Object.values(groups)]);
  for (const note of spec.notes ?? []) {
    const size = note.style?.fontSize ?? 22, font = note.style?.font ?? defaultFont(spec), lines = wrapText(note.text, 260, size, font), measured = textMeasure(lines, size, font), width = measured.width + 28, height = measured.height + 28;
    const attachment = note.attachTo ? nodes[note.attachTo] ?? groups[note.attachTo] : undefined;
    const old = previous?.notes[note.id];
    let x = note.position?.x ?? old?.x ?? (attachment ? right(attachment) + 36 : drawing.x), y = note.position?.y ?? old?.y ?? (attachment ? attachment.y : bottom(drawing) + 60);
    if (!note.position) for (let i = 0; i < 30 && (obstacleBounds.some(box => overlaps({ x, y, width, height }, box, 16)) || Object.values(edges).some(edge => pathHitsBox(edge.points, expand({ x, y, width, height }, 12)))); i++) y += height + 30;
    const value: NoteGeometry = { id: note.id, x, y, width, height, seed: seed(`note:${note.id}`, old?.seed), textBounds: { x: x + 14, y: y + 14, ...measured }, lines, fontSize: size, font };
    notes[note.id] = value; obstacleBounds.push(value);
  }
  return notes;
}
function checkGeometry(spec: DiagramSpec, layout: LayoutState, diagnostics: Diagnostic[]): void {
  const nodes = Object.values(layout.nodes), groups = Object.values(layout.groups), notes = Object.values(layout.notes), edges = Object.values(layout.edges), pins = pinnedIds(spec);
  const labelBoxes = edges.filter(edge => edge.labelBounds).map(edge => ({ id: edge.id, bounds: edge.labelBounds! }));
  const standaloneText = [
    ...groups.map(group => ({ id: group.id, bounds: group.titleBounds })),
    ...notes.map(note => ({ id: note.id, bounds: note })),
    ...nodes.flatMap(node=>[...(node.labelPosition && node.labelPosition !== 'inside' ? [{id:node.id,bounds:node.textBounds}]:[]),...(node.captionBounds?[{id:node.id,bounds:node.captionBounds}]:[])]),
    ...[...Object.values(layout.lanes??{}),...Object.values(layout.rows??{})].flatMap(lane=>[{id:lane.id,bounds:lane.titleBounds},...(lane.captionBounds?[{id:lane.id,bounds:lane.captionBounds}]:[])]),
    ...(layout.titleBounds ? [{ id: 'diagram-title', bounds: layout.titleBounds }] : []),
    ...(layout.subtitleBounds ? [{ id: 'diagram-subtitle', bounds: layout.subtitleBounds }] : []),
    ...(layout.legendBounds ? [{ id: 'diagram-legend', bounds: layout.legendBounds }] : []),
  ];
  const checkGlyphs = (id: string, text: string, font: FontName, bounds: Bounds) => {
    const loaded = getFont(font), missing = [...new Set(Array.from(text).filter(character => !/\s/u.test(character) && !loaded.hasGlyphForCodePoint(character.codePointAt(0)!)))];
    if (missing.length) diagnostics.push(diagnostic('error', 'unsupported_glyph', [id], bounds, `The bundled ${font} font has no glyph for ${JSON.stringify(missing.slice(0, 8).join(''))}. The complete text remains in the SVG; publication requires font coverage.`, ['font_coverage', 'use_supported_font']));
  };
  checkGlyphs('diagram-title', spec.title, defaultFont(spec,true), layout.titleBounds!);
  if (spec.subtitle) checkGlyphs('diagram-subtitle', spec.subtitle, defaultFont(spec), layout.subtitleBounds!);
  if (spec.legend) checkGlyphs('diagram-legend', spec.legend, defaultFont(spec), layout.legendBounds!);
  for (const group of spec.groups ?? []) checkGlyphs(group.id, group.title, group.style?.font ?? defaultFont(spec,true), layout.groups[group.id]!.titleBounds);
  for (const note of spec.notes ?? []) checkGlyphs(note.id, note.text, note.style?.font ?? defaultFont(spec), layout.notes[note.id]!.textBounds);
  for (const edge of spec.edges ?? []) if (edge.label) checkGlyphs(edge.id, edge.label, edge.style?.font ?? defaultFont(spec), layout.edges[edge.id]!.labelBounds!);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) if (overlaps(node, nodes[j]!, 4)) {
      const bothPinned = pins.has(node.id) && pins.has(nodes[j]!.id);
      diagnostics.push(diagnostic('error', bothPinned ? 'pinned_overlap' : 'node_overlap', [node.id, nodes[j]!.id], union([node, nodes[j]!]), bothPinned ? 'Pinned nodes overlap. Change a pin or increase separation; the renderer kept both pinned coordinates.' : 'Node shapes overlap.', bothPinned ? ['change_constraints'] : ['local_spacing']));
    }
    if ((!node.labelPosition || node.labelPosition === 'inside') && (node.textBounds.x < node.x + 6 || node.textBounds.y < node.y + 6 || right(node.textBounds) > right(node) - 6 || bottom(node.textBounds) > bottom(node) - 6)) diagnostics.push(diagnostic('error', 'text_outside_shape', [node.id], union([node, node.textBounds]), 'The measured label exceeds the allocated node dimensions.', ['resize_node', 'increase_label_width']));
    if (node.fontSize < 16) diagnostics.push(diagnostic('warning', 'small_text', [node.id], node.textBounds, 'Text is smaller than 16 px at 1x viewing scale.', ['increase_font_size']));
    const nodeSpec = spec.nodes.find(item => item.id === node.id)!;
    checkGlyphs(node.id, nodeSpec.label, node.font, node.textBounds);
    if(nodeSpec.caption)checkGlyphs(node.id,nodeSpec.caption,node.font,node.captionBounds!);
    if (nodeSpec.label.split(/\s+/).some(word => measureText(word, node.fontSize, node.font) > (nodeSpec.labelPosition && nodeSpec.labelPosition !== 'inside' ? Math.max(nodeSpec.width??0,280) : nodeSpec.width ?? 280) - PADDING * 2)) diagnostics.push(diagnostic(nodeSpec.width ? 'error' : 'warning', 'unbreakable_label', [node.id], node.textBounds, 'A word exceeds the requested wrapping width. The renderer retained the complete word.', ['increase_label_width', 'supply_explicit_line_break']));
    for (const text of standaloneText) if (node.id !== text.id && overlaps(node, text.bounds, 4)) diagnostics.push(diagnostic('error', 'annotation_node_collision', [node.id, text.id], union([node, text.bounds]), 'A node overlaps a note, diagram title, or group title.', ['move_annotation', 'local_spacing']));
  }
  for (let i = 0; i < standaloneText.length; i++) for (let j = i + 1; j < standaloneText.length; j++) {
    const a = standaloneText[i]!, b = standaloneText[j]!;
    if (a.id !== b.id && overlaps(a.bounds, b.bounds, 4)) diagnostics.push(diagnostic('error', 'annotation_collision', [a.id, b.id], union([a.bounds, b.bounds]), 'Notes or titles overlap.', ['move_annotation', 'increase_group_padding']));
  }
  for (const edgeSpec of spec.edges ?? []) {
    const edge = layout.edges[edgeSpec.id]!;
    for (const node of nodes) if (node.id !== edgeSpec.source && node.id !== edgeSpec.target && pathHitsBox(edge.points, node, 1)) diagnostics.push(diagnostic('error', 'edge_through_node', [edge.id, node.id], node, 'A relationship enters an unrelated node interior.', ['reroute_edge', 'local_spacing']));
    for (const text of standaloneText) if (pathHitsBox(edge.points, text.bounds)) diagnostics.push(diagnostic('error', 'edge_through_annotation', [edge.id, text.id], text.bounds, 'A relationship passes through a title or note.', ['reroute_edge', 'move_annotation']));
    if (edge.labelBounds) {
      for (const node of nodes) if (overlaps(edge.labelBounds, node, 3)) diagnostics.push(diagnostic('error', 'label_node_collision', [edge.id, node.id], union([edge.labelBounds, node]), 'A relationship label overlaps a node.', ['move_edge_label', 'reroute_edge']));
      for (const text of standaloneText) if (overlaps(edge.labelBounds, text.bounds, 3)) diagnostics.push(diagnostic('error', 'label_annotation_collision', [edge.id, text.id], union([edge.labelBounds, text.bounds]), 'A relationship label overlaps a note or title.', ['move_edge_label', 'move_annotation']));
      for (const other of edges) if (other.id !== edge.id && pathHitsBox(other.points, edge.labelBounds)) diagnostics.push(diagnostic('warning', 'label_path_collision', [edge.id, other.id], edge.labelBounds, 'Another relationship crosses this label.', ['move_edge_label', 'reroute_edge']));
    }
    for (const arrow of edge.arrowheads) for (const node of nodes) if (overlaps(arrow, node.textBounds, -2)) diagnostics.push(diagnostic('error', 'arrow_in_text', [edge.id, node.id], arrow, 'An arrowhead touches node text.', ['reroute_edge', 'increase_node_padding']));
    if (edge.fontSize < 16 && edge.labelBounds) diagnostics.push(diagnostic('warning', 'small_text', [edge.id], edge.labelBounds, 'Relationship text is smaller than 16 px at 1x scale.', ['increase_font_size']));
  }
  for (let i = 0; i < labelBoxes.length; i++) for (let j = i + 1; j < labelBoxes.length; j++) if (overlaps(labelBoxes[i]!.bounds, labelBoxes[j]!.bounds, 3)) diagnostics.push(diagnostic('error', 'label_overlap', [labelBoxes[i]!.id, labelBoxes[j]!.id], union([labelBoxes[i]!.bounds, labelBoxes[j]!.bounds]), 'Relationship labels overlap.', ['move_edge_label', 'reroute_edge']));
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = (spec.edges ?? []).find(edge => edge.id === edges[i]!.id)!, b = (spec.edges ?? []).find(edge => edge.id === edges[j]!.id)!;
    const interior = (edge: EdgeGeometry, definition: EdgeSpec) => edge.points.filter(point => !contains(expand(layout.nodes[definition.source]!, 16), point) && !contains(expand(layout.nodes[definition.target]!, 16), point));
    const aInterior = interior(edges[i]!, a), bInterior = interior(edges[j]!, b);
    if (!aInterior.length || !bInterior.length || !overlaps(pathBounds(aInterior, 3), pathBounds(bInterior, 3))) continue;
    const crossing = pathsIntersect(aInterior, bInterior);
    if (crossing) diagnostics.push(diagnostic('warning', 'edge_crossing', [a.id, b.id], expand({ ...crossing, width: 0, height: 0 }, 10), 'Relationships cross. Check that ownership and direction remain clear.', ['reroute_edge', 'alternate_view']));
  }
  for (const group of groups) {
    for (const memberId of groupMembers(spec, group.id)) {
      const node = layout.nodes[memberId]!;
      if (node.x < group.x || node.y < bottom(group.titleBounds) + 8 || right(node) > right(group) || bottom(node) > bottom(group)) diagnostics.push(diagnostic('error', 'member_outside_group', [group.id, memberId], union([group, node]), 'A group does not contain its member with title clearance.', ['increase_group_padding', 'local_spacing']));
    }
    for (const node of nodes) if (!groupMembers(spec, group.id).includes(node.id) && overlaps(group, node, -4)) diagnostics.push(diagnostic('warning', 'unrelated_node_in_group', [group.id, node.id], node, 'An unrelated node overlaps this group region.', ['move_group_members', 'local_spacing']));
  }
  for (const constraint of spec.layout?.relative ?? []) {
    const node = layout.nodes[constraint.nodeId]!, other = layout.nodes[constraint.relativeTo]!, gap = constraint.gap ?? spec.layout?.gap ?? 80;
    const valid = constraint.direction === 'right' ? node.x >= right(other) + gap - 0.5 : constraint.direction === 'left' ? right(node) <= other.x - gap + 0.5 : constraint.direction === 'below' ? node.y >= bottom(other) + gap - 0.5 : bottom(node) <= other.y - gap + 0.5;
    if (!valid) diagnostics.push(diagnostic('error', 'relative_constraint_conflict', [node.id, other.id], union([node, other]), 'Collision repair could not satisfy this relative placement constraint.', ['change_constraints', 'increase_spacing']));
  }
  for(const lane of Object.values(layout.lanes??{})) {
    for(const other of Object.values(layout.lanes??{})) if(lane.id<other.id && overlaps(lane,other,4))diagnostics.push(diagnostic('error','lane_overlap',[lane.id,other.id],union([lane,other]),'Lane boundaries overlap.',['local_spacing']));
    const definition=spec.lanes?.find(l=>l.id===lane.id);if(definition){checkGlyphs(lane.id,definition.label,defaultFont(spec,true),lane.titleBounds);if(definition.caption)checkGlyphs(lane.id,definition.caption,defaultFont(spec),lane.captionBounds!);}
    for(const nodeSpec of spec.nodes.filter(n=>n.lane===lane.id)){const member=nodeFootprint(layout.nodes[nodeSpec.id]);if(member.x<lane.x || right(member)>right(lane) || member.y<bottom(lane.captionBounds??lane.titleBounds)+8 || bottom(member)>bottom(lane))diagnostics.push(diagnostic('error','outside_lane',[lane.id,nodeSpec.id],union([lane,member]),'Node does not fit its lane.',['local_spacing']));}
  }
  for(const definition of spec.rows??[]){const row=layout.rows?.[definition.id];if(row)checkGlyphs(row.id,definition.label,defaultFont(spec,true),row.titleBounds);}
  const allBounds = [...Object.values(layout.lanes??{}),...Object.values(layout.rows??{}),...nodes, ...nodes.map(n => n.textBounds), ...groups, ...notes, ...edges.map(e => pathBounds(e.points, 4)), ...edges.flatMap(e => e.arrowheads), ...labelBoxes.map(item => item.bounds), ...standaloneText.map(item => item.bounds)];
  for (const bounds of allBounds) if (bounds.x < layout.viewport.x || bounds.y < layout.viewport.y || right(bounds) > right(layout.viewport) || bottom(bounds) > bottom(layout.viewport)) diagnostics.push(diagnostic('error', 'content_outside_viewport', [], bounds, 'Content exceeds the exported document bounds.', ['expand_viewport']));
  if (spec.nodes.length > 30 && (spec.edges?.length ?? 0) > spec.nodes.length * 2) diagnostics.push(diagnostic('warning', 'dense_graph', [spec.id], layout.viewport, 'This dense graph may need alternate views for readable relationship ownership.', ['alternate_view', 'increase_spacing']));
}
export function escape(text: string): string { return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!); }
function round(value: number): string { return value.toFixed(2); }
function attrs(box: Bounds): string { return `x="${round(box.x)}" y="${round(box.y)}" width="${round(box.width)}" height="${round(box.height)}"`; }
export function renderText(lines: string[], bounds: Bounds, fontSize: number, font: FontName, color: string, align: 'left' | 'center' = 'left'): string {
  const loaded = getFont(font), ascent = loaded.ascent / loaded.unitsPerEm * fontSize;
  const y = bounds.y + (lineHeight(fontSize) - (loaded.ascent - loaded.descent) / loaded.unitsPerEm * fontSize) / 2 + ascent;
  const x = align === 'center' ? bounds.x + bounds.width / 2 : bounds.x;
  return `<text font-family="${font === 'sans' ? 'DiagramSans' : font === 'body' ? 'SketchBody' : 'SketchHeading'}" font-size="${fontSize}" fill="${escape(color)}" text-anchor="${align === 'center' ? 'middle' : 'start'}">${lines.map((line, i) => `<tspan x="${round(x)}" y="${round(y + i * lineHeight(fontSize))}">${escape(line)}</tspan>`).join('')}</text>`;
}
function sketch(drawable: ReturnType<typeof generator.rectangle>, dashed = false): string {
  return generator.toPaths(drawable).map(path => `<path d="${path.d}" stroke="${path.stroke}" stroke-width="${path.strokeWidth}" fill="${path.fill || 'none'}"${dashed ? ' stroke-dasharray="8 6"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`).join('');
}
function roundedPath(b: Bounds): string {
  const r = Math.min(14, b.width / 4, b.height / 4);
  return `M ${b.x + r} ${b.y} H ${right(b) - r} Q ${right(b)} ${b.y} ${right(b)} ${b.y + r} V ${bottom(b) - r} Q ${right(b)} ${bottom(b)} ${right(b) - r} ${bottom(b)} H ${b.x + r} Q ${b.x} ${bottom(b)} ${b.x} ${bottom(b) - r} V ${b.y + r} Q ${b.x} ${b.y} ${b.x + r} ${b.y} Z`;
}
function renderSvg(spec: DiagramSpec, layout: LayoutState, diagnostics: Diagnostic[], debug = false): string {
  const loaded = getFonts(), viewport = layout.viewport, transparent = spec.theme?.background === 'transparent' || spec.theme?.background === 'none', background = spec.theme?.background ?? '#ffffff';
  const pieces: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${round(viewport.width)}" height="${round(viewport.height)}" viewBox="${round(viewport.x)} ${round(viewport.y)} ${round(viewport.width)} ${round(viewport.height)}" role="img" aria-labelledby="svg-title" data-diagram-id="${escape(spec.id)}" data-spec-hash="${layout.specHash}"><title id="svg-title">${escape(spec.title)}</title><defs><style>${fontCss(spec.schemaVersion === 2)}</style></defs>`];
  pieces.push(`<rect id="diagram-background" ${attrs(viewport)} fill="${transparent ? 'none' : escape(background)}"/>`);
  for(const lane of Object.values(layout.lanes??{})){pieces.push(`<g data-lane-id="${escape(lane.id)}"><rect ${attrs(lane)} rx="18" fill="none" stroke="${escape(spec.theme?.stroke??'#28303a')}" stroke-width="1.5"/>${renderText(lane.titleLines,lane.titleBounds,24,defaultFont(spec,true),spec.theme?.stroke??'#28303a')}${lane.captionBounds?renderText(lane.captionLines!,lane.captionBounds,20,defaultFont(spec),spec.theme?.stroke??'#28303a'):''}</g>`);}
  for(const row of Object.values(layout.rows??{})) pieces.push(renderText(row.titleLines,row.titleBounds,22,defaultFont(spec,true),spec.theme?.stroke??'#28303a'));
  for (const groupSpec of spec.groups ?? []) {
    const group = layout.groups[groupSpec.id]!, style = styleFor(spec, groupSpec.style), border = groupSpec.boundary ?? 'dashed';
    pieces.push(`<g id="group-${escape(group.id)}" data-element-id="${escape(group.id)}"${style.emphasis === 'muted' ? ' opacity="0.68"' : ''}>`);
    pieces.push(sketch(generator.rectangle(group.x, group.y, group.width, group.height, { seed: group.seed, roughness: style.roughness, stroke: border === 'none' ? 'none' : style.stroke, strokeWidth: style.strokeWidth, fill: groupSpec.fill ?? groupSpec.style?.fill ?? 'none', fillStyle: 'solid' }), border === 'dashed'));
    pieces.push(renderText(group.titleLines, group.titleBounds, groupSpec.style?.fontSize ?? 25, groupSpec.style?.font ?? defaultFont(spec,true), style.stroke)); pieces.push('</g>');
  }
  for (const edgeSpec of spec.edges ?? []) {
    const edge = layout.edges[edgeSpec.id]!, style = styleFor(spec, edgeSpec.style);
    pieces.push(`<g id="edge-${escape(edge.id)}" data-element-id="${escape(edge.id)}"${style.emphasis === 'muted' ? ' opacity="0.68"' : ''}>`);
    pieces.push(sketch(generator.path(edge.path, { seed: edge.seed, roughness: style.roughness, stroke: style.stroke, strokeWidth: style.strokeWidth }), edgeSpec.certainty === 'hypothesis'));
    for (const arrow of edge.arrowPolygons) pieces.push(`<polygon points="${arrow.map(point => `${round(point.x)},${round(point.y)}`).join(' ')}" fill="${escape(style.stroke)}"/>`);
    pieces.push('</g>');
  }
  for (const nodeSpec of spec.nodes) {
    const node = layout.nodes[nodeSpec.id]!, style = styleFor(spec, nodeSpec.style), options = { seed: node.seed, stroke: style.stroke, strokeWidth: style.strokeWidth, roughness: style.roughness, fill: style.fill, fillStyle: 'solid' as const };
    pieces.push(`<g id="node-${escape(node.id)}" data-element-id="${escape(node.id)}"${style.emphasis === 'muted' ? ' opacity="0.68"' : ''}>`);
    if (nodeSpec.shape === 'ellipse' || nodeSpec.shape === 'circle') pieces.push(sketch(generator.ellipse(node.x + node.width / 2, node.y + node.height / 2, node.width, node.height, options)));
    else if (nodeSpec.shape === 'rectangle') pieces.push(sketch(generator.rectangle(node.x, node.y, node.width, node.height, options)));
    else if (nodeSpec.shape !== 'text') pieces.push(sketch(generator.path(roundedPath(node), options)));
    if(nodeSpec.style?.highlight ?? spec.theme?.highlight) pieces.push(`<rect ${attrs(node.textBounds)} fill="${escape((nodeSpec.style?.highlight ?? spec.theme?.highlight)!)}"/>`);
    pieces.push(renderText(node.lines, node.textBounds, node.fontSize, node.font, style.stroke, 'center'));
    if(node.captionBounds) pieces.push(renderText(node.captionLines!,node.captionBounds,20,node.font,style.stroke,'center')); pieces.push('</g>');
  }
  for (const edgeSpec of spec.edges ?? []) {
    const edge = layout.edges[edgeSpec.id]!;
    if (!edge.labelBounds) continue;
    const style = styleFor(spec, edgeSpec.style);
    pieces.push(`<g data-edge-label="${escape(edge.id)}">`);
    if (!transparent) pieces.push(`<rect class="label-background" ${attrs(edge.labelBounds)} rx="5" fill="${escape(background)}"/>`);
    pieces.push(renderText(edge.labelLines!, { ...edge.labelBounds, x: edge.labelBounds.x + 6, y: edge.labelBounds.y + 3, width: edge.labelBounds.width - 12, height: edge.labelBounds.height - 6 }, edge.fontSize, edge.font ?? 'body', style.stroke, 'center')); pieces.push('</g>');
  }
  for (const noteSpec of spec.notes ?? []) {
    const note = layout.notes[noteSpec.id]!, style = styleFor(spec, noteSpec.style);
    pieces.push(`<g id="note-${escape(note.id)}" data-element-id="${escape(note.id)}"${style.emphasis === 'muted' ? ' opacity="0.68"' : ''}>`);
    const attached = noteSpec.attachTo ? layout.nodes[noteSpec.attachTo] ?? layout.groups[noteSpec.attachTo] : undefined;
    if (attached) { const a = boundary(attached, center(note)), b = boundary(note, center(attached)); pieces.push(`<path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" fill="none" stroke="${escape(style.stroke)}" stroke-width="1" stroke-dasharray="3 6"/>`); }
    pieces.push(sketch(generator.rectangle(note.x, note.y, note.width, note.height, { seed: note.seed, stroke: style.stroke, strokeWidth: 1, roughness: style.roughness, fill: noteSpec.style?.fill ?? (noteSpec.style?.presentation==='plain' ? 'none' : '#fff6cc'), fillStyle: 'solid' })));
    pieces.push(renderText(note.lines, note.textBounds, note.fontSize, note.font ?? 'body', style.stroke)); pieces.push('</g>');
  }
  if (layout.titleBounds) pieces.push(renderText(wrapText(spec.title, 900, TITLE_SIZE, defaultFont(spec,true)), layout.titleBounds, TITLE_SIZE, defaultFont(spec,true), spec.theme?.stroke ?? '#28303a'));
  if (layout.subtitleBounds) pieces.push(renderText(wrapText(spec.subtitle!, 900, 22,defaultFont(spec)), layout.subtitleBounds, 22, defaultFont(spec), spec.theme?.stroke ?? '#28303a'));
  if (layout.legendBounds) pieces.push(renderText(wrapText(spec.legend!, 900, 20,defaultFont(spec)), layout.legendBounds, 20, defaultFont(spec), spec.theme?.stroke ?? '#28303a'));
  if (debug) {
    pieces.push('<g id="diagnostics-overlay" font-family="monospace" font-size="12" pointer-events="none">');
    for (const element of [...Object.values(layout.nodes), ...Object.values(layout.groups), ...Object.values(layout.notes)]) pieces.push(`<rect ${attrs(element)} fill="none" stroke="#1675c0" stroke-width="1" stroke-dasharray="3 3"/><text x="${element.x}" y="${element.y - 4}" fill="#1675c0">${escape(element.id)}</text>`);
    for (const edge of Object.values(layout.edges)) { for (const bounds of [edge.labelBounds, ...edge.arrowheads].filter((b): b is Bounds => !!b)) pieces.push(`<rect ${attrs(bounds)} fill="none" stroke="#9050a0" stroke-width="1"/>`); }
    for (const finding of diagnostics) if (finding.severity !== 'info') pieces.push(`<rect ${attrs(finding.bounds)} fill="${finding.severity === 'error' ? '#ff0000' : '#ffb000'}" fill-opacity="0.1" stroke="${finding.severity === 'error' ? '#cc2222' : '#c08000'}" stroke-width="2"/><text x="${finding.bounds.x}" y="${finding.bounds.y - 5}" fill="#cc2222">${escape(finding.code)}: ${escape(finding.ids.join(', '))}</text>`);
    pieces.push('</g>');
  }
  pieces.push('</svg>'); return pieces.join('\n');
}
export function renderDiagram(spec: DiagramSpec, previousLayout?: LayoutState): RenderResult {
  getFonts();
  if(previousLayout)previousLayout={...previousLayout,nodes:Object.assign(Object.create(null),previousLayout.nodes),edges:Object.assign(Object.create(null),previousLayout.edges),groups:Object.assign(Object.create(null),previousLayout.groups),notes:Object.assign(Object.create(null),previousLayout.notes)};
  const diagnostics: Diagnostic[] = [];
  const titleLines = wrapText(spec.title, 900, TITLE_SIZE, defaultFont(spec,true)), titleBounds = { x: 80, y: 28, ...textMeasure(titleLines, TITLE_SIZE, defaultFont(spec,true)) };
  const subtitleBounds = spec.subtitle ? { x: 80, y: bottom(titleBounds) + 5, ...textMeasure(wrapText(spec.subtitle, 900, 22,defaultFont(spec)), 22,defaultFont(spec)) } : undefined;
  const startY = bottom(subtitleBounds ?? titleBounds) + 30;
  const nodes = placeNodes(spec, previousLayout, diagnostics, startY), groups = makeGroups(spec, nodes, previousLayout), edges: Record<string, EdgeGeometry> = {};
  const pairEdges = new Map<string, EdgeSpec[]>();
  for (const edge of spec.edges ?? []) { const key = [edge.source, edge.target].sort().join('|'); pairEdges.set(key, [...(pairEdges.get(key) ?? []), edge]); }
  const {lanes,rows}=makeLanes(spec,nodes);
  const headerBounds = [titleBounds, ...(subtitleBounds ? [subtitleBounds] : []),...Object.values(nodes).flatMap(n=>[...(n.labelPosition && n.labelPosition !== 'inside'?[n.textBounds]:[]),...n.captionBounds?[n.captionBounds]:[]]),...[...Object.values(lanes),...Object.values(rows)].flatMap(l=>[l.titleBounds,...l.captionBounds?[l.captionBounds]:[]])];
  for (const edge of spec.edges ?? []) { const parallel = pairEdges.get([edge.source, edge.target].sort().join('|'))!; edges[edge.id] = routeEdge(spec, edge, nodes, parallel.indexOf(edge), parallel.length, previousLayout?.edges[edge.id], [...headerBounds, ...Object.values(groups).map(group => group.titleBounds)]); }
  placeEdgeLabels(spec, edges, nodes, groups, headerBounds);
  const notes = makeNotes(spec, nodes, groups, edges, previousLayout), contentBounds: Bounds[] = [titleBounds, ...Object.values(lanes),...Object.values(rows), ...Object.values(nodes), ...Object.values(nodes).map(node => node.textBounds), ...Object.values(nodes).flatMap(node=>node.captionBounds?[node.captionBounds]:[]), ...Object.values(groups), ...Object.values(notes), ...Object.values(edges).map(edge => pathBounds(edge.points, 5)), ...Object.values(edges).flatMap(edge => [...edge.arrowheads, ...(edge.labelBounds ? [edge.labelBounds] : [])])];
  if (subtitleBounds) contentBounds.push(subtitleBounds);
  const drawing = union(contentBounds), legendBounds = spec.legend ? { x: drawing.x, y: bottom(drawing) + 32, ...textMeasure(wrapText(spec.legend, 900, 20,defaultFont(spec)), 20,defaultFont(spec)) } : undefined;
  if (legendBounds) contentBounds.push(legendBounds);
  const viewport = expand(union(contentBounds), 28);
  const layout: LayoutState = { specHash: hashSpec(spec), engineVersion: spec.schemaVersion===2?'2.0.0':ENGINE_VERSION, fontVersion: spec.schemaVersion===2?'bundled-sketch-noto-1':FONT_VERSION, nodes, groups, edges, notes, ...(spec.schemaVersion===2?{lanes,rows}:{}), viewport, titleBounds, ...(subtitleBounds ? { subtitleBounds } : {}), ...(legendBounds ? { legendBounds } : {}) };
  // Bounds aliases keep exported geometry convenient for capture and external consumers.
  Object.assign(layout, { bounds: viewport });
  for (const element of [...Object.values(nodes), ...Object.values(groups), ...Object.values(notes)]) Object.assign(element, { bounds: spec.schemaVersion===2 && 'textBounds' in element ? union([{x:element.x,y:element.y,width:element.width,height:element.height}, element.textBounds,...('captionBounds' in element && element.captionBounds?[element.captionBounds as Bounds]:[])]) : { x: element.x, y: element.y, width: element.width, height: element.height } });
  for (const edge of Object.values(edges)) Object.assign(edge, { bounds: union([pathBounds(edge.points, 5), ...edge.arrowheads, ...(edge.labelBounds ? [edge.labelBounds] : [])]) });
  checkGeometry(spec, layout, diagnostics);
  return { svg: renderSvg(spec, layout, diagnostics), debugSvg: renderSvg(spec, layout, diagnostics, true), layout, diagnostics };
}
