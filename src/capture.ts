import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import { existsSync } from 'node:fs';
import type { Bounds } from './geometry.js';
import { DiagramError, type Finding } from './schema.js';
import { browserPath, atomicJson, readJson } from './paths.js';
import { startServer } from './server.js';

export interface ScreenshotImage { path:string;kind:'overview'|'detail'|'debug'|'preview';rect:Bounds;findingIds:string[];pixelScale:number }
export interface ScreenshotManifest {diagramId:string;revisionId:string;specHash:string;viewport:{width:number;height:number};pixelScale:number;images:ScreenshotImage[]}
let registryRoot:string|undefined;
export async function launchBrowser() {
  const requestedRoot=browserPath();
  if(!existsSync(requestedRoot))throw new DiagramError('Chromium browser directory is missing: '+requestedRoot+'. Run npm run browser:install.','browser_failure',4);
  process.env.PLAYWRIGHT_BROWSERS_PATH=requestedRoot;
  registryRoot??=requestedRoot;
  const {chromium}=await import('playwright');
  const executablePath=path.join(requestedRoot,path.relative(registryRoot,chromium.executablePath()));
  try{return await chromium.launch({headless:true,executablePath});}catch(error){throw new DiagramError('Chromium unavailable: '+(error as Error).message+' Run npm run browser:install with PLAYWRIGHT_BROWSERS_PATH='+browserPath(), 'browser_failure',4);}
}
export async function withBrowser<T>(root:string,fn:(page:Page,url:string,browser:Browser)=>Promise<T>) {
  const {server,info}=await startServer(root,0,false);let browser:Browser|undefined;
  try{browser=await launchBrowser();const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
    await context.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'||url.protocol==='data:'?route.continue():route.abort();});
    const page=await context.newPage();return await fn(page,info.url,browser);
  }finally{try{await browser?.close()}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}}
}
export async function readyPage(page:Page,url:string,record:any) {
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!(window as any).__DIAGRAM_READY__ || !!(window as any).__DIAGRAM_ERROR__,{},{timeout:15000});
  const ready=await page.evaluate(()=>(window as any).__DIAGRAM_READY__);
  if(!ready||ready.diagramId!==record.diagramId||ready.revisionId!==record.revisionId||ready.specHash!==record.specHash)throw new DiagramError('Screenshot revision/hash does not match the requested candidate.','stale_capture',5);
  if(!ready.fontsLoaded)throw new DiagramError('The browser did not load the bundled fonts.','missing_fonts',4);
}
async function setCrop(page:Page,rect:Bounds,scale=1,debugSvg?:string,background?:string) {
  if(rect.width<=0||rect.height<=0||!Object.values(rect).every(Number.isFinite)||rect.width*rect.height*scale*scale>32_000_000||rect.width*scale>16000||rect.height*scale>16000)throw new DiagramError('Capture exceeds the 32 megapixel or 16000 pixel side limit. Choose a smaller region or lower scale.','pixel_limit',3);
  const width=Math.ceil(rect.width*scale),height=Math.ceil(rect.height*scale);
  await page.setViewportSize({width:Math.max(1,width),height:Math.max(1,height)});
  await page.evaluate(({rect,width,height,debugSvg,background})=>{
    const drawing=document.querySelector('#drawing')!;if(debugSvg)drawing.innerHTML=debugSvg;
    const svg=drawing.querySelector('svg')!;svg.setAttribute('viewBox',[rect.x,rect.y,rect.width,rect.height].join(' '));svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));
    if(background){const bg=svg.querySelector('[data-background],#diagram-background');if(bg){bg.setAttribute('fill',background)}else if(background!=='transparent'){const node=document.createElementNS('http://www.w3.org/2000/svg','rect');node.setAttribute('x',String(rect.x));node.setAttribute('y',String(rect.y));node.setAttribute('width',String(rect.width));node.setAttribute('height',String(rect.height));node.setAttribute('fill',background);svg.insertBefore(node,svg.firstChild)}
      for(const mask of svg.querySelectorAll('.label-background')){if(background==='transparent')mask.remove();else mask.setAttribute('fill',background);}
    }
  },{rect,width,height,debugSvg,background});
  await page.evaluate(()=>document.fonts.ready);
}
export async function renderPng(root:string,record:any,bounds:Bounds,filename:string,scale=1,background?:string) {
  return withBrowser(root,async(page,url)=>{await readyPage(page,`${url}/capture/${record.diagramId}/${record.revisionId}`,record);await setCrop(page,bounds,scale,undefined,background);await page.locator('#drawing').screenshot({path:filename,omitBackground:true});return filename;});
}
export async function captureRevision(root:string,record:any,layout:any,findings:Finding[],options:{region?:Bounds;debug?:boolean;preview?:boolean;scale?:number;outputDir?:string}={}) {
  const bounds:Bounds=layout.bounds || layout.viewport || layout.viewportBounds || layout.documentBounds;
  if(!bounds)throw new DiagramError('Layout has no document bounds.','layout_state_invalid',3);
  const outputDir=options.outputDir||record.path;
  const directory=path.join(outputDir,'screenshots');await mkdir(directory,{recursive:true});
  const manifest:ScreenshotManifest={diagramId:record.diagramId,revisionId:record.revisionId,specHash:record.specHash,viewport:{width:1440,height:1000},pixelScale:options.scale||1,images:[]};
  await withBrowser(root,async(page,url)=>{
    await readyPage(page,`${url}/capture/${record.diagramId}/${record.revisionId}`,record);
    const save=async(name:string,kind:ScreenshotImage['kind'],rect:Bounds,scale:number,findingIds:string[]=[],debugSvg?:string)=>{await setCrop(page,rect,scale,debugSvg);await page.locator('#drawing').screenshot({path:path.join(directory,name),omitBackground:true});manifest.images.push({path:'screenshots/'+name,kind,rect,findingIds,pixelScale:scale});};
    if(options.region){await save('region-'+Date.now()+'.png','detail',options.region,options.scale||1);return;}
    const overviewScale=Math.min(options.scale||1,1600/bounds.width,1200/bounds.height);manifest.pixelScale=overviewScale;await save('overview.png','overview',bounds,overviewScale);
    if(overviewScale<.85){let count=0;const stepX=1100,stepY=800;
      for(let y=bounds.y;y<bounds.y+bounds.height;y+=stepY)for(let x=bounds.x;x<bounds.x+bounds.width;x+=stepX){
        if(++count>100)throw new DiagramError('Diagram needs more than 100 readable tiles. Narrow the diagram view.','tile_limit',3);
        await save('detail-'+count+'.png','detail',{x,y,width:Math.min(1200,bounds.x+bounds.width-x),height:Math.min(900,bounds.y+bounds.height-y)},1);
      }
    }
    for(const [index,finding] of findings.filter(f=>f.bounds).slice(0,20).entries()){
      const b=finding.bounds!;const rect={x:Math.max(bounds.x,b.x-70),y:Math.max(bounds.y,b.y-70),width:Math.min(1200,b.width+140),height:Math.min(900,b.height+140)};
      rect.width=Math.min(rect.width,bounds.x+bounds.width-rect.x);rect.height=Math.min(rect.height,bounds.y+bounds.height-rect.y);
      await save('finding-'+index+'.png','detail',rect,1,[finding.code+':'+finding.ids.join(',')]);
    }
    if(options.debug)await save('debug.png','debug',bounds,overviewScale,findings.map(f=>f.code+':'+f.ids.join(',')),await readFile(path.join(record.path,'debug.svg'),'utf8'));
    if(options.preview){await page.setViewportSize({width:1440,height:1000});await readyPage(page,`${url}/d/${record.diagramId}?revision=${record.revisionId}`,record);await page.screenshot({path:path.join(directory,'preview.png')});manifest.images.push({path:'screenshots/preview.png',kind:'preview',rect:bounds,findingIds:[],pixelScale:1});}
  });
  if(options.region){let previous;try{previous=await readJson<ScreenshotManifest>(path.join(outputDir,'screenshots.json'))}catch{}if(previous&&previous.specHash===record.specHash)manifest.images=[...previous.images,...manifest.images];}
  await atomicJson(path.join(outputDir,'screenshots.json'),manifest);return manifest;
}
