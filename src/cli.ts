import { Command } from 'commander';
import { readFile, writeFile, mkdir, access, copyFile, readdir, rm, stat } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { GraphStore } from './document-store.js';
import { assertSavedGraph, assertGraphPatch, validateDocument } from './documents.js';
import { registerCanvasCommands, documentSchemas } from './canvas-cli.js';
import { assertSpec, assertPatch, validateSpec, DiagramError, DiagramSpecSchema, PatchSchema } from './schema.js';
import { renderDiagram } from './renderer.js';
import { appRoot, dataRoot, readJson, atomicJson, browserPath } from './paths.js';
import { ensureServer, stopServer, loadRecord } from './server.js';
import { captureRevision, renderPng, launchBrowser, type ScreenshotManifest } from './capture.js';

const program=new Command().name('sketch-diagram').description('Local sketch diagrams with reviewed revisions').version('1.0.0').option('--json','Print structured JSON').option('--data <path>','Diagram data directory');
program.exitOverride();
program.configureOutput({writeErr:text=>process.stderr.write(text)});
const store=()=>new GraphStore(program.opts().data || dataRoot());
const root=()=>path.resolve(program.opts().data || dataRoot());
const summary=(r:any)=>({diagramId:r.diagramId,revisionId:r.revisionId,specHash:r.specHash,status:r.status,baseRevision:r.baseRevision,path:r.path,unchanged:r.unchanged,artifacts:{spec:path.join(r.path,'spec.json'),layout:path.join(r.path,'layout.json'),svg:path.join(r.path,'diagram.svg'),png:path.join(r.path,'diagram.png'),diagnostics:path.join(r.path,'diagnostics.json'),screenshots:path.join(r.path,'screenshots.json')}});
function output(value:unknown){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
async function input(filename:string){try{return JSON.parse(await readFile(path.resolve(filename),'utf8'))}catch(error){throw new DiagramError('Cannot read JSON '+path.resolve(filename)+': '+(error as Error).message,'invalid_json',2)}}
const action=(fn:(opts:any)=>Promise<unknown>)=>async(opts:any)=>{try{output(await fn(opts))}catch(error){const e=error as DiagramError;output({status:'error',code:e.code||'operation_failed',message:e.message,findings:e.findings||[]});process.exitCode=e.exitCode||4;}};
function requireDiagram(command:Command){return command.requiredOption('--diagram <id>','Saved diagram ID');}
async function candidate(opts:any){return opts.revision?loadRecord(store(),opts.diagram,opts.revision):store().current(opts.diagram)}
const boundsOf=(layout:any)=>layout.bounds||layout.viewport||layout.viewportBounds||layout.documentBounds;

program.command('doctor').description('Check runtime, fonts, browser, data, and installed integration').action(action(async()=>{
  const checks:any[]=[];
  const [major,minor]=process.versions.node.split('.').map(Number);
  checks.push({name:'runtime',ok:(major>22||(major===22&&minor>=19))&&major<27,value:process.version});
  for(const name of ['Bangers-Regular.ttf','Caveat-Regular.ttf','NotoSans-Variable.ttf','Bangers-OFL.txt','Caveat-OFL.txt','NotoSans-OFL.txt'])checks.push({name:'font:'+name,ok:existsSync(path.join(appRoot,'assets/fonts',name))});
  try{await mkdir(root(),{recursive:true});await access(root(),constants.W_OK);checks.push({name:'data',ok:true,path:root()})}catch(error){checks.push({name:'data',ok:false,message:(error as Error).message})}
  try{const browser=await launchBrowser();await browser.close();checks.push({name:'browser',ok:true,path:browserPath()})}catch(error){checks.push({name:'browser',ok:false,message:(error as Error).message})}
  if(existsSync(path.join(appRoot,'.bundle-ready.json')))checks.push({name:'integration',ok:true,mode:'portable_bundle'});
  else try{const installed=await readJson(path.join(appRoot,'.installation.json'));checks.push({name:'integration',ok:existsSync(installed.binPath)&&existsSync(path.join(installed.skillPath,'SKILL.md')),skillPath:installed.skillPath,binPath:installed.binPath,discovery:installed.discovery});}catch{checks.push({name:'integration',ok:false,message:'Run npm run install:local to install the reusable CLI and skill.'})}
  if(checks.some(c=>!c.ok))process.exitCode=4;
  return {status:checks.every(c=>c.ok)?'ok':'dependency_failure',applicationRoot:appRoot,dataRoot:root(),checks};
}));
program.command('create').requiredOption('--spec <path>').action(action(async(opts)=>summary(await store().create(assertSavedGraph(await input(opts.spec))))));
program.command('validate').option('--diagram <id>').option('--spec <path>').option('--revision <id>').action(action(async(opts)=>{
  if(!opts.spec&&!opts.diagram)throw new DiagramError('Supply --spec or --diagram.','missing_argument');
  const record=opts.diagram?await candidate(opts):undefined;const result=validateDocument(opts.spec?await input(opts.spec):record.spec);
  if(!result.valid)process.exitCode=2;return {status:result.valid?'valid':'invalid',diagramId:record?.diagramId,revisionId:record?.revisionId,specHash:record?.specHash,findings:result.findings};
}));
requireDiagram(program.command('status')).action(action(async(opts)=>{let latest;try{latest=await store().latest(opts.diagram)}catch{}return {current:summary(await store().current(opts.diagram)),latest:latest?summary(latest):null}}));
requireDiagram(program.command('revise')).requiredOption('--patch <path>').requiredOption('--base <revision>').action(action(async(opts)=>summary(await store().revise(opts.diagram,await input(opts.patch).then(patch=>patch.schemaVersion===2?assertGraphPatch(patch):assertPatch(patch)),opts.base))));
requireDiagram(program.command('render')).option('--revision <id>').action(action(async(opts)=>{
  const record=await candidate(opts);if(record.status==='published'||record.status==='verified'){return {...summary(record),unchanged:true};}
  const started=performance.now();let previous;
  try{previous=await readJson(path.join(record.path,'previous-layout.json'))}catch{}
  if(!previous&&record.baseRevision)try{previous=await readJson(path.join((await loadRecord(store(),opts.diagram,record.baseRevision)).path,'layout.json'))}catch{}
  try{
    const rendered=renderDiagram(record.spec,previous);
    await store().writeCandidateArtifacts(opts.diagram,record.revisionId,{'diagram.svg':rendered.svg,'debug.svg':rendered.debugSvg,'layout.json':rendered.layout,'diagnostics.json':rendered.diagnostics});
    await renderPng(root(),record,boundsOf(rendered.layout),path.join(record.path,'diagram.png'));
    const blockers=rendered.diagnostics.filter((f:any)=>f.severity==='error');
    if(blockers.length){process.exitCode=3;await store().markFailed(opts.diagram,record.revisionId,blockers)}else await store().markRendered(opts.diagram,record.revisionId);
    return {...summary(record),status:blockers.length?'layout_blocked':'rendered',findings:rendered.diagnostics,elapsedMs:Math.round(performance.now()-started)};
  }catch(error){const e=error as DiagramError;await store().markFailed(opts.diagram,record.revisionId,e.findings?.length?e.findings:[{severity:'error',code:e.code||'render_failure',ids:[],message:e.message,repairClasses:['render']}]);throw error;}
}));
requireDiagram(program.command('inspect')).requiredOption('--revision <id>').option('--debug').option('--preview-page').action(action(async(opts)=>{
  const record=await candidate(opts),layout=await readJson(path.join(record.path,'layout.json')),findings=await readJson(path.join(record.path,'diagnostics.json'));
  const started=performance.now();const screenshots:ScreenshotManifest=record.status==='published'?await readJson(path.join(record.path,'screenshots.json')):await captureRevision(root(),record,layout,findings,{debug:opts.debug,preview:opts.previewPage});
  if(findings.some((f:any)=>f.severity==='error'))process.exitCode=3;
  return {...summary(record),status:findings.some((f:any)=>f.severity==='error')?'layout_blocked':'awaiting_visual_review',findings,screenshots:{...screenshots,images:screenshots.images.map(image=>({...image,absolutePath:path.join(record.path,image.path)}))},elapsedMs:Math.round(performance.now()-started)};
}));
requireDiagram(program.command('capture')).requiredOption('--revision <id>').option('--region <region>','overview, element ID, or x,y,width,height','overview').option('--scale <scale>','Pixel scale','1').option('--debug').option('--preview-page').action(action(async(opts)=>{
  const record=await candidate(opts),layout=await readJson(path.join(record.path,'layout.json'));let region;
  if(opts.region!=='overview'){
    const numbers=opts.region.split(',').map(Number);
    if(numbers.length===4&&numbers.every(Number.isFinite))region={x:numbers[0],y:numbers[1],width:numbers[2],height:numbers[3]};
    else{const element=[...Object.values(layout.nodes||{}),...Object.values(layout.groups||{}),...Object.values(layout.edges||{}),...Object.values(layout.notes||{})].find((e:any)=>e.id===opts.region) as any;region=element?.bounds||(element?.width?{x:element.x,y:element.y,width:element.width,height:element.height}:element?.textBounds);if(!region)throw new DiagramError('Unknown capture region '+opts.region,'unknown_element');}
  }
  const scale=Number(opts.scale);if(!Number.isFinite(scale)||scale<.25||scale>2)throw new DiagramError('Scale must be between 0.25 and 2.','invalid_scale');
  const outputDir=record.status==='published'?path.join(root(),'captures',record.diagramId,record.revisionId,String(Date.now())):record.path;
  const manifest=await captureRevision(root(),record,layout,await readJson(path.join(record.path,'diagnostics.json')),{region,scale,debug:opts.debug,preview:opts.previewPage,outputDir});
  return {...summary(record),screenshotManifest:path.join(outputDir,'screenshots.json'),screenshots:{...manifest,images:manifest.images.map(image=>({...image,absolutePath:path.join(outputDir,image.path)}))}};
}));
requireDiagram(program.command('publish')).requiredOption('--revision <id>').requiredOption('--review <path>').action(action(async(opts)=>summary(await store().publish(opts.diagram,opts.revision,await input(opts.review)))));
program.command('preview').option('--diagram <id>').option('--open').option('--stop').action(action(async(opts)=>{
  if(opts.stop)return stopServer(root());const info=await ensureServer(root());const url=info.url+(opts.diagram?'/d/'+encodeURIComponent(opts.diagram):'/');
  if(opts.open){const opener=process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open';const child=spawn(opener,[url],{stdio:'ignore',detached:true});child.on('error',()=>{});child.unref();}
  return {status:'running',url,serverPid:info.pid,dataRoot:root()};
}));
requireDiagram(program.command('export')).option('--revision <id>').option('--format <formats>','svg,png','svg,png').option('--scale <scale>','PNG scale','1').option('--background <color>').option('--out <directory>').option('--draft','Allow an explicitly marked unverified candidate').action(action(async(opts)=>{
  const record=opts.revision?await candidate(opts):await store().latest(opts.diagram);if(!record)throw new DiagramError('No successful revision. Use --draft --revision to export a candidate.','unverified_export',3);
  const publicRevision=record.status==='published'||record.status==='verified';if(!publicRevision&&!opts.draft)throw new DiagramError('Candidate is unverified. Supply --draft explicitly.','unverified_export',3);
  const scale=Number(opts.scale);if(![1,2].includes(scale))throw new DiagramError('Export scale must be 1 or 2.','invalid_scale');
  if(opts.background&&!/^(transparent|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/.test(opts.background))throw new DiagramError('Background must be transparent or a hex color.','invalid_background');
  const formats=opts.format.split(',');if(formats.some((format:string)=>!['svg','png'].includes(format)))throw new DiagramError('Format must be svg, png, or svg,png.','invalid_format');
  const out=path.resolve(opts.out||path.join(root(),'exports',opts.diagram,record.revisionId));await mkdir(out,{recursive:true});
  const stem=opts.diagram+(publicRevision?'':'-unverified'),artifacts:any={};const layout=await readJson(path.join(record.path,'layout.json'));
  if(formats.includes('svg')){
    let svg=await readFile(path.join(record.path,'diagram.svg'),'utf8');
    if(opts.background){svg=svg.replace(/<rect\b[^>]*(?:id="diagram-background"|data-background="true")[^>]*>/,tag=>tag.replace(/\bfill="[^"]*"/,`fill="${opts.background}"`));
      svg=svg.replace(/<rect\b[^>]*class="label-background"[^>]*>/g,tag=>opts.background==='transparent'?'':tag.replace(/\bfill="[^"]*"/,`fill="${opts.background}"`));
    }
    artifacts.svg=path.join(out,stem+'.svg');await writeFile(artifacts.svg,svg);
  }
  if(formats.includes('png')){artifacts.png=path.join(out,stem+'.png');if(scale===1&&!opts.background)await copyFile(path.join(record.path,'diagram.png'),artifacts.png);else await renderPng(root(),record,boundsOf(layout),artifacts.png,scale,opts.background);}
  return {diagramId:record.diagramId,revisionId:record.revisionId,specHash:record.specHash,status:publicRevision?'verified':'unverified',artifacts,scale,background:opts.background||record.spec.theme?.background||'#ffffff'};
}));
requireDiagram(program.command('history')).action(action(async(opts)=>({diagramId:opts.diagram,revisions:await store().history(opts.diagram)})));
requireDiagram(program.command('restore')).requiredOption('--revision <id>').option('--base <revision>').action(action(async(opts)=>summary(await store().restore(opts.diagram,opts.revision,opts.base))));
program.command('schema').option('--out <path>','Directory for JSON schemas',path.join(appRoot,'schemas')).action(action(async(opts)=>{await mkdir(opts.out,{recursive:true});await atomicJson(path.join(opts.out,'diagram.schema.json'),DiagramSpecSchema);await atomicJson(path.join(opts.out,'patch.schema.json'),PatchSchema);for(const [name,schema] of Object.entries(documentSchemas))await atomicJson(path.join(opts.out,name),schema);return {status:'ok',paths:['diagram.schema.json','patch.schema.json',...Object.keys(documentSchemas)].map(name=>path.resolve(opts.out,name))};}));
requireDiagram(program.command('cleanup')).option('--age-days <days>','Minimum failed attempt age','7').action(action(async(opts)=>{
  const current=await store().current(opts.diagram);const attemptRoot=path.dirname(store().candidatePath(opts.diagram,current.revisionId));const removed:string[]=[];const cutoff=Date.now()-Number(opts.ageDays)*86400000;
  if(!Number.isFinite(cutoff)||Number(opts.ageDays)<0)throw new DiagramError('Age days must be nonnegative.','invalid_age');
  for(const entry of await readdir(attemptRoot,{withFileTypes:true})){if(!entry.isDirectory()||entry.name===current.revisionId)continue;const directory=path.join(attemptRoot,entry.name);try{const failure=await stat(path.join(directory,'failure.json'));if(failure.mtimeMs<cutoff){await rm(directory,{recursive:true});removed.push(entry.name)}}catch{}}
  return {status:'ok',removed,preservedHistory:true};
}));
registerCanvasCommands(program,root);
try{await program.parseAsync()}catch(error){const e=error as any;if(e.exitCode!==0){output({status:'error',code:'invalid_arguments',message:e.message,findings:[]});process.exitCode=2;}}
