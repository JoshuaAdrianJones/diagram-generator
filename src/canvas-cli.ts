import { Command } from 'commander';
import { readFile, mkdir, writeFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CanvasStore, GraphStore } from './document-store.js';
import { assertCanvas, assertCanvasPatch, importGraph, validateDocument, CanvasSchema, CanvasPatchSchema, GraphSchema, GraphPatchSchema } from './documents.js';
import { DiagramError } from './schema.js';
import { renderCanvas } from './canvas-renderer.js';
import { captureRevision, renderPng, renderPngSet, type ScreenshotManifest } from './capture.js';
import { ensureServer, stopServer, loadRecord } from './server.js';
import { readJson, atomicJson } from './paths.js';

const summary=(r:any)=>({canvasId:r.diagramId,revisionId:r.revisionId,specHash:r.specHash,status:r.status,baseRevision:r.baseRevision,path:r.path,unchanged:r.unchanged,artifacts:{spec:path.join(r.path,'spec.json'),layout:path.join(r.path,'layout.json'),svg:path.join(r.path,'diagram.svg'),png:path.join(r.path,'diagram.png'),diagnostics:path.join(r.path,'diagnostics.json'),screenshots:path.join(r.path,'screenshots.json')}});
const action=(fn:(opts:any)=>Promise<unknown>)=>async(opts:any)=>{try{process.stdout.write(JSON.stringify(await fn(opts),null,2)+'\n');}catch(error){const e=error as DiagramError;process.stdout.write(JSON.stringify({status:'error',code:e.code||'operation_failed',message:e.message,findings:e.findings||[]},null,2)+'\n');process.exitCode=e.exitCode||4;}};
async function input(filename:string){try{return JSON.parse(await readFile(path.resolve(filename),'utf8'));}catch(error){throw new DiagramError('Cannot read JSON: '+(error as Error).message,'invalid_json');}}
const pixelScale=(width:number,height:number)=>Math.min(1,15999/width,15999/height,Math.sqrt(31_990_000/(width*height)));
function replaceBackground(svg:string,background?:string){
  if(!background)return svg;
  return svg.replace(/(<rect\b[^>]*\bid="[^"]*diagram-background"[^>]*\bfill=")[^"]*(")/g,'$1'+background+'$2')
    .replace(/<rect\b[^>]*class="label-background"[^>]*>/g,tag=>background==='transparent'?'':tag.replace(/\bfill="[^"]*"/,'fill="'+background+'"'));
}
export function registerCanvasCommands(program:Command,root:()=>string) {
  const canvas=program.command('canvas').description('Create and revise a shared local canvas');
  const store=()=>new CanvasStore(root()), requireCanvas=(c:Command)=>c.requiredOption('--canvas <id>','Saved canvas ID');
  const candidate=(opts:any)=>opts.revision?store().readAny(opts.canvas,opts.revision):store().current(opts.canvas);
  canvas.command('create').requiredOption('--spec <path>').action(action(async opts=>summary(await store().create(assertCanvas(await input(opts.spec))))));
  canvas.command('validate').option('--spec <path>').option('--canvas <id>').option('--revision <id>').action(action(async opts=>{
    if(!opts.spec&&!opts.canvas)throw new DiagramError('Supply --spec or --canvas.','missing_argument');const result=validateDocument(opts.spec?await input(opts.spec):(await candidate(opts)).spec);if(!result.valid)process.exitCode=2;return result;
  }));
  requireCanvas(canvas.command('status')).action(action(async opts=>({current:summary(await store().current(opts.canvas)),latest:await store().latest(opts.canvas).then(r=>r?summary(r):null)})));
  requireCanvas(canvas.command('revise')).requiredOption('--patch <path>').requiredOption('--base <revision>').action(action(async opts=>summary(await store().revise(opts.canvas,assertCanvasPatch(await input(opts.patch)),opts.base))));
  requireCanvas(canvas.command('add-diagram')).requiredOption('--diagram <id>').requiredOption('--revision <id>').requiredOption('--frame <id>').requiredOption('--base <revision>').option('--position <x,y>').action(action(async opts=>{
    const record=await new GraphStore(root()).readRevision(opts.diagram,opts.revision);let position;
    if(opts.position){const values=opts.position.split(',').map(Number);if(values.length!==2||!values.every(Number.isFinite))throw new DiagramError('Position must be x,y.','validation_failure');position={x:values[0],y:values[1]};}
    const initialLayout=record.layout?Object.fromEntries(['nodes','edges','groups','notes'].map(kind=>[kind,Object.fromEntries(Object.entries((record.layout as any)[kind]).map(([id,geometry]:[string,any])=>[id,{seed:geometry.seed,...(kind==='nodes'||kind==='notes'?{x:geometry.x,y:geometry.y}:{})}]))])):undefined;
    return summary(await store().revise(opts.canvas,{schemaVersion:2,operations:[{op:'addFrame',frame:{id:opts.frame,kind:'graph',graph:importGraph(record.spec),...(initialLayout?{initialLayout}:{}),...(position?{position}:{}),source:{diagramId:opts.diagram,revisionId:opts.revision,specHash:record.specHash}}}]},opts.base));
  }));
  requireCanvas(canvas.command('render')).option('--revision <id>').action(action(async opts=>{
    const record=await candidate(opts);if(record.status==='published')return {...summary(record),unchanged:true};
    try{
      let previous;try{previous=await readJson(path.join(record.path,'previous-layout.json'));}catch{}
      const rendered=renderCanvas(record.spec,previous),files:Record<string,unknown>={'diagram.svg':rendered.svg,'debug.svg':rendered.debugSvg,'layout.json':rendered.layout,'diagnostics.json':rendered.diagnostics};
      for(const [id,svg] of Object.entries(rendered.frameSvgs))files['frames/'+id+'.svg']=svg;
      await store().writeCandidateArtifacts(opts.canvas,record.revisionId,files);
      const bounds=rendered.layout.bounds,scale=pixelScale(bounds.width,bounds.height);
      const images=[{bounds,filename:path.join(record.path,'diagram.png'),scale,svg:rendered.svg},...Object.values(rendered.layout.frames).map(frame=>({bounds:{x:0,y:0,width:frame.width,height:frame.height},filename:path.join(record.path,'frames',frame.id+'.png'),scale:pixelScale(frame.width,frame.height),svg:rendered.frameSvgs[frame.id]}))];
      await renderPngSet(root(),record,images);
      const blockers=rendered.diagnostics.filter(f=>f.severity==='error');if(blockers.length){process.exitCode=3;await store().markFailed(opts.canvas,record.revisionId,blockers);}else await store().markRendered(opts.canvas,record.revisionId);
      return {...summary(record),status:blockers.length?'layout_blocked':'rendered',findings:rendered.diagnostics,previewPngScale:scale,frames:Object.keys(rendered.layout.frames)};
    }catch(error){const e=error as DiagramError;await store().markFailed(opts.canvas,record.revisionId,e.findings?.length?e.findings:[{severity:'error',code:e.code||'render_failure',ids:[],message:e.message,repairClasses:['render']}]);throw error;}
  }));
  requireCanvas(canvas.command('inspect')).requiredOption('--revision <id>').option('--debug').option('--preview-page').action(action(async opts=>{
    const record=await candidate(opts),layout=await readJson(path.join(record.path,'layout.json')),findings=await readJson(path.join(record.path,'diagnostics.json'));
    const screenshots:ScreenshotManifest=record.status==='published'?await readJson(path.join(record.path,'screenshots.json')):await captureRevision(root(),record,layout,findings,{debug:opts.debug,preview:opts.previewPage});
    if(findings.some((f:any)=>f.severity==='error'))process.exitCode=3;
    return {...summary(record),status:findings.some((f:any)=>f.severity==='error')?'layout_blocked':'awaiting_visual_review',findings,screenshots:{...screenshots,images:screenshots.images.map(image=>({...image,absolutePath:path.join(record.path,image.path)}))}};
  }));
  requireCanvas(canvas.command('capture')).requiredOption('--revision <id>').option('--frame <id>').option('--region <region>','overview or x,y,width,height','overview').option('--scale <scale>','Pixel scale','1').option('--debug').option('--preview-page').action(action(async opts=>{
    const record=await candidate(opts),layout=await readJson(path.join(record.path,'layout.json'));let region;
    if(opts.frame){const frame=layout.frames[opts.frame];if(!frame)throw new DiagramError('Unknown frame.','unknown_element');region={x:frame.x,y:frame.y,width:frame.width,height:frame.height};}
    else if(opts.region!=='overview'){const values=opts.region.split(',').map(Number);if(values.length!==4||!values.every(Number.isFinite))throw new DiagramError('Region must be x,y,width,height.','validation_failure');region={x:values[0],y:values[1],width:values[2],height:values[3]};}
    const scale=Number(opts.scale);if(!Number.isFinite(scale)||scale<.25||scale>2)throw new DiagramError('Scale must be between 0.25 and 2.','invalid_scale');
    const outputDir=record.status==='published'?path.join(root(),'captures','canvases',record.diagramId,record.revisionId,String(Date.now())):record.path;
    const manifest=await captureRevision(root(),record,layout,await readJson(path.join(record.path,'diagnostics.json')),{region,scale,debug:opts.debug,preview:opts.previewPage,outputDir,frameId:opts.frame});
    return {...summary(record),screenshotManifest:path.join(outputDir,'screenshots.json'),screenshots:{...manifest,images:manifest.images.map(image=>({...image,absolutePath:path.join(outputDir,image.path)}))}};
  }));
  requireCanvas(canvas.command('publish')).requiredOption('--revision <id>').requiredOption('--review <path>').action(action(async opts=>summary(await store().publish(opts.canvas,opts.revision,await input(opts.review)))));
  canvas.command('preview').option('--canvas <id>').option('--open').option('--stop').action(action(async opts=>{
    if(opts.stop)return stopServer(root());const info=await ensureServer(root()),url=info.url+(opts.canvas?'/c/'+encodeURIComponent(opts.canvas):'/');
    if(opts.open){const child=spawn(process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open',[url],{stdio:'ignore',detached:true});child.on('error',()=>{});child.unref();}return {status:'running',url,serverPid:info.pid,dataRoot:root()};
  }));
  requireCanvas(canvas.command('export')).option('--revision <id>').option('--frame <id>').option('--format <formats>','svg,png','svg,png').option('--scale <scale>','PNG scale','1').option('--background <color>').option('--out <directory>').option('--draft').action(action(async opts=>{
    const record=opts.revision?await candidate(opts):await store().latest(opts.canvas);if(!record || record.status!=='published'&&!opts.draft)throw new DiagramError('Export requires a published canvas or an explicit draft revision.','unverified_export',3);
    const formats=opts.format.split(','),scale=Number(opts.scale);if(formats.some((f:string)=>!['svg','png'].includes(f)))throw new DiagramError('Format must be svg, png, or svg,png.','invalid_format');if(![1,2].includes(scale))throw new DiagramError('Scale must be 1 or 2.','invalid_scale');
    if(opts.background&&!/^(transparent|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/.test(opts.background))throw new DiagramError('Invalid background.','invalid_background');
    const layout=await readJson(path.join(record.path,'layout.json')),frame=opts.frame?layout.frames[opts.frame]:undefined;if(opts.frame&&!frame)throw new DiagramError('Unknown frame.','unknown_element');
    let svg=await readFile(path.join(record.path,opts.frame?'frames/'+opts.frame+'.svg':'diagram.svg'),'utf8');svg=replaceBackground(svg,opts.background);
    // Background overrides include frame backdrops, retaining node fills and highlights.
    if(opts.background)svg=svg.replace(/(<rect\b[^>]*\brx="12"[^>]*\bfill=")[^"]*(")/g,'$1'+opts.background+'$2');
    const out=path.resolve(opts.out||path.join(root(),'exports','canvases',opts.canvas,record.revisionId));await mkdir(out,{recursive:true});const stem=opts.canvas+(opts.frame?'-'+opts.frame:'')+(record.status==='published'?'':'-unverified'),artifacts:Record<string,string>={};
    if(formats.includes('svg')){artifacts.svg=path.join(out,stem+'.svg');await writeFile(artifacts.svg,svg);}
    if(formats.includes('png')){artifacts.png=path.join(out,stem+'.png');const bounds=frame?{x:0,y:0,width:frame.width,height:frame.height}:layout.bounds;await renderPng(root(),record,bounds,artifacts.png,scale,opts.background,svg);}
    return {canvasId:opts.canvas,revisionId:record.revisionId,specHash:record.specHash,status:record.status==='published'?'verified':'unverified',frameId:opts.frame,artifacts,scale};
  }));
  requireCanvas(canvas.command('history')).action(action(async opts=>({canvasId:opts.canvas,revisions:await store().history(opts.canvas)})));
  requireCanvas(canvas.command('restore')).requiredOption('--revision <id>').option('--base <revision>').action(action(async opts=>summary(await store().restore(opts.canvas,opts.revision,opts.base))));
  requireCanvas(canvas.command('cleanup')).option('--age-days <days>','Failed attempt age','7').action(action(async opts=>{
    const current=await store().current(opts.canvas),attempts=path.dirname(store().candidatePath(opts.canvas,current.revisionId)),cutoff=Date.now()-Number(opts.ageDays)*86400000,removed:string[]=[];if(!Number.isFinite(cutoff)||Number(opts.ageDays)<0)throw new DiagramError('Age days must be nonnegative.','invalid_age');
    for(const entry of await readdir(attempts,{withFileTypes:true})){if(!entry.isDirectory()||entry.name===current.revisionId)continue;const directory=path.join(attempts,entry.name);try{if((await stat(path.join(directory,'failure.json'))).mtimeMs<cutoff){await rm(directory,{recursive:true});removed.push(entry.name);}}catch{}}
    return {status:'ok',removed,preservedHistory:true};
  }));
}
export const documentSchemas:Record<string,unknown>={'graph.schema.json':GraphSchema,'graph-patch.schema.json':GraphPatchSchema,'canvas.schema.json':CanvasSchema,'canvas-patch.schema.json':CanvasPatchSchema};
