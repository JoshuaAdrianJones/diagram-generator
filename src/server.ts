import http from 'node:http';
import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DiagramStore } from './storage.js';
import { atomicJson, readJson, escapeHtml } from './paths.js';

export async function loadRecord(store: DiagramStore, id: string, revision?: string): Promise<any> {
  if (!revision) { const record = await store.latest(id); if (!record) throw new Error('No reviewed revision has been published.'); return record; }
  try { return await store.readCandidate(id, revision); } catch { return store.readRevision(id, revision); }
}
const identity = (root: string) => createHash('sha256').update(path.resolve(root)).digest('hex');

function previewHtml(id: string, revision?: string, capture = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sketch diagram</title><style>
*{box-sizing:border-box}body{margin:0;font:14px system-ui;color:#262b31;background:#f4f3ef}header{height:76px;display:flex;align-items:center;gap:10px;padding:12px 22px;background:#fff;border-bottom:1px solid #ddd}h1{font-size:19px;margin:0 0 4px}small{color:#687078}.heading{margin-right:auto}button,a.button{border:1px solid #d8dcdf;border-radius:7px;padding:8px 11px;background:white;color:inherit;text-decoration:none;font:inherit;cursor:pointer}button:hover,a.button:hover{background:#eef3ef}#stage{position:absolute;inset:76px 0 0;overflow:hidden;touch-action:none;cursor:grab}#drawing{position:absolute;transform-origin:0 0;background:transparent}#drawing svg{display:block}#message{padding:32px;color:#687078}body.capture{background:transparent}body.capture #stage{position:static;overflow:visible;cursor:default}body.capture #drawing{position:static;transform:none!important}body.capture header{display:none}#panel{display:none;position:absolute;right:14px;top:88px;background:white;padding:18px;max-width:350px;max-height:75vh;overflow:auto;border:1px solid #ddd;border-radius:8px}#panel p{margin:6px 0 12px}
</style></head><body class="${capture ? 'capture' : ''}"><header><div class="heading"><h1 id="title">Sketch diagram</h1><small id="status">Loading…</small></div><button id="refresh">Refresh</button><button id="minus" aria-label="Zoom out">−</button><button id="plus" aria-label="Zoom in">+</button><button id="fit">Fit</button><a class="button" id="svg">SVG</a><a class="button" id="png">PNG</a><button id="diagnostics">Diagnostics</button></header><main id="stage"><div id="drawing"></div><p id="message">Loading diagram…</p></main><aside id="panel"></aside><script>
const diagramId=${JSON.stringify(id)},requestedRevision=${JSON.stringify(revision || null)},capture=${capture};
let zoom=1,panX=0,panY=0,metadata;const drawing=document.getElementById('drawing'),stage=document.getElementById('stage'),storageKey='sketch-view:'+diagramId;
function apply(){drawing.style.transform='translate('+panX+'px,'+panY+'px) scale('+zoom+')';if(!capture)localStorage.setItem(storageKey,JSON.stringify({zoom,panX,panY}));}
function fit(){if(!metadata)return;const svg=drawing.querySelector('svg');zoom=Math.min((stage.clientWidth-64)/svg.width.baseVal.value,(stage.clientHeight-64)/svg.height.baseVal.value,1.4);panX=(stage.clientWidth-svg.width.baseVal.value*zoom)/2;panY=(stage.clientHeight-svg.height.baseVal.value*zoom)/2;apply();}
async function load(){try{window.__DIAGRAM_READY__=null;window.__DIAGRAM_ERROR__=null;const response=await fetch('/api/diagram/'+encodeURIComponent(diagramId)+(requestedRevision?'?revision='+requestedRevision:''),{cache:'no-store'});metadata=await response.json();if(!response.ok)throw new Error(metadata.error);document.getElementById('title').textContent=metadata.title;document.title=metadata.title+' · Sketch diagram';document.getElementById('status').textContent=metadata.revisionId+' · '+metadata.status+(metadata.pending?(metadata.pendingStatus==='failed'?' · New revision failed':' · New revision pending review'):'');drawing.innerHTML=await (await fetch(metadata.svgUrl,{cache:'no-store'})).text();document.getElementById('message').hidden=true;document.getElementById('svg').href=metadata.svgUrl;document.getElementById('svg').download=diagramId+'.svg';document.getElementById('png').href=metadata.pngUrl;document.getElementById('png').download=diagramId+'.png';await document.fonts.ready;await Promise.all([document.fonts.load('20px SketchBody'),document.fonts.load('32px SketchHeading')]);if(!capture){try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved){({zoom,panX,panY}=saved);apply();}else fit();}catch{fit();}}window.__DIAGRAM_READY__={diagramId,revisionId:metadata.revisionId,specHash:metadata.specHash,fontsLoaded:document.fonts.check('20px SketchBody')&&document.fonts.check('32px SketchHeading')};}catch(error){document.getElementById('message').hidden=false;document.getElementById('message').textContent=error.message;document.getElementById('status').textContent='Diagram unavailable';window.__DIAGRAM_ERROR__=error.message;}}
document.getElementById('refresh').onclick=load;document.getElementById('fit').onclick=fit;document.getElementById('plus').onclick=()=>{zoom*=1.2;apply()};document.getElementById('minus').onclick=()=>{zoom/=1.2;apply()};stage.onwheel=e=>{e.preventDefault();const next=Math.max(.05,Math.min(8,zoom*(e.deltaY<0?1.1:.9)));panX=e.clientX-(e.clientX-panX)*next/zoom;const sy=e.clientY-76;panY=sy-(sy-panY)*next/zoom;zoom=next;apply()};let drag;stage.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,panX,panY};stage.setPointerCapture(e.pointerId)};stage.onpointermove=e=>{if(drag){panX=drag.panX+e.clientX-drag.x;panY=drag.panY+e.clientY-drag.y;apply()}};stage.onpointerup=()=>drag=null;document.getElementById('diagnostics').onclick=async()=>{const panel=document.getElementById('panel');panel.style.display=panel.style.display==='block'?'none':'block';panel.replaceChildren();const findings=await(await fetch(metadata.diagnosticsUrl)).json();const items=Array.isArray(findings)?findings:findings.findings||[];if(!items.length)panel.textContent='No geometry findings.';for(const f of items){const p=document.createElement('p');p.textContent=f.severity+': '+f.message;panel.append(p)}};load();
</script></body></html>`;
}

export async function startServer(root: string, port = 4317, persist = true) {
  const store = new DiagramStore(root), token = randomUUID();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(405);res.end();return;}
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const pieces = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (pieces[0] === 'identity') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'sketch-diagram',dataIdentity:identity(root),token,pid:process.pid}));return;}
      if (!pieces.length) {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Sketch diagram</title><main style="font:18px system-ui;margin:10vh auto;max-width:600px"><h1>Sketch diagram</h1><p>No diagram selected. Ask Codex to draw a concept map, then open its preview link.</p></main>');return;}
      const valid = (s: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(s);
      if (pieces[0] === 'd' || pieces[0] === 'capture') {
        if (!valid(pieces[1] || '') || (pieces[2] && !valid(pieces[2]))) throw new Error('Invalid diagram URL');
        const revision = pieces[0]==='capture' ? pieces[2] : url.searchParams.get('revision') || undefined;
        if(revision && !valid(revision))throw new Error('Invalid revision');
        res.setHeader('Content-Type','text/html; charset=utf-8');res.end(previewHtml(pieces[1], revision, pieces[0]==='capture'));return;
      }
      if (pieces[0]==='api' && pieces[1]==='diagram' && valid(pieces[2] || '')) {
        const revision=url.searchParams.get('revision') || undefined;
        if (revision && !valid(revision)) throw new Error('Invalid revision');
        const record=await loadRecord(store,pieces[2],revision);
        let current;try{current=await store.current(pieces[2])}catch{}
        const prefix='/assets/'+pieces[2]+'/'+record.revisionId;
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({diagramId:pieces[2],revisionId:record.revisionId,specHash:record.specHash,title:record.spec.title,status:record.status,pending:!revision&&current?.revisionId!==record.revisionId,pendingStatus:current?.status,svgUrl:prefix+'/diagram.svg',pngUrl:prefix+'/diagram.png',diagnosticsUrl:prefix+'/diagnostics.json'}));return;
      }
      if (pieces[0]==='assets' && pieces.length===4 && valid(pieces[1])&&valid(pieces[2])&&['diagram.svg','diagram.png','debug.svg','diagnostics.json'].includes(pieces[3])) {
        const record=await loadRecord(store,pieces[1],pieces[2]);
        const types: Record<string,string>={svg:'image/svg+xml',png:'image/png',json:'application/json'};
        res.setHeader('Content-Type',types[pieces[3].split('.').at(-1)!]);res.end(await readFile(path.join(record.path,pieces[3])));return;
      }
      res.writeHead(404);res.end('Not found');
    } catch(error) {res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:(error as Error).message}));}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',e=>{if((e as NodeJS.ErrnoException).code==='EADDRINUSE'){server.listen(0,'127.0.0.1',resolve)}else reject(e)});server.listen(port,'127.0.0.1',resolve)});
  const address=server.address() as {port:number};
  const info={url:`http://127.0.0.1:${address.port}`,token,pid:process.pid,dataIdentity:identity(root)};
  if(persist){try{await atomicJson(path.join(root,'server.json'),info)}catch(error){await new Promise<void>(resolve=>server.close(()=>resolve()));throw error;}}
  return {server,info};
}

export async function serverIdentity(root:string):Promise<any|null> {
  try{const info=await readJson(path.join(root,'server.json'));const response=await fetch(info.url+'/identity',{signal:AbortSignal.timeout(1200)});const remote=await response.json();return remote.app==='sketch-diagram'&&remote.token===info.token&&remote.dataIdentity===identity(root)?info:null}catch{return null}
}
export async function ensureServer(root:string) {
  const existing=await serverIdentity(root);if(existing)return existing;
  await mkdir(root,{recursive:true});
  const logfile=await open(path.join(root,'server.log'),'a');
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--data',root],{detached:true,stdio:['ignore',logfile.fd,logfile.fd],env:process.env});child.unref();await logfile.close();
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){const info=await serverIdentity(root);if(info)return info;await new Promise(resolve=>setTimeout(resolve,80));}
  throw new Error('Preview server failed to start. See '+path.join(root,'server.log'));
}
export async function stopServer(root:string) {const info=await serverIdentity(root);if(info){process.kill(info.pid,'SIGTERM');await unlink(path.join(root,'server.json')).catch(()=>{});}return {stopped:!!info};}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root=process.argv[process.argv.indexOf('--data')+1];
  startServer(root).then(({server})=>{for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>server.close(()=>process.exit(0)))}).catch(error=>{console.error(error);process.exit(4)});
}
