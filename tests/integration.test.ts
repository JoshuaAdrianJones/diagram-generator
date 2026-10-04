import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DiagramStore,type ReviewRecord} from '../src/storage.js';
import {assertSpec,hashSpec} from '../src/schema.js';
import {renderDiagram} from '../src/renderer.js';
import {captureRevision,renderPng,withBrowser,readyPage,launchBrowser} from '../src/capture.js';
import {startServer} from '../src/server.js';
import {appRoot,readJson} from '../src/paths.js';

test('browser rendering, exact captures, standalone fonts, publication, refresh, and failure recovery',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sketch-integration-')),store=new DiagramStore(root);
  try{
    const spec=assertSpec(await readJson(path.join(appRoot,'fixtures/concept-map.json')));
    const candidate=await store.create(spec);const rendered=renderDiagram(spec);
    assert.equal(rendered.diagnostics.filter(f=>f.severity==='error').length,0,JSON.stringify(rendered.diagnostics));
    await store.writeCandidateArtifacts(spec.id,candidate.revisionId,{'diagram.svg':rendered.svg,'debug.svg':rendered.debugSvg,'layout.json':rendered.layout,'diagnostics.json':rendered.diagnostics});
    const bounds=(rendered.layout as any).bounds;
    await renderPng(root,candidate,bounds,path.join(candidate.path,'diagram.png'));
    const manifest=await captureRevision(root,candidate,rendered.layout,rendered.diagnostics,{preview:true});
    assert(manifest.images.some(image=>image.kind==='overview'));assert(manifest.images.some(image=>image.kind==='preview'));
    const png=await readFile(path.join(candidate.path,'diagram.png'));assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),Math.ceil(bounds.width));
    await withBrowser(root,async(page,url)=>{
      await assert.rejects(()=>readyPage(page,`${url}/capture/${spec.id}/${candidate.revisionId}`,{...candidate,specHash:'stale'}),error=>(error as any).code==='stale_capture');
      await page.goto(`${url}/assets/${spec.id}/${candidate.revisionId}/diagram.svg`);await page.evaluate(()=>document.fonts.ready);
      assert(await page.evaluate(()=>document.fonts.check('20px SketchBody')&&document.fonts.check('32px SketchHeading')));
      const labels=await page.locator('text').allTextContents();assert(labels.join(' ').includes('Focus question'));assert(labels.join(' ').includes('tested against'));
      assert.equal((await page.request.get(`${url}/assets/${spec.id}/${candidate.revisionId}/arbitrary.txt`)).status(),404);
      assert.equal((await page.request.post(`${url}/api/diagram/${spec.id}`)).status(),405);
    });
    const review:ReviewRecord={revisionId:candidate.revisionId,specHash:candidate.specHash,inspectedImages:manifest.images.filter(image=>image.kind!=='preview').map(image=>image.path),geometryResults:rendered.diagnostics,visualObservations:['Automated browser acceptance harness; human visual review is recorded separately.'],repairAttempts:0,outstandingIssues:[],status:'verified'};
    const published=await store.publish(spec.id,candidate.revisionId,review);
    const exported=JSON.parse((await promisify(execFile)(process.execPath,[path.join(appRoot,'bin/sketch-diagram.mjs'),'--data',root,'export','--diagram',spec.id,'--background','transparent','--scale','2','--out',path.join(root,'export-check'),'--json'],{cwd:tmpdir()})).stdout);
    const transparentSvg=await readFile(exported.artifacts.svg,'utf8');assert(/id="diagram-background"[^>]*fill="transparent"/.test(transparentSvg));assert(!transparentSvg.includes('class="label-background"'));
    const transparentPng=await readFile(exported.artifacts.png);assert.equal(transparentPng.readUInt32BE(16),Math.ceil(bounds.width*2));
    await withBrowser(root,async(page)=>{
      const alpha=await page.evaluate(async(data)=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d')!;context.drawImage(image,0,0);return context.getImageData(0,0,1,1).data[3];},transparentPng.toString('base64'));assert.equal(alpha,0);
    });
    await withBrowser(root,async(page,url)=>{
      const stable=`${url}/d/${spec.id}`;await readyPage(page,stable,published);
      await page.locator('#plus').click();const before=await page.locator('#drawing').evaluate(element=>(element as HTMLElement).style.transform);
      const next=await store.revise(spec.id,{schemaVersion:1,operations:[{op:'updateNode',id:'evidence',changes:{label:'Evidence!'}}]},published.revisionId);
      const r=renderDiagram(next.spec,rendered.layout);assert.equal((r.layout as any).nodes.question.bounds.x,(rendered.layout as any).nodes.question.bounds.x);
      await store.writeCandidateArtifacts(spec.id,next.revisionId,{'diagram.svg':r.svg,'debug.svg':r.debugSvg,'layout.json':r.layout,'diagnostics.json':r.diagnostics});
      await renderPng(root,next,(r.layout as any).bounds,path.join(next.path,'diagram.png'));
      const images=await captureRevision(root,next,r.layout,r.diagnostics);
      await page.reload();assert.equal((await page.evaluate(()=>(window as any).__DIAGRAM_READY__?.revisionId))||published.revisionId,published.revisionId);
      const nextPublished=await store.publish(spec.id,next.revisionId,{...review,revisionId:next.revisionId,specHash:next.specHash,inspectedImages:images.images.map(image=>image.path),geometryResults:r.diagnostics});
      await readyPage(page,stable,nextPublished);assert.equal(await page.locator('#drawing').evaluate(element=>(element as HTMLElement).style.transform),before);
      assert.equal((await page.request.get(`${url}/api/diagram/${spec.id}`)).headers()['cache-control'],'no-store');
      const prior=process.env.PLAYWRIGHT_BROWSERS_PATH;process.env.PLAYWRIGHT_BROWSERS_PATH=path.join(root,'missing-browser');
      try{await assert.rejects(launchBrowser,error=>(error as any).code==='browser_failure');assert.equal((await store.latest(spec.id))?.revisionId,nextPublished.revisionId)}finally{process.env.PLAYWRIGHT_BROWSERS_PATH=prior;}
    });
    const {server,info}=await startServer(root,0,false);try{const response=await fetch(info.url+'/');assert((await response.text()).includes('No diagram selected'));const fallback=await startServer(root,Number(new URL(info.url).port),false);assert.notEqual(fallback.info.url,info.url);await new Promise<void>(resolve=>fallback.server.close(()=>resolve()));}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }catch(error){console.error('Browser acceptance failure:',error);throw error;}finally{await rm(root,{recursive:true,force:true});}
});
