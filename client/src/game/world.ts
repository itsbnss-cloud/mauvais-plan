// Décor statique dessiné une fois puis converti en texture.
import Phaser from 'phaser';
import { WORLD_H, WORLD_W } from '../../../shared/constants';
import type { Rect } from '../../../shared/geometry';
import { DOORS, FURNITURE, HOUSE, JAIL, ROOMS, TRUCK_ZONE, WALL, WALLS, type Furniture, type Room } from '../../../shared/map';
import { OUTLINE, roundBox } from './art';

type G = Phaser.GameObjects.Graphics;

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shadow(g: G, r: Rect, radius = 6, dx = 4, dy = 6) {
  g.fillStyle(0x000000, 0.2);
  g.fillRoundedRect(r.x + dx, r.y + dy, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2));
}

function drawGarden(g: G) {
  const rand = rng(7);
  g.fillStyle(0x8fd16a);
  g.fillRect(0, 0, WORLD_W, WORLD_H);
  // Bandes de tonte.
  g.fillStyle(0x86c862);
  for (let x = 0; x < HOUSE.left; x += 48) g.fillRect(x, 0, 24, WORLD_H);
  // Touffes.
  for (let i = 0; i < 260; i++) {
    const x = rand() * HOUSE.left;
    const y = rand() * WORLD_H;
    g.lineStyle(2, rand() > 0.5 ? 0x6fb04d : 0xa4e07e, 0.9);
    g.lineBetween(x, y, x - 2, y - 5);
    g.lineBetween(x, y, x + 2, y - 5);
  }
  // Haie le long des bords.
  for (let y = 0; y < WORLD_H; y += 22) {
    g.fillStyle(0x3f8a3c);
    g.fillCircle(2, y, 14);
    g.fillStyle(0x58a94d);
    g.fillCircle(0, y - 3, 9);
  }
  for (let x = 0; x < HOUSE.left + 10; x += 22) {
    g.fillStyle(0x3f8a3c);
    g.fillCircle(x, 2, 14);
    g.fillStyle(0x58a94d);
    g.fillCircle(x - 3, 0, 9);
  }
  // Chemin de pierres du camion vers les portes.
  const stones: [number, number][] = [];
  for (let y = 560; y > 230; y -= 26) stones.push([300 + Math.sin(y / 40) * 6, y]);
  for (let x = 300; x < 336; x += 24) stones.push([x, 470], [x, 200]);
  for (const [x, y] of stones) {
    g.fillStyle(0x000000, 0.12);
    g.fillEllipse(x + 2, y + 3, 26, 16);
    g.fillStyle(0xe2d6c0);
    g.fillEllipse(x, y, 24, 15);
    g.fillStyle(0xf1e8d6);
    g.fillEllipse(x - 3, y - 2, 12, 6);
  }
  // Massifs de fleurs le long de la façade.
  const flowers = [0xff7aa8, 0xffd34d, 0xffffff, 0xb08cff];
  for (const [fx, fy] of [[322, 60], [322, 290], [322, 640], [230, 270], [140, 470]]) {
    g.fillStyle(0x4f9e48);
    g.fillEllipse(fx, fy, 30, 38);
    for (let i = 0; i < 7; i++) {
      g.fillStyle(flowers[Math.floor(rand() * flowers.length)]);
      g.fillCircle(fx - 9 + rand() * 18, fy - 13 + rand() * 26, 3);
    }
  }
  // Tapis devant les portes extérieures.
  for (const d of DOORS.filter((dd) => dd.exterior)) {
    const cy = d.rect.y + d.rect.h / 2;
    roundBox(g, HOUSE.left - 40, cy - 22, 22, 44, 4, 0xb5523b, 1.5);
    g.fillStyle(0xd98a5f);
    g.fillRect(HOUSE.left - 36, cy - 18, 14, 36);
  }
}

function drawFloor(g: G, room: Room) {
  const { x, y, w, h } = room.rect;
  const rand = rng(Math.floor(x + y));
  switch (room.floor) {
    case 'tiles': {
      const s = 32;
      for (let ty = y; ty < y + h; ty += s)
        for (let tx = x; tx < x + w; tx += s) {
          g.fillStyle(((tx - x) / s + (ty - y) / s) % 2 === 0 ? 0xf6eddc : 0xe0d1b6);
          g.fillRect(tx, ty, Math.min(s, x + w - tx), Math.min(s, y + h - ty));
        }
      break;
    }
    case 'wood': {
      const ph = 18;
      for (let py = y, row = 0; py < y + h; py += ph, row++) {
        g.fillStyle(row % 2 ? 0xd59c5f : 0xcb9154);
        g.fillRect(x, py, w, ph);
        g.lineStyle(1.5, 0xa8743f, 0.8);
        g.lineBetween(x, py, x + w, py);
        let jx = x + rand() * 90;
        while (jx < x + w) {
          g.lineBetween(jx, py, jx, py + ph);
          jx += 90 + rand() * 60;
        }
      }
      break;
    }
    case 'carpet': {
      g.fillStyle(0xbba7de);
      g.fillRect(x, y, w, h);
      g.fillStyle(0xc9b8e8);
      for (let ty = y + 8; ty < y + h; ty += 16) for (let tx = x + ((ty / 16) % 2) * 8 + 4; tx < x + w; tx += 16) g.fillCircle(tx, ty, 1.6);
      break;
    }
    case 'parquet': {
      const s = 28;
      for (let ty = y, r = 0; ty < y + h; ty += s, r++)
        for (let tx = x, c = 0; tx < x + w; tx += s, c++) {
          const cw = Math.min(s, x + w - tx);
          const ch = Math.min(s, y + h - ty);
          g.fillStyle((r + c) % 2 ? 0xbf8c58 : 0xb27e4b);
          g.fillRect(tx, ty, cw, ch);
          g.lineStyle(1, 0x95663a, 0.7);
          if ((r + c) % 2) for (let k = 7; k < cw; k += 7) g.lineBetween(tx + k, ty, tx + k, ty + ch);
          else for (let k = 7; k < ch; k += 7) g.lineBetween(tx, ty + k, tx + cw, ty + k);
        }
      break;
    }
  }
}

function drawFurniture(g: G, f: Furniture) {
  const { x, y, w, h } = f.rect;
  switch (f.kind) {
    case 'rug': {
      if (f.variant === 1) {
        g.fillStyle(0x6f93cf);
        g.fillEllipse(x + w / 2, y + h / 2, w, h);
        g.fillStyle(0x8fb3e0);
        g.fillEllipse(x + w / 2, y + h / 2, w - 16, h - 14);
        g.lineStyle(2, 0xffffff, 0.5);
        g.strokeEllipse(x + w / 2, y + h / 2, w - 34, h - 30);
      } else {
        roundBox(g, x, y, w, h, 6, 0xc9533f, 0);
        g.fillStyle(0xe0784f);
        g.fillRoundedRect(x + 8, y + 8, w - 16, h - 16, 4);
        g.lineStyle(2, 0xffd08a, 0.8);
        g.strokeRoundedRect(x + 16, y + 16, w - 32, h - 32, 3);
        g.fillStyle(0xffd08a, 0.8);
        for (let i = 0; i < 4; i++) g.fillCircle(x + w / 2 - 30 + i * 20, y + h / 2, 4);
      }
      return;
    }
    case 'counter': {
      shadow(g, f.rect, 3);
      roundBox(g, x, y, w, h, 3, 0xe9e2d4);
      g.fillStyle(0xd7cdb8);
      g.fillRect(x, y + h - 8, w, 8);
      // Évier
      roundBox(g, x + 20, y + 8, 46, 26, 6, 0xb9c4d0, 1.5);
      g.fillStyle(0x9aa7b6);
      g.fillRoundedRect(x + 25, y + 13, 36, 16, 4);
      g.fillStyle(0x7b8797);
      g.fillCircle(x + 43, y + 4, 3);
      // Plaques
      roundBox(g, x + 120, y + 6, 60, 30, 3, 0x2f2b3a, 1.5);
      g.lineStyle(2, 0x6b6478);
      for (const [px, py] of [[x + 135, y + 14], [x + 165, y + 14], [x + 135, y + 28], [x + 165, y + 28]]) g.strokeCircle(px, py, 5.5);
      g.lineStyle(2, 0xff6b4a);
      g.strokeCircle(x + 165, y + 28, 5.5);
      // Planche et fruits
      roundBox(g, x + 200, y + 10, 26, 18, 3, 0xc7925a, 1.2);
      g.fillStyle(0xff5a5a);
      g.fillCircle(x + 90, y + 18, 5);
      g.fillStyle(0xffd34d);
      g.fillCircle(x + 100, y + 22, 5);
      return;
    }
    case 'fridge': {
      shadow(g, f.rect);
      roundBox(g, x, y, w, h, 5, 0xdfe8ef);
      g.fillStyle(0xc6d2dc);
      g.fillRect(x, y + h * 0.38, w, 3);
      g.fillStyle(0x9aa7b6);
      g.fillRoundedRect(x + w - 10, y + 8, 4, 12, 2);
      g.fillRoundedRect(x + w - 10, y + h * 0.5, 4, 16, 2);
      g.fillStyle(0xff7aa8);
      g.fillCircle(x + 12, y + 32, 3);
      g.fillStyle(0x5ab0ff);
      g.fillCircle(x + 20, y + 40, 3);
      g.fillStyle(0xffffff);
      g.fillRect(x + 9, y + 42, 12, 9);
      return;
    }
    case 'dining': {
      const chairs: [number, number][] = [
        [x + 22, y - 16], [x + w - 46, y - 16], [x + 22, y + h - 8], [x + w - 46, y + h - 8],
      ];
      for (const [cx, cy] of chairs) {
        shadow(g, { x: cx, y: cy, w: 24, h: 24 }, 5, 2, 3);
        roundBox(g, cx, cy, 24, 24, 6, 0x9c6435);
        g.fillStyle(0xb47a46);
        g.fillRoundedRect(cx + 3, cy + 3, 18, 18, 4);
      }
      shadow(g, f.rect, 10);
      roundBox(g, x, y, w, h, 10, 0xb07840);
      g.fillStyle(0xc28c52);
      g.fillRoundedRect(x + 6, y + 6, w - 12, h - 12, 7);
      g.fillStyle(0xffffff);
      for (const [px, py] of [[x + 34, y + 20], [x + w - 34, y + 20], [x + 34, y + h - 20], [x + w - 34, y + h - 20]]) {
        g.fillCircle(px, py, 10);
        g.lineStyle(1.5, 0xd8d2c6);
        g.strokeCircle(px, py, 6);
      }
      g.fillStyle(0xff8a3c);
      g.fillCircle(x + w / 2, y + h / 2, 8);
      g.fillStyle(0x4f9e48);
      g.fillCircle(x + w / 2 + 6, y + h / 2 - 6, 4);
      return;
    }
    case 'plant': {
      shadow(g, f.rect, 15, 3, 4);
      blob(g, x + w / 2, y + h / 2, w / 2 - 3, 0xc8643c);
      const cx = x + w / 2;
      const cy = y + h / 2;
      g.fillStyle(0x3f8a3c);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.fillEllipse(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, 14, 14);
      }
      g.fillStyle(0x6cbf5f);
      g.fillCircle(cx - 2, cy - 2, 7);
      return;
    }
    case 'tree': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      g.fillStyle(0x000000, 0.2);
      g.fillEllipse(cx + 8, cy + 10, w + 10, h);
      g.fillStyle(OUTLINE);
      g.fillCircle(cx, cy, w / 2 + 2);
      const greens = f.variant ? [0x3d8a52, 0x56a86a] : [0x3f8a3c, 0x5aae4c];
      g.fillStyle(greens[0]);
      g.fillCircle(cx, cy, w / 2);
      g.fillStyle(greens[1]);
      g.fillCircle(cx - 8, cy - 8, w / 3);
      g.fillCircle(cx + 9, cy - 2, w / 4);
      g.fillStyle(0xffffff, 0.15);
      g.fillCircle(cx - 12, cy - 12, w / 6);
      if (!f.variant) {
        g.fillStyle(0xff5a5a);
        for (const [ax, ay] of [[cx + 6, cy + 10], [cx - 10, cy + 4], [cx + 12, cy - 10]]) g.fillCircle(ax, ay, 3.5);
      }
      return;
    }
    case 'tv': {
      shadow(g, f.rect, 3);
      roundBox(g, x, y, w, h, 3, 0x5a3a28);
      g.fillStyle(0x6e4a33);
      g.fillRect(x + 4, y + 4, w - 8, h - 8);
      roundBox(g, x + 10, y + h - 12, w - 20, 8, 2, 0x1d1b26, 2);
      g.fillStyle(0x5ab0ff, 0.9);
      g.fillRect(x + 12, y + h - 6, w - 24, 2);
      g.fillStyle(0x4fd18b);
      g.fillCircle(x + 8, y + 9, 2.5);
      // Rayons de l'écran allumé.
      g.fillStyle(0x7fd3ff, 0.12);
      g.fillTriangle(x + 14, y + h, x + w - 14, y + h, x + w / 2, y + h + 60);
      return;
    }
    case 'coffeeTable': {
      shadow(g, f.rect, 8);
      roundBox(g, x, y, w, h, 8, 0x8a5a33);
      g.fillStyle(0xa36d40);
      g.fillRoundedRect(x + 5, y + 5, w - 10, h - 10, 5);
      g.fillStyle(0xffffff);
      g.fillRect(x + 12, y + 12, 22, 16);
      g.fillStyle(0xff7aa8);
      g.fillRect(x + 14, y + 14, 18, 5);
      blob(g, x + w - 18, y + h / 2, 6, 0xffffff, 1.5);
      g.fillStyle(0x7a4a2a);
      g.fillCircle(x + w - 18, y + h / 2, 3.5);
      return;
    }
    case 'sofa':
    case 'armchair': {
      const main = f.kind === 'sofa' ? 0x4a90c2 : 0xe0a43a;
      const dark = f.kind === 'sofa' ? 0x356f99 : 0xb98126;
      const light = f.kind === 'sofa' ? 0x6aaad6 : 0xf0bf5e;
      shadow(g, f.rect, 10);
      roundBox(g, x, y, w, h, 10, dark);
      // Dossier en bas (le canapé fait face à la télé), accoudoirs.
      g.fillStyle(main);
      g.fillRoundedRect(x + 2, y + h - 18, w - 4, 16, 8);
      g.fillRoundedRect(x + 2, y + 2, 12, h - 4, 6);
      g.fillRoundedRect(x + w - 14, y + 2, 12, h - 4, 6);
      const n = f.kind === 'sofa' ? 3 : 1;
      const cw = (w - 32) / n;
      for (let i = 0; i < n; i++) {
        g.fillStyle(light);
        g.fillRoundedRect(x + 16 + i * cw + 1, y + 6, cw - 2, h - 26, 6);
      }
      if (f.kind === 'sofa') {
        g.fillStyle(0xffd34d);
        g.fillRoundedRect(x + 22, y + 10, 18, 14, 4);
      }
      return;
    }
    case 'bed': {
      shadow(g, f.rect, 8);
      roundBox(g, x, y, w, h, 8, 0x8a5a3c);
      g.fillStyle(0xfaf6ee);
      g.fillRoundedRect(x + 6, y + 6, w - 12, h - 12, 6);
      roundBox(g, x + 14, y + 12, 46, 26, 9, 0xffffff, 1.5);
      roundBox(g, x + w - 60, y + 12, 46, 26, 9, 0xffffff, 1.5);
      g.fillStyle(0xe36f8f);
      g.fillRoundedRect(x + 6, y + 52, w - 12, h - 58, 6);
      g.fillStyle(0xf28aa6);
      g.fillRoundedRect(x + 6, y + 52, w - 12, 14, 6);
      g.fillStyle(0xffffff, 0.35);
      for (let i = 0; i < 4; i++) g.fillCircle(x + 26 + i * 28, y + 100, 6);
      return;
    }
    case 'nightstand': {
      shadow(g, f.rect, 4);
      roundBox(g, x, y, w, h, 4, 0x9b6a43);
      g.fillStyle(0xfff3a0, 0.35);
      g.fillCircle(x + w / 2, y + h / 2, 16);
      blob(g, x + w / 2, y + h / 2, 8, 0xffe9a8, 1.5);
      return;
    }
    case 'wardrobe':
    case 'dresser': {
      shadow(g, f.rect, 4);
      roundBox(g, x, y, w, h, 4, 0x9b6a43);
      g.fillStyle(0xaf7c51);
      g.fillRect(x + 4, y + 4, w - 8, h - 8);
      g.lineStyle(2, 0x7b5032);
      if (f.kind === 'wardrobe') {
        g.lineBetween(x + w / 2, y + 4, x + w / 2, y + h - 4);
        g.fillStyle(0xffd34d);
        g.fillCircle(x + w / 2 - 5, y + h / 2, 2.5);
        g.fillCircle(x + w / 2 + 5, y + h / 2, 2.5);
      } else {
        g.lineBetween(x + w / 3, y + 4, x + w / 3, y + h - 4);
        g.lineBetween(x + (2 * w) / 3, y + 4, x + (2 * w) / 3, y + h - 4);
        g.fillStyle(0xff7aa8);
        g.fillCircle(x + 16, y + h / 2, 5);
        g.fillStyle(0x7fd3ff);
        g.fillRect(x + w - 26, y + 10, 14, 18);
      }
      return;
    }
    case 'desk': {
      // Fauteuil de bureau
      blob(g, x - 22, y + h / 2, 13, 0x3a3450);
      g.fillStyle(0x4d4668);
      g.fillCircle(x - 24, y + h / 2, 8);
      shadow(g, f.rect, 4);
      roundBox(g, x, y, w, h, 4, 0xa0714a);
      g.fillStyle(0xb5845a);
      g.fillRect(x + 4, y + 4, w - 8, h - 8);
      // Écran tourné vers le fauteuil
      roundBox(g, x + w - 20, y + h / 2 - 34, 10, 68, 3, 0x1d1b26, 2);
      g.fillStyle(0x5ab0ff);
      g.fillRect(x + w - 22, y + h / 2 - 30, 2, 60);
      g.fillStyle(0x7fd3ff, 0.15);
      g.fillTriangle(x + w - 22, y + h / 2 - 30, x + w - 22, y + h / 2 + 30, x + 10, y + h / 2);
      roundBox(g, x + 22, y + h / 2 - 26, 14, 52, 2, 0xe1e5ee, 1.5);
      blob(g, x + 26, y + h / 2 + 40, 3.5, 0xe1e5ee, 1.2);
      g.fillStyle(0xffffff);
      g.fillRect(x + 8, y + 10, 26, 32);
      g.lineStyle(1, 0xb8bfce);
      for (let k = 16; k < 40; k += 5) g.lineBetween(x + 11, y + k, x + 30, y + k);
      blob(g, x + 18, y + h - 22, 6, 0xff7aa8, 1.5);
      return;
    }
    case 'bookshelf': {
      shadow(g, f.rect, 3);
      roundBox(g, x, y, w, h, 3, 0x7b5032);
      const colors = [0xe36f8f, 0x5ab0ff, 0xffd34d, 0x4fd18b, 0xb08cff, 0xff8a3c];
      let bx = x + 4;
      let i = 0;
      while (bx < x + w - 8) {
        const bw = 7 + ((i * 5) % 6);
        g.fillStyle(colors[i % colors.length]);
        g.fillRect(bx, y + 4, bw, h - 8);
        bx += bw + 2;
        i++;
      }
      return;
    }
    default:
      return;
  }
}

function blob(g: G, x: number, y: number, r: number, fill: number, lw = 2) {
  g.fillStyle(OUTLINE);
  g.fillCircle(x, y, r + lw);
  g.fillStyle(fill);
  g.fillCircle(x, y, r);
}

function drawWalls(g: G, walls: Rect[], fill: number, top: number) {
  for (const w of walls) {
    g.fillStyle(0x000000, 0.22);
    g.fillRect(w.x + 5, w.y + 6, w.w, w.h);
  }
  for (const w of walls) {
    g.fillStyle(OUTLINE);
    g.fillRect(w.x - 1.5, w.y - 1.5, w.w + 3, w.h + 3);
  }
  for (const w of walls) {
    g.fillStyle(fill);
    g.fillRect(w.x, w.y, w.w, w.h);
    g.fillStyle(top);
    g.fillRect(w.x + 2, w.y + 2, Math.max(0, w.w - 4), Math.max(0, w.h - 4));
  }
}

function drawJail(g: G) {
  const o = JAIL.outer;
  // Plancher du cabanon.
  g.fillStyle(0xa8794c);
  g.fillRect(o.x, o.y, o.w, o.h);
  g.lineStyle(1.5, 0x8a5f37);
  for (let y = o.y + 14; y < o.y + o.h; y += 14) g.lineBetween(o.x, y, o.x + o.w, y);
  // Botte de paille et seau, pour l'ambiance.
  roundBox(g, o.x + 24, o.y + 24, 34, 22, 4, 0xe8c45a, 1.5);
  g.lineStyle(1, 0xc49a30);
  for (let k = 0; k < 4; k++) g.lineBetween(o.x + 28 + k * 8, o.y + 26, o.x + 28 + k * 8, o.y + 44);
  blob(g, o.x + o.w - 34, o.y + 34, 8, 0x9aa3b5, 1.5);
  drawWalls(g, JAIL.walls, 0x6b4528, 0x7f5634);
  // Porte à barreaux sur le mur du bas.
  const dx = JAIL.lock.x - 22;
  const dy = o.y + o.h - WALL;
  g.fillStyle(0x4a3020);
  g.fillRect(dx, dy, 44, WALL);
  g.lineStyle(3, 0xb8bfce);
  for (let k = 4; k < 44; k += 8) g.lineBetween(dx + k, dy, dx + k, dy + WALL);
}

function drawTruckZone(g: G) {
  const z = TRUCK_ZONE;
  g.fillStyle(0xffd84a, 0.16);
  g.fillRect(z.x, z.y, z.w, z.h);
  g.lineStyle(3, 0xffd84a, 0.9);
  const dash = 12;
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    for (let t = 0; t < len; t += dash * 2) {
      const a = t / len;
      const b = Math.min(1, (t + dash) / len);
      g.lineBetween(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a, x1 + (x2 - x1) * b, y1 + (y2 - y1) * b);
    }
  };
  edge(z.x, z.y, z.x + z.w, z.y);
  edge(z.x + z.w, z.y, z.x + z.w, z.y + z.h);
  edge(z.x + z.w, z.y + z.h, z.x, z.y + z.h);
  edge(z.x, z.y + z.h, z.x, z.y);
  // Flèches vers le camion.
  g.fillStyle(0xffd84a, 0.55);
  for (const yy of [z.y + 40, z.y + 96]) g.fillTriangle(z.x + 20, yy, z.x + 40, yy - 12, z.x + 40, yy + 12);
}

function drawWindows(g: G) {
  const win = (x: number, y: number, w: number, h: number) => {
    g.fillStyle(0xbfe6ff);
    g.fillRect(x, y, w, h);
    g.fillStyle(0xffffff, 0.8);
    if (w > h) g.fillRect(x, y + h / 2 - 1, w, 2);
    else g.fillRect(x + w / 2 - 1, y, 2, h);
  };
  const t = WALL - 8;
  for (const x of [420, 680, 900, 1120]) win(x, HOUSE.top - t / 2, 60, t);
  for (const x of [400, 1000]) win(x, HOUSE.bottom - t / 2, 60, t);
  for (const y of [100, 450, 600]) win(HOUSE.right - t / 2, y, t, 60);
  win(HOUSE.left - t / 2, 290, t, 40);
  win(HOUSE.left - t / 2, 590, t, 60);
}

function drawDoors(g: G) {
  for (const d of DOORS) {
    const r = d.rect;
    g.fillStyle(0xb0763e);
    g.fillRect(r.x, r.y, r.w, r.h);
    g.lineStyle(1.5, 0x8a5a2e);
    if (d.vertical) for (let y = r.y + 8; y < r.y + r.h; y += 8) g.lineBetween(r.x, y, r.x + r.w, y);
    else for (let x = r.x + 8; x < r.x + r.w; x += 8) g.lineBetween(x, r.y, x, r.y + r.h);
  }
}

/** Dessine tout le décor fixe dans une seule texture. */
export function makeWorldTexture(scene: Phaser.Scene) {
  if (scene.textures.exists('world')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  drawGarden(g);
  drawTruckZone(g);
  drawJail(g);
  // Ombre portée de la maison sur la pelouse.
  g.fillStyle(0x000000, 0.18);
  g.fillRect(HOUSE.left + 6, HOUSE.top + 8, HOUSE.right - HOUSE.left, HOUSE.bottom - HOUSE.top);
  for (const room of ROOMS) drawFloor(g, room);
  drawDoors(g);
  for (const f of FURNITURE) if (f.kind === 'rug') drawFurniture(g, f);
  for (const f of FURNITURE) if (f.kind !== 'rug' && f.kind !== 'truck') drawFurniture(g, f);
  drawWalls(g, WALLS, 0x46395e, 0x5d4c7a);
  drawWindows(g);
  g.generateTexture('world', WORLD_W, WORLD_H);
  g.destroy();
}
