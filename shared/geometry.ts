export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(x: number, y: number): Vec {
  const len = Math.hypot(x, y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

/** Différence d'angle ramenée dans [-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function circleRectOverlap(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = clamp(cx, rect.x, rect.x + rect.w);
  const ny = clamp(cy, rect.y, rect.y + rect.h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function circleHitsAny(cx: number, cy: number, r: number, rects: readonly Rect[]): boolean {
  for (const rc of rects) if (circleRectOverlap(cx, cy, r, rc)) return true;
  return false;
}

export function rectHitsAny(rect: Rect, rects: readonly Rect[]): boolean {
  for (const rc of rects) if (rectsOverlap(rect, rc)) return true;
  return false;
}

/** Repousse un cercle hors d'un rectangle. Retourne vrai s'il y avait chevauchement. */
function resolveCircleRect(p: Vec, r: number, rect: Rect): boolean {
  const nx = clamp(p.x, rect.x, rect.x + rect.w);
  const ny = clamp(p.y, rect.y, rect.y + rect.h);
  const dx = p.x - nx;
  const dy = p.y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const push = r - d;
    p.x += (dx / d) * push;
    p.y += (dy / d) * push;
  } else {
    // Centre à l'intérieur du rectangle : sortie par le côté le plus proche.
    const left = p.x - rect.x;
    const right = rect.x + rect.w - p.x;
    const top = p.y - rect.y;
    const bottom = rect.y + rect.h - p.y;
    const m = Math.min(left, right, top, bottom);
    if (m === left) p.x = rect.x - r;
    else if (m === right) p.x = rect.x + rect.w + r;
    else if (m === top) p.y = rect.y - r;
    else p.y = rect.y + rect.h + r;
  }
  return true;
}

/**
 * Déplace un cercle en glissant le long des obstacles.
 * Le déplacement est découpé en petits pas pour ne jamais traverser un mur.
 */
export function moveCircle(p: Vec, dx: number, dy: number, r: number, rects: readonly Rect[]): Vec {
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (r * 0.4)));
  const out = { x: p.x, y: p.y };
  for (let i = 0; i < steps; i++) {
    out.x += dx / steps;
    out.y += dy / steps;
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (const rc of rects) hit = resolveCircleRect(out, r, rc) || hit;
      if (!hit) break;
    }
  }
  return out;
}

/** Paramètre t ∈ [0,1] d'entrée du segment dans le rectangle, ou null. */
export function segmentRectT(x1: number, y1: number, x2: number, y2: number, r: Rect): number | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let tmin = 0;
  let tmax = 1;
  const slabs: [number, number, number, number][] = [
    [dx, x1, r.x, r.x + r.w],
    [dy, y1, r.y, r.y + r.h],
  ];
  for (const [d, o, lo, hi] of slabs) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

export function lineOfSight(a: Vec, b: Vec, blockers: readonly Rect[]): boolean {
  for (const rc of blockers) {
    const t = segmentRectT(a.x, a.y, b.x, b.y, rc);
    if (t !== null && t < 1) return false;
  }
  return true;
}

/** Distance jusqu'au premier obstacle dans une direction donnée. */
export function raycast(o: Vec, angle: number, maxDist: number, blockers: readonly Rect[]): number {
  const ex = o.x + Math.cos(angle) * maxDist;
  const ey = o.y + Math.sin(angle) * maxDist;
  let best = 1;
  for (const rc of blockers) {
    const t = segmentRectT(o.x, o.y, ex, ey, rc);
    if (t !== null && t < best) best = t;
  }
  return best * maxDist;
}

/** Un cône de vision voit-il la cible ? (portée, angle, murs) */
export function coneSees(
  origin: Vec,
  facing: number,
  range: number,
  halfAngle: number,
  target: Vec,
  blockers: readonly Rect[],
): boolean {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d > range) return false;
  if (d > 1 && Math.abs(angleDiff(Math.atan2(dy, dx), facing)) > halfAngle) return false;
  return lineOfSight(origin, target, blockers);
}
