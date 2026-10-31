// Textures générées avec les outils graphiques de Phaser : aucun fichier externe.
import Phaser from 'phaser';
import { ITEM_BY_ID } from '../../../shared/map';

export const OUTLINE = 0x2a1f3d;
const SKIN = 0xf2c4a0;
const SKIN_DARK = 0xd99e78;
const GLOVE = 0x2b2638;
const SWEATER = 0x3a3450;
const BAG = 0xc99a5b;
const BAG_DARK = 0x93683a;

export interface Palette {
  main: number;
  dark: number;
  light: number;
  css: string;
}

export const PALETTES: Palette[] = [
  { main: 0x8b5cf6, dark: 0x5b34c4, light: 0xc9b6ff, css: '#8b5cf6' },
  { main: 0xf97316, dark: 0xc2410c, light: 0xffc48f, css: '#f97316' },
];

export type Facing = 'down' | 'up' | 'side';
type G = Phaser.GameObjects.Graphics;

export const CHAR_W = 48;
export const CHAR_H = 58;

export function charKey(who: 'p0' | 'p1' | 'guard', dir: Facing, frame: number, carry = false) {
  return `${who}_${dir}_${frame}${carry ? '_c' : ''}`;
}

function blob(g: G, x: number, y: number, r: number, fill: number, lw = 2) {
  g.fillStyle(OUTLINE);
  g.fillCircle(x, y, r + lw);
  g.fillStyle(fill);
  g.fillCircle(x, y, r);
}

export function roundBox(g: G, x: number, y: number, w: number, h: number, r: number, fill: number, lw = 2, alpha = 1) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (lw > 0) {
    g.fillStyle(OUTLINE, alpha);
    g.fillRoundedRect(x - lw, y - lw, w + lw * 2, h + lw * 2, rr + lw);
  }
  g.fillStyle(fill, alpha);
  if (rr > 0) g.fillRoundedRect(x, y, w, h, rr);
  else g.fillRect(x, y, w, h);
}

/** Pieds, corps et mains communs au cambrioleur et au gardien. */
function drawLegsAndBody(g: G, dir: Facing, frame: number, bodyColor: number, beltColor: number) {
  const cx = 24;
  const step = frame === 0 ? 0 : frame === 1 ? 1 : -1;
  g.fillStyle(0x231d30);
  if (dir === 'side') {
    g.fillEllipse(cx - 3 + step * 4, 51, 10, 6);
    g.fillEllipse(cx + 3 - step * 4, 51, 10, 6);
  } else {
    g.fillEllipse(cx - 6, 51 - step * 1.5, 8, 7);
    g.fillEllipse(cx + 6, 51 + step * 1.5, 8, 7);
  }
  roundBox(g, cx - 9, 31, 18, 18, 7, bodyColor, 1.8);
  g.fillStyle(beltColor);
  g.fillRect(cx - 9, 42, 18, 3);
}

function drawHands(g: G, dir: Facing, frame: number, carry: boolean, glove: number) {
  const cx = 24;
  const swing = frame === 0 ? 0 : frame === 1 ? 2.5 : -2.5;
  if (carry) {
    blob(g, cx - 13, 22, 3.4, glove, 1.6);
    blob(g, cx + 13, 22, 3.4, glove, 1.6);
  } else if (dir === 'side') {
    blob(g, cx + 2 + swing * 1.5, 41, 3.4, glove, 1.6);
  } else {
    blob(g, cx - 12, 40 + swing, 3.4, glove, 1.6);
    blob(g, cx + 12, 40 - swing, 3.4, glove, 1.6);
  }
}

function drawThief(g: G, pal: Palette, dir: Facing, frame: number, carry: boolean) {
  const cx = 24;
  const hy = 21;
  // Sac de côté (derrière le corps).
  if (dir === 'side') {
    blob(g, cx - 10, 38, 8.5, BAG, 1.8);
    g.fillStyle(BAG_DARK);
    g.fillCircle(cx - 10, 31, 2.5);
  }
  drawLegsAndBody(g, dir, frame, SWEATER, pal.main);
  if (dir === 'down') {
    g.fillStyle(BAG_DARK);
    g.fillRect(cx - 7, 32, 3, 9);
    g.fillRect(cx + 4, 32, 3, 9);
  }
  if (dir === 'up') {
    // Gros sac sur le dos.
    blob(g, cx, 40, 11, BAG, 2);
    g.fillStyle(BAG_DARK);
    g.fillEllipse(cx, 30, 9, 4);
    g.fillStyle(0xe7c38d);
    g.fillEllipse(cx - 4, 37, 6, 4);
    g.lineStyle(1.5, BAG_DARK);
    g.strokeRect(cx + 1, 41, 6, 5);
  }
  drawHands(g, dir, frame, carry, GLOVE);

  // Tête cagoulée.
  blob(g, cx, hy, 15, pal.dark, 2.2);
  g.fillStyle(pal.main);
  g.fillCircle(cx - 1.5, hy - 1.5, 13.2);
  g.fillStyle(pal.light, 0.75);
  g.fillEllipse(cx - 6, hy - 8, 9, 5);
  blob(g, cx, hy - 15.5, 3.6, pal.light, 1.8);

  if (dir === 'down') {
    roundBox(g, cx - 11, hy - 5, 22, 10, 5, SKIN, 1.6);
    g.fillStyle(OUTLINE);
    g.fillEllipse(cx - 5, hy, 4.4, 5.4);
    g.fillEllipse(cx + 5, hy, 4.4, 5.4);
    g.fillStyle(0xffffff);
    g.fillCircle(cx - 4.2, hy - 1.2, 1.1);
    g.fillCircle(cx + 5.8, hy - 1.2, 1.1);
    // Sourcils malicieux.
    g.lineStyle(1.8, OUTLINE);
    g.lineBetween(cx - 8, hy - 6.5, cx - 3, hy - 5);
    g.lineBetween(cx + 8, hy - 6.5, cx + 3, hy - 5);
    roundBox(g, cx - 4, hy + 7, 8, 5, 2.5, SKIN, 1.4);
    g.lineStyle(1.2, OUTLINE);
    g.beginPath();
    g.arc(cx, hy + 8.5, 2.4, 0.2, Math.PI - 0.2);
    g.strokePath();
  } else if (dir === 'side') {
    roundBox(g, cx - 1, hy - 5, 15, 10, 5, SKIN, 1.6);
    g.fillStyle(OUTLINE);
    g.fillEllipse(cx + 8, hy, 4.4, 5.4);
    g.fillStyle(0xffffff);
    g.fillCircle(cx + 8.8, hy - 1.2, 1.1);
    g.lineStyle(1.8, OUTLINE);
    g.lineBetween(cx + 4, hy - 6.5, cx + 10, hy - 5.5);
    roundBox(g, cx + 6, hy + 7, 6, 4.5, 2, SKIN, 1.3);
  } else {
    g.lineStyle(1.4, pal.dark);
    for (let i = 0; i < 3; i++) g.lineBetween(cx - 9 + i, hy + 6 + i * 2.2, cx + 9 - i, hy + 6 + i * 2.2);
  }
}

function drawGuard(g: G, dir: Facing, frame: number) {
  const cx = 24;
  const hy = 21;
  const UNIFORM = 0x3557c8;
  const CAP = 0x1d2b5e;
  drawLegsAndBody(g, dir, frame, UNIFORM, 0x1b1b24);
  if (dir !== 'up') {
    g.fillStyle(0xffd34d);
    g.fillCircle(dir === 'side' ? cx + 4 : cx - 4, 36, 2.6);
  }
  // Lampe torche.
  const swing = frame === 0 ? 0 : frame === 1 ? 2 : -2;
  if (dir === 'down') {
    roundBox(g, cx + 9, 40 - swing, 5, 9, 1.5, 0x777c8c, 1.4);
    g.fillStyle(0xfff3a0);
    g.fillRect(cx + 9, 47 - swing, 5, 2);
  } else if (dir === 'side') {
    roundBox(g, cx + 4 + swing, 38, 10, 5, 1.5, 0x777c8c, 1.4);
    g.fillStyle(0xfff3a0);
    g.fillRect(cx + 12 + swing, 38, 2, 5);
  }
  drawHands(g, dir, frame, false, SKIN);

  blob(g, cx, hy, 15, dir === 'up' ? 0x6b4226 : SKIN, 2.2);
  if (dir !== 'up') {
    g.fillStyle(SKIN_DARK);
    g.fillEllipse(cx + 4, hy + 8, 14, 7);
    g.fillStyle(SKIN);
    g.fillCircle(cx - 1, hy + 2, 12.5);
  }
  // Casquette.
  g.fillStyle(CAP);
  g.beginPath();
  g.arc(cx, hy, 15.2, Math.PI, Math.PI * 2);
  g.closePath();
  g.fillPath();
  g.fillStyle(0x2c3f80);
  g.fillEllipse(cx - 4, hy - 9, 10, 4);
  if (dir === 'down') {
    g.fillStyle(0x121a3a);
    g.fillEllipse(cx, hy + 1, 30, 7);
    g.fillStyle(0xffd34d);
    g.fillCircle(cx, hy - 7, 2.4);
    g.fillStyle(OUTLINE);
    g.fillCircle(cx - 5, hy + 6, 2);
    g.fillCircle(cx + 5, hy + 6, 2);
    g.lineStyle(2, OUTLINE);
    g.lineBetween(cx - 8, hy + 2.8, cx - 2.5, hy + 3.8);
    g.lineBetween(cx + 8, hy + 2.8, cx + 2.5, hy + 3.8);
    g.fillStyle(0x5c3920);
    g.fillEllipse(cx - 4, hy + 11, 9, 4.5);
    g.fillEllipse(cx + 4, hy + 11, 9, 4.5);
    g.fillStyle(SKIN_DARK);
    g.fillCircle(cx, hy + 8.5, 2.6);
  } else if (dir === 'side') {
    g.fillStyle(0x121a3a);
    g.fillEllipse(cx + 11, hy + 1, 14, 6);
    g.fillStyle(OUTLINE);
    g.fillCircle(cx + 7, hy + 6, 2);
    g.fillStyle(SKIN_DARK);
    g.fillCircle(cx + 13.5, hy + 8, 3);
    g.fillStyle(0x5c3920);
    g.fillEllipse(cx + 9, hy + 11.5, 10, 4.5);
  }
}

function drawItem(g: G, id: string, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  switch (id) {
    case 'toaster': {
      roundBox(g, cx - 13, cy - 8, 26, 18, 6, 0xf4c542);
      g.fillStyle(0xfff0a8);
      g.fillRoundedRect(cx - 10, cy - 6, 8, 4, 2);
      g.fillStyle(OUTLINE);
      g.fillRoundedRect(cx - 9, cy - 3, 18, 3, 1.5);
      g.fillRoundedRect(cx - 9, cy + 2, 18, 3, 1.5);
      g.fillStyle(0xd9a720);
      g.fillRect(cx + 13, cy - 2, 3, 6);
      // Tranche de pain qui dépasse.
      roundBox(g, cx - 6, cy - 15, 12, 8, 3, 0xe8b46a, 1.5);
      break;
    }
    case 'console': {
      roundBox(g, cx - 15, cy - 8, 30, 17, 8, 0x3b3f58);
      g.fillStyle(0x2a2d40);
      g.fillCircle(cx - 9, cy + 6, 5);
      g.fillCircle(cx + 9, cy + 6, 5);
      g.fillStyle(0xd7dbe8);
      g.fillRect(cx - 11, cy - 2, 6, 2);
      g.fillRect(cx - 9, cy - 4, 2, 6);
      g.fillStyle(0xff5a7a);
      g.fillCircle(cx + 9, cy - 3, 2);
      g.fillStyle(0x4fd18b);
      g.fillCircle(cx + 12, cy, 2);
      g.fillStyle(0x5ab0ff);
      g.fillCircle(cx + 6, cy, 2);
      g.fillStyle(0xffd34d);
      g.fillCircle(cx + 9, cy + 3, 2);
      break;
    }
    case 'necklace': {
      g.lineStyle(2, OUTLINE);
      g.strokeEllipse(cx, cy - 2, 26, 22);
      for (let i = 0; i < 14; i++) {
        const a = Math.PI * 0.1 + (i / 13) * Math.PI * 0.8;
        blob(g, cx + Math.cos(a) * 13, cy - 2 + Math.sin(a) * 11, 2.6, 0xfdf8f0, 1.2);
      }
      blob(g, cx, cy + 12, 4.5, 0xff6fa8, 1.6);
      g.fillStyle(0xffffff);
      g.fillCircle(cx - 1.5, cy + 10.5, 1.4);
      break;
    }
    case 'laptop': {
      roundBox(g, cx - 14, cy - 13, 28, 16, 3, 0x9aa3b5);
      g.fillStyle(0x2b4a8a);
      g.fillRect(cx - 12, cy - 11, 24, 12);
      g.fillStyle(0x7fd3ff, 0.8);
      g.fillRect(cx - 10, cy - 9, 9, 2);
      g.fillRect(cx - 10, cy - 5, 14, 2);
      roundBox(g, cx - 16, cy + 3, 32, 10, 3, 0xc9cfdb);
      g.fillStyle(0x9aa3b5);
      for (let i = 0; i < 6; i++) g.fillRect(cx - 13 + i * 4.6, cy + 5, 3, 2);
      g.fillRect(cx - 5, cy + 9, 10, 2);
      break;
    }
    case 'safe': {
      const bw = 52;
      const bh = 46;
      const x = cx - bw / 2;
      const y = cy - bh / 2;
      roundBox(g, x, y, bw, bh, 6, 0x4d5566, 2.5);
      g.fillStyle(0x7c879c);
      g.fillRoundedRect(x, y, bw, 9, { tl: 6, tr: 6, bl: 0, br: 0 });
      roundBox(g, x + 6, y + 13, bw - 12, bh - 18, 4, 0x5f6a7e, 1.5);
      blob(g, cx - 4, cy + 4, 8, 0xc9d1de, 1.5);
      g.fillStyle(0x4d5566);
      g.fillCircle(cx - 4, cy + 4, 3);
      g.lineStyle(1.4, 0x4d5566);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.lineBetween(cx - 4 + Math.cos(a) * 5, cy + 4 + Math.sin(a) * 5, cx - 4 + Math.cos(a) * 7.5, cy + 4 + Math.sin(a) * 7.5);
      }
      roundBox(g, cx + 10, cy - 2, 4, 14, 2, 0xffd34d, 1.4);
      g.fillStyle(0x2f3542);
      for (const [rx, ry] of [[x + 4, y + 13], [x + bw - 4, y + 13], [x + 4, y + bh - 4], [x + bw - 4, y + bh - 4]]) g.fillCircle(rx, ry, 1.8);
      break;
    }
    case 'clock': {
      const bw = 40;
      const bh = 56;
      const x = cx - bw / 2;
      const y = cy - bh / 2;
      roundBox(g, x, y + 4, bw, bh - 4, 5, 0x7a3f22, 2.5);
      roundBox(g, x + 4, y, bw - 8, 12, 6, 0xa35a33, 2);
      blob(g, cx, y + 20, 12, 0xfff4dc, 2);
      g.lineStyle(1.3, OUTLINE);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.lineBetween(cx + Math.cos(a) * 9, y + 20 + Math.sin(a) * 9, cx + Math.cos(a) * 11, y + 20 + Math.sin(a) * 11);
      }
      g.lineStyle(2, OUTLINE);
      g.lineBetween(cx, y + 20, cx, y + 12);
      g.lineBetween(cx, y + 20, cx + 6, y + 23);
      roundBox(g, cx - 8, y + 35, 16, 17, 4, 0x3a1f12, 1.5);
      g.lineStyle(1.5, 0xffd34d);
      g.lineBetween(cx, y + 36, cx + 2, y + 46);
      g.fillStyle(0xffd34d);
      g.fillCircle(cx + 2, y + 47, 3.2);
      break;
    }
  }
}

function drawTruck(g: G) {
  // Vue de dessus : cabine à gauche, plateau ouvert à droite.
  const W = 180;
  const H = 96;
  g.fillStyle(0x000000, 0.22);
  g.fillRoundedRect(6, 9, W, H, 16);
  g.fillStyle(0x1f1b29);
  for (const [x, y] of [[24, -2], [24, H - 6], [130, -2], [130, H - 6]]) g.fillRoundedRect(x, y, 28, 10, 4);
  roundBox(g, 2, 2, 60, H - 4, 14, 0x2bb3a3, 2.5);
  g.fillStyle(0x229486);
  g.fillRoundedRect(2, 2, 14, H - 4, { tl: 14, bl: 14, tr: 0, br: 0 });
  roundBox(g, 8, 12, 16, H - 24, 6, 0xbfe8ff, 2);
  g.fillStyle(0xffffff, 0.7);
  g.fillRect(12, 18, 3, 26);
  g.fillStyle(0xffe066);
  g.fillCircle(6, 14, 4);
  g.fillCircle(6, H - 14, 4);
  g.fillStyle(0x229486);
  g.fillRect(30, 10, 26, H - 20);
  g.fillStyle(0x2bb3a3);
  g.fillRect(32, 12, 22, H - 24);
  // Plateau.
  roundBox(g, 64, 2, W - 66, H - 4, 6, 0x6b4a33, 2.5);
  g.fillStyle(0x7d5a40);
  g.fillRect(70, 8, W - 78, H - 16);
  g.lineStyle(2, 0x5a3c28);
  for (let y = 16; y < H - 10; y += 12) g.lineBetween(72, y, W - 10, y);
  g.fillStyle(0x2bb3a3);
  g.fillRect(64, 2, W - 66, 6);
  g.fillRect(64, H - 8, W - 66, 6);
  g.fillStyle(0xff5a5a);
  g.fillRect(W - 6, 6, 4, 10);
  g.fillRect(W - 6, H - 16, 4, 10);
}

export function makeTextures(scene: Phaser.Scene) {
  if (scene.textures.exists('shadow')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const gen = (key: string, w: number, h: number, draw: (g: G) => void) => {
    g.clear();
    draw(g);
    g.generateTexture(key, w, h);
  };

  const dirs: Facing[] = ['down', 'up', 'side'];
  for (const dir of dirs) {
    for (let frame = 0; frame < 3; frame++) {
      PALETTES.forEach((pal, i) => {
        gen(charKey(`p${i}` as 'p0' | 'p1', dir, frame), CHAR_W, CHAR_H, (gg) => drawThief(gg, pal, dir, frame, false));
        gen(charKey(`p${i}` as 'p0' | 'p1', dir, frame, true), CHAR_W, CHAR_H, (gg) => drawThief(gg, pal, dir, frame, true));
      });
      gen(charKey('guard', dir, frame), CHAR_W, CHAR_H, (gg) => drawGuard(gg, dir, frame));
    }
  }

  for (const id of Object.keys(ITEM_BY_ID)) {
    const def = ITEM_BY_ID[id];
    const w = def.kind === 'big' ? def.w + 10 : 36;
    const h = def.kind === 'big' ? def.h + 10 : 36;
    gen(`item_${id}`, w, h, (gg) => drawItem(gg, id, w, h));
  }

  gen('shadow', 32, 14, (gg) => {
    gg.fillStyle(0x000000, 0.28);
    gg.fillEllipse(16, 7, 30, 12);
  });
  gen('glow', 48, 48, (gg) => {
    for (let r = 24; r > 0; r -= 3) {
      gg.fillStyle(0xfff3a0, 0.05);
      gg.fillCircle(24, 24, r);
    }
  });
  gen('spark', 16, 16, (gg) => {
    gg.fillStyle(0xffffff);
    gg.fillTriangle(8, 0, 10, 8, 6, 8);
    gg.fillTriangle(8, 16, 10, 8, 6, 8);
    gg.fillTriangle(0, 8, 8, 6, 8, 10);
    gg.fillTriangle(16, 8, 8, 6, 8, 10);
    gg.fillCircle(8, 8, 2.5);
  });
  gen('coin', 16, 16, (gg) => {
    blob(gg, 8, 8, 6, 0xffd34d, 1.5);
    gg.fillStyle(0xfff2a6);
    gg.fillCircle(6.5, 6.5, 2);
  });
  gen('puff', 24, 24, (gg) => {
    gg.fillStyle(0xffffff, 0.9);
    gg.fillCircle(12, 12, 10);
    gg.fillStyle(0xd9d3e6, 0.9);
    gg.fillCircle(15, 15, 6);
  });
  gen('truck', 186, 106, drawTruck);
  gen('cam', 30, 22, (gg) => {
    roundBox(gg, 2, 4, 20, 14, 4, 0xe9ecf3, 2);
    roundBox(gg, 20, 6, 7, 10, 2, 0x3a3f52, 1.5);
    gg.fillStyle(0x7fd3ff);
    gg.fillCircle(24, 9, 1.6);
    gg.fillStyle(0xb8bfce);
    gg.fillRect(4, 14, 16, 2);
  });
  gen('led', 8, 8, (gg) => {
    gg.fillStyle(0xffffff);
    gg.fillCircle(4, 4, 3);
  });
  for (const on of [true, false]) {
    gen(on ? 'switch_on' : 'switch_off', 22, 32, (gg) => {
      roundBox(gg, 3, 3, 16, 26, 3, 0x9aa3b5, 2);
      gg.fillStyle(0xffd34d);
      gg.fillTriangle(12, 6, 7, 15, 11, 15);
      gg.fillTriangle(10, 13, 15, 13, 10, 22);
      roundBox(gg, 8, on ? 21 : 18, 6, 6, 2, on ? 0x4fd18b : 0xff5a5a, 1.2);
    });
  }
  gen('lock', 22, 26, (gg) => {
    gg.lineStyle(3.5, OUTLINE);
    gg.beginPath();
    gg.arc(11, 11, 6, Math.PI, 0);
    gg.strokePath();
    gg.lineStyle(2, 0xb8bfce);
    gg.beginPath();
    gg.arc(11, 11, 6, Math.PI, 0);
    gg.strokePath();
    roundBox(gg, 3, 11, 16, 12, 3, 0xffc93c, 2);
    gg.fillStyle(OUTLINE);
    gg.fillCircle(11, 16, 2);
    gg.fillRect(10, 16, 2, 4);
  });
  gen('check', 20, 20, (gg) => {
    blob(gg, 10, 10, 8, 0x4fd18b, 1.8);
    gg.lineStyle(2.6, 0xffffff);
    gg.beginPath();
    gg.moveTo(6, 10);
    gg.lineTo(9, 13);
    gg.lineTo(14, 7);
    gg.strokePath();
  });
  g.destroy();
}
