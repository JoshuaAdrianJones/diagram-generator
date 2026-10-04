import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {DiagramStore} from '../dist/src/storage.js';
import {assertSpec} from '../dist/src/schema.js';
import {renderDiagram} from '../dist/src/renderer.js';
import {renderPng,captureRevision} from '../dist/src/capture.js';
import {appRoot,readJson} from '../dist/src/paths.js';

const data=path.resolve(process.env.SKETCH_DIAGRAM_DATA||'.local/acceptance-data'),store=new DiagramStore(data);
const names=process.argv.slice(2).length?process.argv.slice(2):['cycle','parallel-self-loop','groups-notes','long-label','bad-layout','dense-20'];
const results=[];
for(const name of names){
  const spec=assertSpec(await readJson(path.join(appRoot,'fixtures',name+'.json')));
  let record;try{record=await store.current(spec.id)}catch{record=await store.create(spec)}
  if(record.status==='published'){results.push({name,alreadyPublished:true});continue;}
  const start=performance.now();const rendered=renderDiagram(record.spec);
  await store.writeCandidateArtifacts(spec.id,record.revisionId,{'diagram.svg':rendered.svg,'debug.svg':rendered.debugSvg,'layout.json':rendered.layout,'diagnostics.json':rendered.diagnostics});
  await renderPng(data,record,rendered.layout.bounds,path.join(record.path,'diagram.png'));
  const renderMs=Math.round(performance.now()-start),captureStart=performance.now();
  const manifest=await captureRevision(data,record,rendered.layout,rendered.diagnostics,{debug:rendered.diagnostics.length>0});
  results.push({name,diagramId:record.diagramId,revisionId:record.revisionId,specHash:record.specHash,path:record.path,findings:rendered.diagnostics,renderMs,captureMs:Math.round(performance.now()-captureStart),images:manifest.images.map(image=>path.join(record.path,image.path))});
}
await mkdir('artifacts/acceptance',{recursive:true});await writeFile('artifacts/acceptance/fixture-results.json',JSON.stringify(results,null,2)+'\n');
process.stdout.write(JSON.stringify(results,null,2)+'\n');
