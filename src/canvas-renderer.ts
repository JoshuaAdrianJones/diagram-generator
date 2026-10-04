import { hashSpec } from './schema.js';
import { assertCanvas, type CanvasSpec, type FrameSpec, type DocumentTheme, type DocumentStyle } from './documents.js';
import { renderDiagram, fontCss, renderText, wrapText, textMeasure, getFont, escape, type FontName, type LayoutState, type RenderResult, type Diagnostic } from './renderer.js';
import { boundary, center, right, bottom, expand, union, overlaps, pathBounds, polyline, pathHitsBox, type Bounds, type Point } from './geometry.js';

export interface PanelText { lines: string[]; bounds: Bounds; font: FontName; size: number; style?: DocumentStyle; quote?: boolean }
export interface FrameGeometry extends Bounds {
  id: string; title: string; contentOffset: Point; graph?: LayoutState; panel?: PanelText[];
  titleText?: PanelText; captionText?: PanelText; contentBounds: Bounds;
}
export interface CanvasLinkGeometry { id: string; bounds: Bounds; points: Point[]; labelBounds: Bounds; labelLines: string[]; leaderPoints: Point[] }
export interface CanvasLayoutState {
  specHash: string; engineVersion: string; fontVersion: string; viewport: Bounds; bounds: Bounds;
  frames: Record<string,FrameGeometry>; regions: Record<string,Bounds>; links: Record<string,CanvasLinkGeometry>;
  annotations: Record<string,Bounds>; titleBounds: Bounds; subtitleBounds?: Bounds;
}
export interface CanvasRenderResult { svg: string; debugSvg: string; layout: CanvasLayoutState; diagnostics: Diagnostic[]; frameSvgs: Record<string,string> }
const attrs=(b:Bounds)=>`x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"`;
export const moveBounds=(b:Bounds,p:Point):Bounds=>({...b,x:b.x+p.x,y:b.y+p.y});
function issue(code:string,ids:string[],bounds:Bounds,message:string):Diagnostic {return {severity:'error',code,ids,bounds,message,repairClasses:['canvas_placement']};}
function textBlock(text:string,width:number,size:number,font:FontName,x=0,y=0,style?:DocumentStyle):PanelText {
  const lines=wrapText(text,width,size,font);return {lines,bounds:{x,y,...textMeasure(lines,size,font)},size,font,style};
}
function textSvg(block:PanelText,stroke:string) {
  return `${block.quote?`<path d="M ${block.bounds.x-10} ${block.bounds.y} V ${bottom(block.bounds)}" stroke="${escape(stroke)}" stroke-width="2"/>`:''}${block.style?.highlight?`<rect ${attrs(block.bounds)} fill="${escape(block.style.highlight)}"/>`:''}<g${block.style?.emphasis==='muted'?' opacity="0.68"':''}${block.style?.emphasis==='strong'?` stroke="${escape(block.style?.stroke??stroke)}" stroke-width="0.5" paint-order="stroke fill"`:''}>${renderText(block.lines,block.bounds,block.size,block.font,block.style?.stroke??stroke)}</g>`;
}
function checkText(block:PanelText,id:string,diagnostics:Diagnostic[]) {
  const font=getFont(block.font);
  if(block.lines.some(line=>Array.from(line).some(char=>!/\s/u.test(char)&&!font.hasGlyphForCodePoint(char.codePointAt(0)!))))diagnostics.push(issue('unsupported_glyph',[id],block.bounds,'The bundled font cannot display all text.'));
}
function innerSvg(svg:string,prefix:string) {
  const inner=svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>')).replace(/<defs>[\s\S]*?<\/defs>/g,'');
  // IDs and their references use the same prefix. Never change displayed text or provenance IDs.
  return inner.replace(/\bid="([^"]+)"/g,(_,id)=>`id="${prefix}:${id}"`).replace(/url\(#([^)]+)\)/g,(_,id)=>`url(#${prefix}:${id})`).replace(/aria-labelledby="([^"]+)"/g,(_,id)=>`aria-labelledby="${prefix}:${id}"`);
}
export function frameElementBounds(frame:FrameGeometry,ids?:string[]):Bounds {
  if(!ids?.length || !frame.graph)return frame;
  const elements=ids.map(id=>frame.graph!.nodes[id]??frame.graph!.edges[id]??frame.graph!.groups[id]??frame.graph!.notes[id]).map(e=>e.bounds??e as Bounds);
  return moveBounds(union(elements),{x:frame.x+frame.contentOffset.x,y:frame.y+frame.contentOffset.y});
}
function routeLink(source:Bounds,target:Bounds,obstacles:Bounds[]):Point[] {
  const a=boundary(source,center(target)),b=target.width===0&&target.height===0?center(target):boundary(target,center(source));
  const clear=(points:Point[])=>{const sampled=polyline(points);return !obstacles.some(box=>pathHitsBox(sampled,expand(box,12)))&&!pathHitsBox(sampled,source)&&!pathHitsBox(sampled,target);};
  if(clear([a,b]))return [a,b];
  // Visibility graph around inflated rectangles supports multiple intervening frames.
  const boxes=[...obstacles,source,target].map(box=>expand(box,20));
  const vertices=[a,b,...boxes.flatMap(box=>[{x:box.x,y:box.y},{x:right(box),y:box.y},{x:right(box),y:bottom(box)},{x:box.x,y:bottom(box)}])];
  const distance=vertices.map(()=>Infinity),previous=vertices.map(()=>-1),visited=new Set<number>();distance[0]=0;
  for(let count=0;count<vertices.length;count++) {
    let best=-1;for(let i=0;i<vertices.length;i++)if(!visited.has(i)&&(best<0||distance[i]<distance[best]))best=i;
    if(best<0||distance[best]===Infinity)break;if(best===1)break;visited.add(best);
    for(let i=0;i<vertices.length;i++)if(!visited.has(i)&&clear([vertices[best],vertices[i]])) {
      const candidate=distance[best]+Math.hypot(vertices[i].x-vertices[best].x,vertices[i].y-vertices[best].y);
      if(candidate<distance[i]){distance[i]=candidate;previous[i]=best;}
    }
  }
  if(previous[1]<0)return [a,b];const result:Point[]=[];let cursor=1;while(cursor>=0){result.unshift(vertices[cursor]);cursor=previous[cursor];}return result;
}
function regionContains(region:CanvasSpec['regions'] extends Array<infer R>|undefined ? R : never,member:Bounds):boolean {
  if(region.shape==='rectangle')return member.x>=region.position.x+12 && member.y>=region.position.y+64 && right(member)<=region.position.x+region.width-12 && bottom(member)<=region.position.y+region.height-12;
  const cx=region.position.x+region.width/2,cy=region.position.y+region.height/2,rx=region.width/2-12,ry=region.height/2-12;
  return [{x:member.x,y:member.y},{x:right(member),y:member.y},{x:right(member),y:bottom(member)},{x:member.x,y:bottom(member)}].every(p=>((p.x-cx)/rx)**2+((p.y-cy)/ry)**2<=1);
}
export function renderCanvas(input:CanvasSpec,previous?:CanvasLayoutState):CanvasRenderResult {
  if(previous)previous={...previous,frames:Object.assign(Object.create(null),previous.frames)};
  const spec=assertCanvas(input),diagnostics:Diagnostic[]=[],theme=spec.theme??{},font:FontName=theme.font??(theme.preset==='clean'?'sans':'body'),headingFont:FontName=font==='sans'?'sans':'heading',stroke=theme.stroke??'#28303a';
  const title=textBlock(spec.title,900,32,headingFont,32,24),subtitle=spec.subtitle?textBlock(spec.subtitle,900,22,font,32,bottom(title.bounds)+10):undefined;
  const top=bottom(subtitle?.bounds??title.bounds)+48,frames:Record<string,FrameGeometry>={},rendered:Record<string,RenderResult>={};
  for(const frame of spec.frames) {
    const effective={...theme,...(frame.kind==='graph'?frame.graph.theme:{}),...frame.theme},frameFont:FontName=effective.font??(effective.preset==='clean'?'sans':'body');
    let graph:LayoutState|undefined,panel:PanelText[]|undefined,content:Bounds;
    const header=frame.title?textBlock(frame.title,Math.max(1,(frame.width??480)-48),28,frameFont==='sans'?'sans':'heading',24,24):undefined;
    const start=header?bottom(header.bounds)+24:24;
    if(frame.kind==='graph') {
      const result=renderDiagram({...frame.graph,theme:effective},previous?.frames[frame.id]?.graph??(frame.initialLayout?{...frame.initialLayout,nodes:frame.initialLayout.nodes,edges:frame.initialLayout.edges??{},groups:frame.initialLayout.groups??{},notes:frame.initialLayout.notes??{}} as unknown as LayoutState:undefined));rendered[frame.id]=result;graph=result.layout;content=result.layout.viewport;
    }else {
      panel=[];let y=start;const width=Math.max(1,(frame.width??480)-48);
      for(const block of frame.blocks) {
        const size=block.style?.fontSize??(block.kind==='heading'?26:22),blockFont=block.style?.font??frameFont;
        const texts=block.kind==='list'?block.items!.map(item=>'• '+item):[block.text!];
        for(const text of texts){const measured=textBlock(text,width,size,blockFont,24,y,{...block.style,emphasis:block.emphasis??block.style?.emphasis});measured.quote=block.kind==='quote';panel.push(measured);y=bottom(measured.bounds)+12;}
        y+=block.kind==='heading'?4:12;
      }
      content={x:0,y:0,width:Math.max(width+48,...panel.map(p=>right(p.bounds)+24)),height:y-start};
    }
    const offset=frame.kind==='graph'?{x:24-content.x,y:start-content.y}:{x:0,y:0};
    const naturalWidth=frame.kind==='graph'?content.width+48:content.width;
    const contentBottom=frame.kind==='graph'?start+content.height:Math.max(...panel!.map(p=>bottom(p.bounds)))+12;
    const caption=frame.caption?textBlock(frame.caption,Math.max(1,(frame.width??naturalWidth)-48),20,frameFont,24,contentBottom+20):undefined;
    const naturalHeight=(caption?bottom(caption.bounds):contentBottom)+24;
    const geometry:FrameGeometry={id:frame.id,title:frame.title??(frame.kind==='graph'?frame.graph.title:frame.id),x:frame.position?.x??(!spec.layout?.relayout?previous?.frames[frame.id]?.x:undefined)??0,y:frame.position?.y??(!spec.layout?.relayout?previous?.frames[frame.id]?.y:undefined)??0,width:frame.width??Math.max(naturalWidth,header?right(header.bounds)+24:0),height:frame.height??naturalHeight,contentOffset:offset,contentBounds:content,graph,panel,titleText:header,captionText:caption};
    if(geometry.width<naturalWidth || geometry.height<naturalHeight || header && right(header.bounds)+24>geometry.width)diagnostics.push(issue('frame_too_small',[frame.id],geometry,'Explicit frame dimensions cannot contain the measured content.'));
    frames[frame.id]=geometry;
  }
  // Pack only new frames. Existing placements survive ordinary content and theme revisions.
  const strategy=spec.layout?.strategy??'grid',columns=strategy==='column'?1:strategy==='row'?spec.frames.length:Math.min(3,spec.frames.length),gap=spec.layout?.gap??96;
  const columnWidths=Array.from({length:columns},(_,i)=>Math.max(...spec.frames.filter((_,index)=>index%columns===i).map(f=>frames[f.id].width)));
  const rowHeights=Array.from({length:Math.ceil(spec.frames.length/columns)},(_,i)=>Math.max(...spec.frames.slice(i*columns,(i+1)*columns).map(f=>frames[f.id].height)));
  spec.frames.forEach((frame,i)=>{
    const geometry=frames[frame.id];if(frame.position || previous?.frames[frame.id]&&!spec.layout?.relayout)return;
    if(strategy==='manual' || spec.regions?.some(r=>r.members.includes(frame.id))) {diagnostics.push(issue('missing_frame_position',[frame.id],geometry,'Manual and region compositions require explicit frame positions.'));return;}
    const column=i%columns,row=Math.floor(i/columns);geometry.x=32+columnWidths.slice(0,column).reduce((a,b)=>a+b+gap,0);geometry.y=top+rowHeights.slice(0,row).reduce((a,b)=>a+b+gap,0);
    if(previous)for(let attempt=0;attempt<spec.frames.length && Object.values(frames).some(other=>other!==geometry&&overlaps(geometry,other,24));attempt++)geometry.y+=geometry.height+gap;
  });
  const frameList=Object.values(frames);
  for(let i=0;i<frameList.length;i++)for(let j=i+1;j<frameList.length;j++)if(overlaps(frameList[i],frameList[j],8))diagnostics.push(issue('frame_overlap',[frameList[i].id,frameList[j].id],union([frameList[i],frameList[j]]),'Diagram frames overlap.'));
  const regions:Record<string,Bounds>={},regionLabels:PanelText[]=[];
  for(const region of spec.regions??[]) {regions[region.id]={...region.position,width:region.width,height:region.height};const label=textBlock(region.title,region.width-48,26,region.style?.font??headingFont,region.position.x+24,region.position.y+16,region.style);regionLabels.push(label);}
  for(const [index,region] of (spec.regions??[]).entries())for(const memberId of region.members){const member=frames[memberId]??regions[memberId];if(!regionContains(region,member))diagnostics.push(issue('outside_region',[region.id,memberId],union([regions[region.id],member]),'Region does not contain its member.'));if(overlaps(regionLabels[index].bounds,member,8))diagnostics.push(issue('region_label_collision',[region.id,memberId],union([regionLabels[index].bounds,member]),'Member obscures a region label.'));}
  const annotations:Record<string,Bounds>={},annotationText:PanelText[]=[];
  for(const annotation of spec.annotations??[]){const block=textBlock(annotation.text,360,annotation.style?.fontSize??22,annotation.style?.font??font,annotation.position.x,annotation.position.y,annotation.style);annotations[annotation.id]=block.bounds;annotationText.push(block);}
  const standalone=[title,...subtitle?[subtitle]:[],...regionLabels,...annotationText];
  for(const block of standalone){checkText(block,spec.id,diagnostics);for(const frame of frameList)if(overlaps(frame,block.bounds,4))diagnostics.push(issue('canvas_text_collision',[frame.id],union([frame,block.bounds]),'A canvas title, region label, or annotation overlaps a frame.'));}
  for(let i=0;i<standalone.length;i++)for(let j=i+1;j<standalone.length;j++)if(overlaps(standalone[i].bounds,standalone[j].bounds,4))diagnostics.push(issue('canvas_text_collision',[spec.id],union([standalone[i].bounds,standalone[j].bounds]),'Canvas annotations overlap.'));
  for(const frame of frameList){
    for(const block of [...frame.panel??[],...frame.titleText?[frame.titleText]:[],...frame.captionText?[frame.captionText]:[]])checkText(block,frame.id,diagnostics);
    for(const finding of rendered[frame.id]?.diagnostics??[])diagnostics.push({...finding,ids:finding.ids.map(id=>frame.id+'/'+id),bounds:moveBounds(finding.bounds,{x:frame.x+frame.contentOffset.x,y:frame.y+frame.contentOffset.y})});
  }
  const links:Record<string,CanvasLinkGeometry>={};
  for(const link of spec.links??[]) {
    const source=frames[link.source.frameId],target=frames[link.target.frameId],obstacles=[...frameList.filter(f=>f!==source&&f!==target),...standalone.map(b=>b.bounds)];
    // Leave the source frame at its boundary, with element references highlighted and recorded separately.
    const points=routeLink(source,target,obstacles),text=textBlock(link.label,260,link.style?.fontSize??20,link.style?.font??font);
    const segments=points.slice(1).map((p,i)=>({a:points[i],b:p,length:Math.hypot(p.x-points[i].x,p.y-points[i].y)})).sort((a,b)=>b.length-a.length);
    let labelBounds:Bounds|undefined;
    const candidates:Bounds[]=[];
    for(const segment of segments)for(const side of [-1,1]) {const mid={x:(segment.a.x+segment.b.x)/2,y:(segment.a.y+segment.b.y)/2};candidates.push({x:mid.x-text.bounds.width/2,y:mid.y+side*(text.bounds.height+16),width:text.bounds.width,height:text.bounds.height});}
    const middle=(center(source).x+center(target).x)/2;
    candidates.push({...text.bounds,x:middle-text.bounds.width/2,y:Math.min(source.y,target.y)-text.bounds.height-12},{...text.bounds,x:middle-text.bounds.width/2,y:Math.max(bottom(source),bottom(target))+12});
    labelBounds=candidates.find(box=>![...frameList,...standalone.map(b=>b.bounds),...Object.values(links).map(l=>l.labelBounds)].some(b=>overlaps(box,b,8)))??candidates[0];
    const labelCenter=center(labelBounds);const anchors=segments.map(s=>({x:(s.a.x+s.b.x)/2,y:(s.a.y+s.b.y)/2})).sort((a,b)=>Math.hypot(a.x-labelCenter.x,a.y-labelCenter.y)-Math.hypot(b.x-labelCenter.x,b.y-labelCenter.y));
    const anchor=anchors[0],leaderPoints=routeLink(labelBounds,{...anchor,width:0,height:0},[...frameList,...standalone.map(b=>b.bounds),...Object.values(links).map(l=>l.labelBounds)]);
    const bounds=union([pathBounds(points,8),pathBounds(leaderPoints,2),labelBounds]);links[link.id]={id:link.id,points,labelBounds,labelLines:text.lines,bounds,leaderPoints};
    checkText({...text,bounds:labelBounds},link.id,diagnostics);
    if(obstacles.some(b=>pathHitsBox(polyline(points),b))||[...frameList,...standalone.map(b=>b.bounds)].some(b=>pathHitsBox(polyline(leaderPoints),b)))diagnostics.push(issue('link_through_content',[link.id],bounds,'Explanatory link passes through unrelated content.'));
    if([...frameList,...standalone.map(b=>b.bounds)].some(b=>overlaps(labelBounds!,b,4)))diagnostics.push(issue('link_label_collision',[link.id],labelBounds,'Explanatory label overlaps content.'));
  }
  const bounds=expand(union([...frameList,...Object.values(regions),...standalone.map(b=>b.bounds),...Object.values(links).map(l=>l.bounds)]),28);
  const layout:CanvasLayoutState={specHash:hashSpec(spec),engineVersion:'2.0.0',fontVersion:'bundled-sketch-noto-1',viewport:bounds,bounds,frames,regions,links,annotations,titleBounds:title.bounds,subtitleBounds:subtitle?.bounds};
  const frameSvgs:Record<string,string>={};
  const frameBody=(frame:FrameSpec)=>{
    const geometry=frames[frame.id],frameStroke=frame.theme?.stroke??(frame.kind==='graph'?frame.graph.theme?.stroke:undefined)??stroke;
    let body=`<rect ${attrs({x:0,y:0,width:geometry.width,height:geometry.height})} rx="12" fill="${escape(frame.theme?.background??(frame.kind==='graph'?frame.graph.theme?.background:undefined)??theme.background??'#ffffff')}" stroke="${escape(frameStroke)}" stroke-width="1.5"/>`;
    if(frame.kind==='graph')body+=`<g transform="translate(${geometry.contentOffset.x} ${geometry.contentOffset.y})">${innerSvg(rendered[frame.id].svg,'frame-'+frame.id)}</g>`;
    else for(const block of geometry.panel!)body+=textSvg(block,frameStroke);
    if(geometry.titleText)body+=textSvg(geometry.titleText,frameStroke);if(geometry.captionText)body+=textSvg(geometry.captionText,frameStroke);return body;
  };
  const openSvg=(b:Bounds,id:string,title=spec.title)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}" role="img" data-canvas-id="${spec.id}" data-spec-hash="${layout.specHash}" aria-labelledby="${id}-title"><title id="${id}-title">${escape(title)}</title><defs><style>${fontCss(true)}</style></defs>`;
  let svg=openSvg(bounds,'canvas')+`<rect id="diagram-background" data-background="true" ${attrs(bounds)} fill="${escape(theme.background??'#ffffff')}"/>`;
  // Ancestors draw first. Containment is visual, not a graph hierarchy.
  const sortedRegions=[...(spec.regions??[])].sort((a,b)=>b.width*b.height-a.width*a.height);
  for(const region of sortedRegions){const box=regions[region.id];svg+=`<g data-region-id="${region.id}">${region.shape==='ellipse'?`<ellipse cx="${box.x+box.width/2}" cy="${box.y+box.height/2}" rx="${box.width/2}" ry="${box.height/2}"`:`<rect ${attrs(box)}`} fill="${escape(region.style?.fill??'none')}" stroke="${escape(region.style?.stroke??stroke)}" stroke-width="${region.style?.strokeWidth??1.5}"/>${textSvg(regionLabels[(spec.regions??[]).indexOf(region)],stroke)}</g>`;}
  for(const frame of spec.frames){const geometry=frames[frame.id],body=frameBody(frame);svg+=`<g id="frame-${frame.id}" data-frame-id="${frame.id}" transform="translate(${geometry.x} ${geometry.y})">${body}</g>`;frameSvgs[frame.id]=openSvg({x:0,y:0,width:geometry.width,height:geometry.height},'export-'+frame.id,geometry.title)+body+'</svg>';}
  for(const link of spec.links??[]){const geometry=links[link.id],points=geometry.points,end=points.at(-1)!,before=points.at(-2)!,angle=Math.atan2(end.y-before.y,end.x-before.x),size=10;const arrow=[end,{x:end.x-size*Math.cos(angle-.5),y:end.y-size*Math.sin(angle-.5)},{x:end.x-size*Math.cos(angle+.5),y:end.y-size*Math.sin(angle+.5)}];svg+=`<g data-canvas-link="${link.id}" data-source-frame="${link.source.frameId}" data-target-frame="${link.target.frameId}"><path d="${points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')}" fill="none" stroke="${escape(link.style?.stroke??stroke)}" stroke-width="${link.style?.strokeWidth??1.5}" stroke-dasharray="6 4"/><path d="${geometry.leaderPoints.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' ')}" fill="none" stroke="${escape(link.style?.stroke??stroke)}" stroke-width="0.75" stroke-dasharray="2 5"/><polygon points="${arrow.map(p=>p.x+','+p.y).join(' ')}" fill="${escape(stroke)}"/>${renderText(geometry.labelLines,geometry.labelBounds,link.style?.fontSize??20,link.style?.font??font,link.style?.stroke??stroke)}</g>`;}
  for(const link of spec.links??[]) for(const id of link.source.elementIds??[]){const selected=expand(frameElementBounds(frames[link.source.frameId],[id]),5);svg+=`<rect data-link-selection="${link.id}" ${attrs(selected)} rx="6" fill="none" stroke="${escape(link.style?.stroke??stroke)}" stroke-width="1" stroke-dasharray="3 5" pointer-events="none"/>`;}
  svg+=textSvg(title,stroke);if(subtitle)svg+=textSvg(subtitle,stroke);
  for(let i=0;i<annotationText.length;i++){const block=annotationText[i];if(block.style?.presentation==='sticky')svg+=`<rect ${attrs(expand(block.bounds,14))} fill="${escape(block.style.fill??'#fff6cc')}" stroke="${escape(stroke)}"/>`;svg+=textSvg(block,stroke);}
  svg+='</svg>';
  const debugSvg=svg.replace('</svg>',diagnostics.map(f=>`<rect ${attrs(f.bounds)} fill="none" stroke="${f.severity==='error'?'#cc2222':'#c08000'}" stroke-width="2"/>`).join('')+'</svg>');
  return {svg,debugSvg,layout,diagnostics,frameSvgs};
}
