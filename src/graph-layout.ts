import type { RenderGraph } from './documents.js';
import type { NodeGeometry } from './renderer.js';
import { right, bottom } from './geometry.js';

export function nodeFootprint(node: NodeGeometry) {
  const x=Math.min(node.x,node.textBounds.x,node.captionBounds?.x??node.x), y=Math.min(node.y,node.textBounds.y);
  const endX=Math.max(right(node),right(node.textBounds),node.captionBounds?right(node.captionBounds):right(node));
  const endY=Math.max(bottom(node),bottom(node.textBounds),node.captionBounds?bottom(node.captionBounds):bottom(node));
  return {x,y,width:endX-x,height:endY-y};
}
// Model placement runs only for a new arrangement. The renderer reapplies old coordinates and hard pins afterward.
export function placeModel(spec: RenderGraph, nodes: Record<string,NodeGeometry>, startY:number): boolean {
  if(spec.schemaVersion===1) return false;
  const strategy=spec.layout?.strategy??({path:'path',dag:'dag',network:'force',lanes:'lanes'} as const)[spec.model??'network'];
  if(!['path','dag','force','lanes'].includes(strategy)) return false;
  const gap=spec.layout?.gap??96, vertical=spec.layout?.orientation==='vertical';
  const order=spec.layout?.order??[], rank=new Map(order.map((id,i)=>[id,i]));
  const list=[...spec.nodes].sort((a,b)=>(rank.get(a.id)??1e6)-(rank.get(b.id)??1e6)||a.id.localeCompare(b.id)).map(n=>nodes[n.id]);
  const footprints=new Map(list.map(n=>[n.id,nodeFootprint(n)]));
  const width=Math.max(...list.map(n=>footprints.get(n.id)!.width)),height=Math.max(...list.map(n=>footprints.get(n.id)!.height));
  const set=(node:NodeGeometry,x:number,y:number)=>{const box=footprints.get(node.id)!;node.x=x+(node.x-box.x);node.y=y+(node.y-box.y);};
  if(strategy==='lanes') {
    const lanes=spec.lanes??[], rows=spec.rows??[{id:'_',label:''}];
    const maxPerCell=Math.max(1,...lanes.flatMap(l=>rows.map(r=>spec.nodes.filter(n=>n.lane===l.id && (n.row??'_')===r.id).length)));
    for(let li=0;li<lanes.length;li++) for(let ri=0;ri<rows.length;ri++) {
      const cell=list.filter(n=>{const original=spec.nodes.find(s=>s.id===n.id)!;return original.lane===lanes[li].id && (original.row??'_')===rows[ri].id;});
      cell.forEach((n,i)=>set(n,140+li*(width+gap+64),startY+120+ri*(maxPerCell*(height+gap)+100)+i*(height+gap)));
    }
    return true;
  }
  if(strategy==='dag' || strategy==='path') {
    const incoming=new Map(list.map(n=>[n.id,0])), outgoing=new Map(list.map(n=>[n.id,[] as string[]])), levels=new Map(list.map(n=>[n.id,0]));
    for(const edge of spec.edges??[]) {outgoing.get(edge.source)!.push(edge.target);incoming.set(edge.target,incoming.get(edge.target)!+1);}
    const queue=list.filter(n=>incoming.get(n.id)===0).map(n=>n.id);
    for(let i=0;i<queue.length;i++) for(const target of outgoing.get(queue[i])!) {levels.set(target,Math.max(levels.get(target)!,levels.get(queue[i])!+1));incoming.set(target,incoming.get(target)!-1);if(incoming.get(target)===0)queue.push(target);}
    const layers=Array.from({length:Math.max(...levels.values())+1},(_,level)=>list.filter(n=>levels.get(n.id)===level));
    for(let pass=0;pass<4;pass++) for(let li=1;li<layers.length;li++) {
      const previous=layers[li-1];
      const bary=(id:string)=>{const parents=(spec.edges??[]).filter(e=>e.target===id).map(e=>previous.findIndex(n=>n.id===e.source)).filter(i=>i>=0);return parents.length?parents.reduce((a,b)=>a+b,0)/parents.length:list.findIndex(n=>n.id===id);};
      layers[li].sort((a,b)=>bary(a.id)-bary(b.id)||a.id.localeCompare(b.id));
    }
    const breadth=Math.max(...layers.map(l=>l.length));
    layers.forEach((layer,li)=>layer.forEach((node,i)=>{
      const across=(i+(breadth-layer.length)/2)*(vertical?width+gap:height+gap);
      set(node,80+(vertical?across:li*(width+gap)),startY+50+(vertical?li*(height+gap):across));
    }));
    return true;
  }
  // Fixed iteration count and stable ordering make force placement repeatable without a new dependency.
  const radius=Math.max(180,list.length*(width+gap)/(Math.PI*2)), points=list.map((n,i)=>({x:Math.cos(i*2*Math.PI/list.length)*radius,y:Math.sin(i*2*Math.PI/list.length)*radius}));
  const index=new Map(list.map((n,i)=>[n.id,i])), k=Math.max(width,height)+gap;
  for(let iteration=0;iteration<180;iteration++) {
    const delta=points.map(()=>({x:0,y:0}));
    for(let a=0;a<points.length;a++) for(let b=a+1;b<points.length;b++) {
      const dx=points[a].x-points[b].x,dy=points[a].y-points[b].y,d=Math.max(1,Math.hypot(dx,dy)),force=k*k/d;
      delta[a].x+=dx/d*force;delta[a].y+=dy/d*force;delta[b].x-=dx/d*force;delta[b].y-=dy/d*force;
    }
    for(const edge of spec.edges??[]) {
      const a=index.get(edge.source)!,b=index.get(edge.target)!;if(a===b)continue;
      const dx=points[b].x-points[a].x,dy=points[b].y-points[a].y,d=Math.max(1,Math.hypot(dx,dy)),force=d*d/k;
      delta[a].x+=dx/d*force;delta[a].y+=dy/d*force;delta[b].x-=dx/d*force;delta[b].y-=dy/d*force;
    }
    const temperature=40*(1-iteration/180)+.1;
    points.forEach((p,i)=>{const d=Math.max(1,Math.hypot(delta[i].x,delta[i].y));p.x+=delta[i].x/d*Math.min(d,temperature);p.y+=delta[i].y/d*Math.min(d,temperature);});
  }
  const minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
  list.forEach((n,i)=>set(n,80+points[i].x-minX,startY+50+points[i].y-minY));return true;
}
