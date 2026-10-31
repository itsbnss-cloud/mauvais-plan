// Grille de navigation et A* pour le gardien.
import { WORLD_H, WORLD_W } from '../shared/constants';
import { circleRectOverlap, type Rect, type Vec } from '../shared/geometry';

const CELL = 16;

export class NavGrid {
  readonly cols = Math.ceil(WORLD_W / CELL);
  readonly rows = Math.ceil(WORLD_H / CELL);
  private readonly blocked: Uint8Array;

  constructor(
    obstacles: readonly Rect[],
    private readonly radius: number,
  ) {
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cx = c * CELL + CELL / 2;
        const cy = r * CELL + CELL / 2;
        if (obstacles.some((o) => circleRectOverlap(cx, cy, radius + 1, o))) this.blocked[r * this.cols + c] = 1;
      }
    }
  }

  private cellOf(p: Vec): [number, number] {
    return [Math.min(this.cols - 1, Math.max(0, Math.floor(p.x / CELL))), Math.min(this.rows - 1, Math.max(0, Math.floor(p.y / CELL)))];
  }

  private center(c: number, r: number): Vec {
    return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
  }

  private dynamicMask(dynamic: readonly Rect[]): Set<number> {
    const set = new Set<number>();
    for (const o of dynamic) {
      const c0 = Math.max(0, Math.floor((o.x - this.radius) / CELL));
      const c1 = Math.min(this.cols - 1, Math.floor((o.x + o.w + this.radius) / CELL));
      const r0 = Math.max(0, Math.floor((o.y - this.radius) / CELL));
      const r1 = Math.min(this.rows - 1, Math.floor((o.y + o.h + this.radius) / CELL));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          const p = this.center(c, r);
          if (circleRectOverlap(p.x, p.y, this.radius + 1, o)) set.add(r * this.cols + c);
        }
    }
    return set;
  }

  isFree(p: Vec, dyn?: Set<number>): boolean {
    const [c, r] = this.cellOf(p);
    const i = r * this.cols + c;
    return !this.blocked[i] && !dyn?.has(i);
  }

  /** Cellule libre la plus proche (recherche en largeur). */
  private nearestFree(c: number, r: number, dyn: Set<number>): [number, number] | null {
    const seen = new Set<number>([r * this.cols + c]);
    const queue: [number, number][] = [[c, r]];
    while (queue.length) {
      const [qc, qr] = queue.shift()!;
      const i = qr * this.cols + qc;
      if (!this.blocked[i] && !dyn.has(i)) return [qc, qr];
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = qc + dc;
        const nr = qr + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const ni = nr * this.cols + nc;
        if (seen.has(ni)) continue;
        seen.add(ni);
        if (seen.size > 600) return null;
        queue.push([nc, nr]);
      }
    }
    return null;
  }

  /** Chemin lissé de `from` vers `to`, sans le point de départ. Vide si inaccessible. */
  findPath(from: Vec, to: Vec, dynamic: readonly Rect[] = []): Vec[] {
    const dyn = this.dynamicMask(dynamic);
    const [sc0, sr0] = this.cellOf(from);
    const [gc0, gr0] = this.cellOf(to);
    const start = this.nearestFree(sc0, sr0, dyn);
    const goal = this.nearestFree(gc0, gr0, dyn);
    if (!start || !goal) return [];
    const cols = this.cols;
    const si = start[1] * cols + start[0];
    const gi = goal[1] * cols + goal[0];
    const free = (c: number, r: number) =>
      c >= 0 && r >= 0 && c < cols && r < this.rows && !this.blocked[r * cols + c] && !dyn.has(r * cols + c);

    const g = new Float32Array(cols * this.rows).fill(Infinity);
    const came = new Int32Array(cols * this.rows).fill(-1);
    const closed = new Uint8Array(cols * this.rows);
    const heap = new MinHeap();
    const h = (i: number) => {
      const dx = Math.abs((i % cols) - goal[0]);
      const dy = Math.abs(Math.floor(i / cols) - goal[1]);
      return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    g[si] = 0;
    heap.push(si, h(si));
    let found = si === gi;
    while (heap.size && !found) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % cols;
      const cr = Math.floor(cur / cols);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dc && !dr) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (!free(nc, nr)) continue;
          // Pas de coupe de coin.
          if (dc && dr && (!free(cc + dc, cr) || !free(cc, cr + dr))) continue;
          const ni = nr * cols + nc;
          const cost = g[cur] + (dc && dr ? 1.4142 : 1);
          if (cost < g[ni]) {
            g[ni] = cost;
            came[ni] = cur;
            if (ni === gi) found = true;
            heap.push(ni, cost + h(ni));
          }
        }
    }
    if (!found) return [];

    const cells: number[] = [];
    for (let i = gi; i !== -1 && i !== si; i = came[i]) cells.push(i);
    cells.reverse();
    const raw = cells.map((i) => this.center(i % cols, Math.floor(i / cols)));
    if (this.isFree(to, dyn)) raw.push({ ...to });
    return this.smooth(from, raw, dyn);
  }

  private segmentFree(a: Vec, b: Vec, dyn: Set<number>): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.ceil(d / 6);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.isFree({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dyn)) return false;
    }
    return true;
  }

  private smooth(from: Vec, pts: Vec[], dyn: Set<number>): Vec[] {
    const out: Vec[] = [];
    let anchor = from;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.segmentFree(anchor, pts[j], dyn)) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
}

class MinHeap {
  private ids: number[] = [];
  private prio: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, p: number) {
    this.ids.push(id);
    this.prio.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastP = this.prio.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.prio[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.ids.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
