import { DiagramStore, type StoreContract } from './storage.js';
import { DiagramError, applyPatch, type Patch } from './schema.js';
import { assertCanvas, assertSavedGraph, applyCanvasPatch, applyGraphPatch, type CanvasSpec, type CanvasPatch, type SavedGraph, type GraphPatch } from './documents.js';
import type { LayoutState } from './renderer.js';
import type { Bounds } from './geometry.js';
import type { CanvasLayoutState } from './canvas-renderer.js';

const graphs: StoreContract<SavedGraph, Patch | GraphPatch> = {
  collection: 'diagrams', assert: assertSavedGraph,
  apply(spec, patch) {
    if(spec.schemaVersion === 1) {
      if(patch.schemaVersion !== 1) throw new DiagramError('Legacy diagrams require a version 1 patch.', 'validation_failure');
      return applyPatch(spec, patch);
    }
    if(patch.schemaVersion !== 2) throw new DiagramError('Version 2 graphs require a version 2 patch.', 'validation_failure');
    return applyGraphPatch(spec, patch);
  },
};
export class GraphStore extends DiagramStore<SavedGraph, Patch | GraphPatch, LayoutState> {
  constructor(root?: string) { super(root, graphs); }
}
export class CanvasStore extends DiagramStore<CanvasSpec, CanvasPatch, CanvasLayoutState> {
  constructor(root?: string) { super(root, {
    collection:'canvases', assert:assertCanvas, apply:applyCanvasPatch,
    reviewCoverage(layout, images, inspected) {
      for(const id of Object.keys(layout.frames)) {
        const required=images.filter(image=>image.frameId===id && image.kind==='detail' && (image.pixelScale??0)>=1);
        if(!required.length || required.some(image=>!inspected.has(image.path)) || !covers(layout.frames[id],required.map(image=>image.rect).filter((rect):rect is Bounds=>!!rect))) throw new DiagramError('Review requires every readable frame tile: '+id, 'review_required',3);
      }
    },
  }); }
}

function covers(frame:Bounds,rectangles:Bounds[]):boolean {
  const xs=[frame.x,frame.x+frame.width,...rectangles.flatMap(rect=>[Math.max(frame.x,rect.x),Math.min(frame.x+frame.width,rect.x+rect.width)])].filter(x=>x>=frame.x&&x<=frame.x+frame.width).sort((a,b)=>a-b);
  for(let i=1;i<xs.length;i++){
    if(xs[i]===xs[i-1])continue;
    const spans=rectangles.filter(rect=>rect.x<=xs[i-1]+.01 && rect.x+rect.width>=xs[i]-.01).map(rect=>[rect.y,rect.y+rect.height]).sort((a,b)=>a[0]-b[0]);
    let end=frame.y;
    for(const span of spans){if(span[0]>end+.01)break;end=Math.max(end,span[1]);}
    if(end<frame.y+frame.height-.01)return false;
  }
  return true;
}
