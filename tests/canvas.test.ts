import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertCanvas, assertGraph, importGraph, applyCanvasPatch, applyGraphPatch, validateDocument, GraphSchema, GraphPatchSchema, CanvasSchema, CanvasPatchSchema, type CanvasSpec } from '../src/documents.js';
import { pathHitsBox, polyline } from '../src/geometry.js';
import { renderCanvas } from '../src/canvas-renderer.js';
import { renderDiagram } from '../src/renderer.js';
import { CanvasStore, GraphStore } from '../src/document-store.js';
import { captureRevision, renderPng, withBrowser, readyPage } from '../src/capture.js';
import { hashSpec, type DiagramSpec } from '../src/schema.js';
import { readJson, appRoot } from '../src/paths.js';
import type { ReviewRecord } from '../src/storage.js';

const fixture=async(name='overview-detail'):Promise<CanvasSpec>=>assertCanvas(await readJson(path.join(appRoot,'fixtures/canvas-'+name+'.json')));
const code=(error:unknown)=>(error as any).code;
test('canvas schemas preserve local IDs, reject invalid models, and match exported contracts',async()=>{
  const spec=await fixture();assert.equal(spec.frames.length,2);
  for(const alter of [
    (s:any)=>s.frames.push(s.frames[0]),
    (s:any)=>s.links[0].source.elementIds=['missing'],
    (s:any)=>s.links[0].target.frameId='missing',
    (s:any)=>s.frames[0].graph.edges.push({id:'ca',source:'c',target:'a'}),
    (s:any)=>s.frames[1].graph.edges.push({id:'da',source:'d',target:'a'}),
    (s:any)=>s.frames[0].graph.nodes[0].row='missing',
    (s:any)=>s.frames[0].graph.nodes[0].shape='triangle',
    (s:any)=>s.frames[0].position={x:Infinity,y:0},
    (s:any)=>s.regions=[{id:'r',title:'Region',shape:'ellipse',position:{x:0,y:0},width:500,height:500,members:['r']}],
    (s:any)=>s.regions=[{id:'r',title:'Region',shape:'ellipse',position:{x:0,y:0},members:[]}],
  ]){const candidate=structuredClone(spec);alter(candidate);assert.equal(validateDocument(candidate).valid,false);}
  for(const [name,schema] of Object.entries({'graph.schema.json':GraphSchema,'graph-patch.schema.json':GraphPatchSchema,'canvas.schema.json':CanvasSchema,'canvas-patch.schema.json':CanvasPatchSchema}))assert.deepEqual(await readJson(path.join(appRoot,'schemas',name)),JSON.parse(JSON.stringify(schema)));
});
test('canvas patches preserve models, require cascade, and apply relayout only once',async()=>{
  const spec=await fixture(),renamed=applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'patchGraph',id:'detail',patch:{schemaVersion:2,operations:[{op:'updateNode',id:'b',changes:{label:'Check carefully'}}]}}]});
  assert.deepEqual(renamed.frames[0],spec.frames[0]);assert.notDeepEqual(renamed.frames[1],spec.frames[1]);
  assert.throws(()=>applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'removeFrame',id:'overview'}]}));
  assert.equal(applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'removeFrame',id:'overview',cascade:true}]}).links?.length,0);
  assert.throws(()=>applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'patchGraph',id:'overview',patch:{schemaVersion:2,operations:[{op:'removeNode',id:'b',cascade:true},{op:'addEdge',edge:{id:'ac',source:'a',target:'c'}}]}}]}));
  const cascaded=applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'patchGraph',id:'overview',cascade:true,patch:{schemaVersion:2,operations:[{op:'removeNode',id:'b',cascade:true},{op:'addEdge',edge:{id:'ac',source:'a',target:'c'}}]}}]});assert.equal(cascaded.links![0].source.elementIds,undefined);
  const groupGraph=assertGraph({schemaVersion:2,kind:'graph',id:'group-test',title:'Group test',nodes:[{id:'a',label:'Alpha',group:'g'}],groups:[{id:'g',title:'Group',members:['a']}]});assert.equal(applyGraphPatch(groupGraph,{schemaVersion:2,operations:[{op:'removeGroup',id:'g',cascade:true}]}).nodes[0].group,undefined);
  const relayout=applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'setLayout',layout:{strategy:'column',relayout:true}}]});
  assert.equal(applyCanvasPatch(relayout,{schemaVersion:2,operations:[{op:'setTitle',title:'Changed'}]}).layout?.relayout,false);
  const nested=await fixture('regions');assert.throws(()=>applyCanvasPatch(nested,{schemaVersion:2,operations:[{op:'removeRegion',id:'inner'}]}));
  const dissolved=applyCanvasPatch(nested,{schemaVersion:2,operations:[{op:'removeRegion',id:'inner',cascade:true}]});assert.equal(dissolved.frames.length,2);assert.deepEqual(dissolved.regions![0].members,['outer-view']);
});
test('model layouts and clean fonts are deterministic; unrelated graph geometry survives revisions',async()=>{
  for(const name of ['overview-detail','graph-types','panels','horizons','regions']){
    const spec=await fixture(name),result=renderCanvas(spec);
    assert.deepEqual(result.diagnostics.filter(d=>d.severity==='error'),[],name);assert(Object.values(result.layout.bounds).every(Number.isFinite),name);for(const link of Object.values(result.layout.links))assert([...link.points,...link.leaderPoints].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),name);
    assert.equal(result.svg,renderCanvas(spec).svg,name);
    for(const frame of spec.frames)assert(result.svg.includes('data-frame-id="'+frame.id+'"'));
    const ids=[...result.svg.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length,'SVG IDs must be globally unique');
  }
  const spec=await fixture(),first=renderCanvas(spec),changed=applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'patchGraph',id:'detail',patch:{schemaVersion:2,operations:[{op:'updateNode',id:'b',changes:{label:'Check twice'}}]}}]}),second=renderCanvas(changed,first.layout);
  assert.deepEqual(second.layout.frames.overview,first.layout.frames.overview);
  for(const [id,node] of Object.entries(first.layout.frames.detail.graph!.nodes)){assert.equal(second.layout.frames.detail.graph!.nodes[id].x,node.x);assert.equal(second.layout.frames.detail.graph!.nodes[id].y,node.y);assert.equal(second.layout.frames.detail.graph!.nodes[id].seed,node.seed);}
  const moved=renderCanvas(applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'updateFrame',id:'detail',changes:{position:{x:1400,y:120}}}]}),first.layout);assert.deepEqual(moved.layout.frames.detail.graph,first.layout.frames.detail.graph);assert.equal(moved.layout.frames.detail.x,1400);
  const undersized=renderCanvas(applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'updateFrame',id:'overview',changes:{width:50,height:50}}]}));assert(undersized.diagnostics.some(d=>d.code==='frame_too_small'));
  const propertyNames=applyCanvasPatch(spec,{schemaVersion:2,operations:[{op:'addFrame',frame:{id:'constructor',kind:'panel',blocks:[{kind:'paragraph',text:'A safe identifier'}]}}]});const safelyPlaced=renderCanvas(propertyNames,first.layout);assert(safelyPlaced.layout.frames['constructor' as string].y>first.layout.bounds.y+32);
  const collisions=structuredClone(spec);collisions.frames[1].id='overview-node-a';collisions.links=[];const namespaced=renderCanvas(collisions).svg;const globalIds=[...namespaced.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(globalIds).size,globalIds.length);
  const clean=renderCanvas(await fixture('graph-types'));assert.equal(clean.layout.frames.sequence.graph!.nodes.a.font,'sans');assert(clean.svg.includes('font-family="DiagramSans"'));
  const styled=structuredClone(spec);styled.theme={preset:'clean'};if(styled.frames[0].kind==='graph'){styled.frames[0].graph.theme={preset:'sketch',stroke:'#123456'};styled.frames[0].theme={preset:'clean',stroke:'#abcdef'};styled.frames[0].graph.nodes[0].style={font:'body'};}const resolved=renderCanvas(styled);assert.equal(resolved.layout.frames.overview.graph!.nodes.b.font,'sans');assert.equal(resolved.layout.frames.overview.graph!.nodes.a.font,'body');assert(resolved.frameSvgs.overview.includes('stroke="#abcdef"'));
  const routed=await fixture('panels');routed.links=[{id:'skip',source:{frameId:'intro'},target:{frameId:'finish'},label:'Compare stages'}];const routing=renderCanvas(routed);assert.deepEqual(routing.diagnostics.filter(d=>d.severity==='error'),[]);assert.equal(pathHitsBox(polyline(routing.layout.links.skip.points),routing.layout.frames.review),false);assert.equal(pathHitsBox(polyline(routing.layout.links.skip.leaderPoints),routing.layout.frames.review),false);
  const horizons=renderCanvas(await fixture('horizons'));assert.equal(Object.keys(horizons.layout.frames.horizons.graph!.lanes!).length,3);assert(horizons.svg.includes('Days'));assert(horizons.svg.includes('First sample'));
});
test('legacy import materializes fonts and keeps source data independent',async()=>{
  const legacy=await readJson<DiagramSpec>(path.join(appRoot,'fixtures/concept-map.json'));legacy.theme={preset:'clean',font:'heading'};legacy.nodes[0].style={roughness:2};
  const imported=importGraph(legacy);assert.equal(imported.theme?.font,'heading');assert.equal(imported.nodes[0].style?.roughness,0);assert.equal(imported.schemaVersion,2);
  const old=renderDiagram(legacy),next=renderDiagram(imported,old.layout);for(const id of Object.keys(old.layout.nodes)){assert.equal(next.layout.nodes[id].font,old.layout.nodes[id].font);assert.equal(next.layout.nodes[id].seed,old.layout.nodes[id].seed);}
  assert.equal(next.layout.titleBounds!.width,old.layout.titleBounds!.width);
  imported.nodes[0].label='Changed copy';assert.notEqual(imported.nodes[0].label,legacy.nodes[0].label);
  const graph=assertGraph({...importGraph(legacy),model:'network'});assert.throws(()=>applyGraphPatch(graph,{schemaVersion:2,operations:[{op:'updateNode',id:'missing',changes:{label:'Missing'}}]}));
});
test('canvas browser, complete reviews, frame exports, conflicts and recovery',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sketch-canvas-')),store=new CanvasStore(root),run=async(args:string[])=>JSON.parse((await promisify(execFile)(process.execPath,[path.join(appRoot,'bin/sketch-diagram.mjs'),'--data',root,'canvas',...args,'--json'])).stdout);
  try{
    const spec=await fixture(),specPath=path.join(root,'input.json');await writeFile(specPath,JSON.stringify(spec));
    const created=await run(['create','--spec',specPath]),record=await store.current(spec.id);assert.equal(created.canvasId,spec.id);
    await run(['render','--canvas',spec.id]);const inspection=await run(['inspect','--canvas',spec.id,'--revision',record.revisionId,'--preview-page']);
    const rendered=renderCanvas(spec),manifest=await readJson(path.join(record.path,'screenshots.json'));
    assert(manifest.images.some((i:any)=>i.frameId==='overview'));assert(manifest.images.some((i:any)=>i.frameId==='detail'));
    const review:ReviewRecord={revisionId:record.revisionId,specHash:record.specHash,inspectedImages:manifest.images.filter((i:any)=>i.kind!=='preview').map((i:any)=>i.path),geometryResults:rendered.diagnostics,visualObservations:['Automated coverage checks only. Manual image inspection is separate.'],repairAttempts:0,outstandingIssues:[],status:'verified'};
    const incomplete={...review,inspectedImages:review.inspectedImages.filter(name=>!name.includes('frame-detail'))};await assert.rejects(()=>store.publish(spec.id,record.revisionId,incomplete),e=>code(e)==='review_required');
    const cropped=structuredClone(manifest);for(const image of cropped.images)if(image.frameId==='detail')image.rect.height=10;await writeFile(path.join(record.path,'screenshots.json'),JSON.stringify(cropped));await assert.rejects(()=>store.publish(spec.id,record.revisionId,review),e=>code(e)==='review_required');await writeFile(path.join(record.path,'screenshots.json'),JSON.stringify(manifest));
    const published=await store.publish(spec.id,record.revisionId,review);
    await withBrowser(root,async(page,url)=>{
      await readyPage(page,`${url}/c/${spec.id}`,published);assert.equal(await page.locator('#frames option').count(),2);
      await page.locator('#frames').selectOption('detail');await page.locator('#fit-frame').click();const focused=await page.locator('#drawing').getAttribute('style');await page.locator('#refresh').click();await page.waitForFunction(()=>!!(window as any).__DIAGRAM_READY__);assert.equal(await page.locator('#drawing').getAttribute('style'),focused);
      await page.locator('#overview').click();assert.notEqual(await page.locator('#drawing').getAttribute('style'),focused);
      await page.locator('[data-canvas-link="expansion"] text').click();assert.equal(await page.locator('#frames').inputValue(),'detail');
      assert.equal((await page.request.post(`${url}/api/canvas/${spec.id}`)).status(),405);assert.equal((await page.request.get(`${url}/canvas-assets/${spec.id}/${record.revisionId}/spec.json`)).status(),404);
      assert.equal((await page.request.get(`${url}/canvas-assets/${spec.id}/${record.revisionId}/frames/overview.svg`)).status(),200);
      const faces=await page.evaluate(()=>[...document.fonts].map(f=>({name:f.family,status:f.status})));assert(faces.some(f=>f.name==='SketchBody'&&f.status==='loaded'));
    });
    const capture=await run(['capture','--canvas',spec.id,'--revision',record.revisionId,'--frame','detail']);assert.equal(capture.screenshots.images.at(-1).frameId,'detail');
    const exported=await run(['export','--canvas',spec.id,'--frame','overview','--background','transparent','--scale','2']);const svg=await readFile(exported.artifacts.svg,'utf8');assert(!svg.includes('data-canvas-link'));assert(!svg.includes('data-link-selection'));assert(svg.includes('Collect'));assert(!svg.includes('Check'));
    const png=await readFile(exported.artifacts.png);assert.equal(png.readUInt32BE(16),Math.ceil(rendered.layout.frames.overview.width*2));
    await withBrowser(root,async(page)=>{const alpha=await page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const context=canvas.getContext('2d')!;context.drawImage(img,0,0);return context.getImageData(0,0,1,1).data[3];},png.toString('base64'));assert.equal(alpha,0);});
    const next=await store.revise(spec.id,{schemaVersion:2,operations:[{op:'setTitle',title:'New candidate'}]},published.revisionId);await assert.rejects(()=>store.revise(spec.id,{schemaVersion:2,operations:[{op:'setTitle',title:'Stale'}]},published.revisionId),e=>code(e)==='revision_conflict');
    await store.markFailed(spec.id,next.revisionId,[{severity:'error',code:'synthetic_failure',ids:[],message:'Synthetic',repairClasses:[]}]);assert.equal((await store.latest(spec.id))!.revisionId,published.revisionId);
    const restored=await store.restore(spec.id,published.revisionId,next.revisionId);assert.equal(restored.specHash,published.specHash);
    const graphs=new GraphStore(root),source=await graphs.create(await readJson(path.join(appRoot,'fixtures/cycle.json')));assert.equal(source.diagramId,source.spec.id);
    const sourceRender=renderDiagram(source.spec);await graphs.writeCandidateArtifacts(source.diagramId,source.revisionId,{'diagram.svg':sourceRender.svg,'debug.svg':sourceRender.debugSvg,'layout.json':sourceRender.layout,'diagnostics.json':sourceRender.diagnostics});
    await renderPng(root,source,sourceRender.layout.viewport,path.join(source.path,'diagram.png'));const sourceImages=await captureRevision(root,source,sourceRender.layout,sourceRender.diagnostics);
    await graphs.publish(source.diagramId,source.revisionId,{...review,revisionId:source.revisionId,specHash:source.specHash,geometryResults:sourceRender.diagnostics,inspectedImages:sourceImages.images.map(i=>i.path)});
    await run(['add-diagram','--canvas',spec.id,'--diagram',source.diagramId,'--revision',source.revisionId,'--frame','imported','--base',restored.revisionId]);
    const importedCanvas=(await store.current(spec.id)).spec;const imported=(await store.current(spec.id)).spec.frames.find(f=>f.id==='imported')!;assert.equal(imported.source!.specHash,source.specHash);assert.equal(imported.kind,'graph');const snapshotRendered=renderCanvas(importedCanvas,rendered.layout);for(const [id,node] of Object.entries(sourceRender.layout.nodes)){assert.equal(snapshotRendered.layout.frames.imported.graph!.nodes[id].x,node.x);assert.equal(snapshotRendered.layout.frames.imported.graph!.nodes[id].y,node.y);assert.equal(snapshotRendered.layout.frames.imported.graph!.nodes[id].seed,node.seed);}
    await graphs.revise(source.diagramId,{schemaVersion:1,operations:[{op:'updateNode',id:source.spec.nodes[0].id,changes:{label:'Changed source'}}]},source.revisionId);
    assert.deepEqual((await store.current(spec.id)).spec.frames.find(f=>f.id==='imported'),imported);
    assert.equal(inspection.screenshots.images.length,manifest.images.length);
    await assert.rejects(()=>store.writeCandidateArtifacts(spec.id,restored.revisionId,{'../escape.txt':'invalid'}),e=>code(e)==='validation_failure');
  }finally{await rm(root,{recursive:true,force:true});}
});
