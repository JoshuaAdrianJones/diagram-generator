export interface Point { x: number; y: number }
export interface Bounds { x: number; y: number; width: number; height: number }
export const right = (b: Bounds) => b.x + b.width;
export const bottom = (b: Bounds) => b.y + b.height;
export const center = (b: Bounds): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
export const expand = (b: Bounds, padding: number): Bounds => ({ x: b.x - padding, y: b.y - padding, width: b.width + padding * 2, height: b.height + padding * 2 });
export const overlaps = (a: Bounds, b: Bounds, clearance = 0) => a.x < right(b) + clearance && right(a) + clearance > b.x && a.y < bottom(b) + clearance && bottom(a) + clearance > b.y;
export const contains = (b: Bounds, p: Point, inset = 0) => p.x > b.x + inset && p.x < right(b) - inset && p.y > b.y + inset && p.y < bottom(b) - inset;
export function union(bounds: Bounds[]): Bounds {
  if (!bounds.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y));
  return { x, y, width: Math.max(...bounds.map(right)) - x, height: Math.max(...bounds.map(bottom)) - y };
}
export function pathBounds(points: Point[], pad = 0): Bounds {
  return expand(union(points.map(p => ({ ...p, width: 0, height: 0 }))), pad);
}
export function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function boundary(box: Bounds, towards: Point, ellipse = false, cornerRadius = 0): Point {
  const c = center(box), dx = towards.x - c.x, dy = towards.y - c.y;
  if (dx === 0 && dy === 0) return { x: right(box), y: c.y };
  let t = ellipse ? 1 / Math.sqrt((dx / (box.width / 2)) ** 2 + (dy / (box.height / 2)) ** 2) : 1 / Math.max(Math.abs(dx) / (box.width / 2), Math.abs(dy) / (box.height / 2));
  const point = { x: c.x + dx * t, y: c.y + dy * t }, radius = Math.min(cornerRadius, box.width / 2, box.height / 2);
  if (!ellipse && radius > 0 && Math.abs(point.x - c.x) > box.width / 2 - radius && Math.abs(point.y - c.y) > box.height / 2 - radius) {
    const corner = { x: dx > 0 ? right(box) - radius : box.x + radius, y: dy > 0 ? bottom(box) - radius : box.y + radius };
    const ax = c.x - corner.x, ay = c.y - corner.y, a = dx * dx + dy * dy, b = 2 * (ax * dx + ay * dy), cc = ax * ax + ay * ay - radius * radius;
    const discriminant = b * b - 4 * a * cc;
    if (discriminant >= 0) t = (-b + Math.sqrt(discriminant)) / (2 * a);
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}
export function quadratic(a: Point, control: Point, b: Point, steps = 64): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y };
  });
}
export function cubic(a: Point, c1: Point, c2: Point, b: Point, steps = 96): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, u = 1 - t;
    return { x: u ** 3 * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * b.x, y: u ** 3 * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * b.y };
  });
}
export function polyline(points: Point[], step = 8): Point[] {
  const sampled: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, count = Math.max(1, Math.ceil(distance(a, b) / step));
    for (let j = 0; j < count; j++) sampled.push({ x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count });
  }
  sampled.push(points[points.length - 1]!);
  return sampled;
}
export function pathHitsBox(points: Point[], box: Bounds, inset = 0): boolean { return points.some(point => contains(box, point, inset)); }
export function pathsIntersect(a: Point[], b: Point[], tolerance = 3): Point | undefined {
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const p = a[i - 1]!, q = b[j - 1]!, r = { x: a[i]!.x - p.x, y: a[i]!.y - p.y }, s = { x: b[j]!.x - q.x, y: b[j]!.y - q.y };
    const denominator = r.x * s.y - r.y * s.x;
    if (Math.abs(denominator) < 0.000001) continue;
    const dx = q.x - p.x, dy = q.y - p.y;
    const t = (dx * s.y - dy * s.x) / denominator, u = (dx * r.y - dy * r.x) / denominator;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { x: p.x + t * r.x, y: p.y + t * r.y };
  }
  if (a.length && b.length && distance(a[Math.floor(a.length / 2)]!, b[Math.floor(b.length / 2)]!) < tolerance) return a[Math.floor(a.length / 2)];
  return undefined;
}
