// Éléments communs à tous les niveaux : jardin, cabanon, camion, façade, objets.
// Chaque niveau (voir levels.ts) décrit l'intérieur de la maison.
import { PLAYER_RADIUS, WORLD_H, WORLD_W } from './constants';
import type { Rect, Vec } from './geometry';

/** Épaisseur des murs. */
export const WALL = 16;

// Contour de la maison, identique dans tous les niveaux.
export const HOUSE = { left: 340, right: 1260, top: 24, bottom: 684 };

export type Gap = [number, number];

export function hWall(x1: number, x2: number, y: number, gaps: Gap[] = []): Rect[] {
  return splitByGaps(x1, x2, gaps).map(([a, b]) => ({ x: a, y: y - WALL / 2, w: b - a, h: WALL }));
}

export function vWall(x: number, y1: number, y2: number, gaps: Gap[] = []): Rect[] {
  return splitByGaps(y1, y2, gaps).map(([a, b]) => ({ x: x - WALL / 2, y: a, w: WALL, h: b - a }));
}

function splitByGaps(a: number, b: number, gaps: Gap[]): Gap[] {
  const out: Gap[] = [];
  let cur = a;
  for (const [g1, g2] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g1 > cur) out.push([cur, g1]);
    cur = Math.max(cur, g2);
  }
  if (cur < b) out.push([cur, b]);
  return out;
}

/** Rectangle d'une ouverture dans un mur vertical (x) ou horizontal (y). */
export const vGapRect = (x: number, [a, b]: Gap): Rect => ({ x: x - WALL / 2, y: a, w: WALL, h: b - a });
export const hGapRect = (y: number, [a, b]: Gap): Rect => ({ x: a, y: y - WALL / 2, w: b - a, h: WALL });

const H = HOUSE;
const half = WALL / 2;

// Portes extérieures, côté jardin.
const KITCHEN_DOOR: Gap = [150, 250];
const FRONT_DOOR: Gap = [416, 528];

export const SHELL_WALLS: Rect[] = [
  ...hWall(H.left - half, H.right + half, H.top),
  ...hWall(H.left - half, H.right + half, H.bottom),
  ...vWall(H.left, H.top, H.bottom, [KITCHEN_DOOR, FRONT_DOOR]),
  ...vWall(H.right, H.top, H.bottom),
];

export interface Door {
  /** Rectangle de l'ouverture (dans l'épaisseur du mur). */
  rect: Rect;
  vertical: boolean;
  exterior: boolean;
}

export const EXTERIOR_DOORS: Door[] = [
  { rect: vGapRect(H.left, KITCHEN_DOOR), vertical: true, exterior: true },
  { rect: vGapRect(H.left, FRONT_DOOR), vertical: true, exterior: true },
];

export type FloorKind = 'tiles' | 'wood' | 'carpet' | 'parquet' | 'marble' | 'velvet' | 'steel';

export interface Room {
  name: string;
  rect: Rect;
  floor: FloorKind;
  /** Étiquette en haut de la pièce plutôt qu'en bas. */
  labelTop?: boolean;
}

export type FurnitureKind =
  | 'counter'
  | 'fridge'
  | 'dining'
  | 'tv'
  | 'sofa'
  | 'coffeeTable'
  | 'armchair'
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'dresser'
  | 'desk'
  | 'bookshelf'
  | 'plant'
  | 'tree'
  | 'truck'
  | 'rug'
  | 'pedestal'
  | 'vitrine'
  | 'bench'
  | 'crate'
  | 'easel';

export interface Furniture {
  kind: FurnitureKind;
  rect: Rect;
  solid: boolean;
  /** Variante de couleur ou d'orientation pour le rendu. */
  variant?: number;
}

export const GARDEN_FURNITURE: Furniture[] = [
  { kind: 'tree', rect: { x: 238, y: 40, w: 56, h: 56 }, solid: true },
  { kind: 'tree', rect: { x: 40, y: 330, w: 60, h: 60 }, solid: true, variant: 1 },
  { kind: 'truck', rect: { x: 24, y: 588, w: 180, h: 96 }, solid: true },
];

/** Cabanon de jardin qui sert de pièce de détention. */
export const JAIL = {
  outer: { x: 20, y: 30, w: 180, h: 170 } as Rect,
  walls: [
    { x: 20, y: 30, w: 180, h: WALL },
    { x: 20, y: 30, w: WALL, h: 170 },
    { x: 184, y: 30, w: WALL, h: 170 },
    { x: 20, y: 184, w: 180, h: WALL },
  ] as Rect[],
  cells: [
    { x: 85, y: 115 },
    { x: 135, y: 115 },
  ] as Vec[],
  /** Cadenas, accessible depuis l'extérieur du cabanon. */
  lock: { x: 110, y: 218 } as Vec,
  exits: [
    { x: 92, y: 240 },
    { x: 128, y: 240 },
  ] as Vec[],
};

export const TRUCK_ZONE: Rect = { x: 212, y: 556, w: 112, h: 136 };

export const SPAWNS: Vec[] = [
  { x: 248, y: 620 },
  { x: 290, y: 620 },
];

/** Boîtier électrique sur la façade, côté jardin. */
export const SWITCH_POS: Vec = { x: 318, y: 384 };

export const TRUCK_RECT = GARDEN_FURNITURE.find((f) => f.kind === 'truck')!.rect;

/** Limites du monde. */
export const BOUNDS: Rect[] = [
  { x: -60, y: -60, w: WORLD_W + 120, h: 64 },
  { x: -60, y: WORLD_H - 4, w: WORLD_W + 120, h: 64 },
  { x: -60, y: -60, w: 64, h: WORLD_H + 120 },
  { x: WORLD_W - 4, y: -60, w: 64, h: WORLD_H + 120 },
];

// ───────────── Objets ─────────────

export type ItemKind = 'small' | 'big';

export interface ItemInfo {
  name: string;
  kind: ItemKind;
  value: number;
  /** Dimensions de collision des gros objets. */
  w: number;
  h: number;
}

/** Tous les objets qu'on peut voler, quel que soit le niveau. */
export const ITEM_CATALOG: Record<string, ItemInfo> = {
  toaster: { name: 'Grille-pain doré', kind: 'small', value: 150, w: 0, h: 0 },
  console: { name: 'Console de jeu', kind: 'small', value: 200, w: 0, h: 0 },
  necklace: { name: 'Collier de perles', kind: 'small', value: 350, w: 0, h: 0 },
  laptop: { name: 'Ordinateur portable', kind: 'small', value: 250, w: 0, h: 0 },
  vase: { name: 'Vase Ming', kind: 'small', value: 300, w: 0, h: 0 },
  goldbar: { name: 'Lingot d’or', kind: 'small', value: 400, w: 0, h: 0 },
  diamond: { name: 'Diamant rose', kind: 'small', value: 500, w: 0, h: 0 },
  clock: { name: 'Horloge ancienne', kind: 'big', value: 600, w: 40, h: 56 },
  safe: { name: 'Coffre-fort', kind: 'big', value: 800, w: 52, h: 46 },
  painting: { name: 'Tableau de maître', kind: 'big', value: 700, w: 48, h: 34 },
  statue: { name: 'Statue antique', kind: 'big', value: 600, w: 36, h: 44 },
};

export interface ItemDef extends ItemInfo {
  id: string;
  x: number;
  y: number;
}

export function placeItem(id: string, x: number, y: number): ItemDef {
  return { id, x, y, ...ITEM_CATALOG[id] };
}

export function bigItemRect(x: number, y: number, def: { w: number; h: number }): Rect {
  return { x: x - def.w / 2, y: y - def.h / 2, w: def.w, h: def.h };
}

/** Points de prise d'un gros objet : 0 = gauche, 1 = droite. */
export function handlePos(x: number, y: number, def: { w: number }, handle: 0 | 1): Vec {
  const off = def.w / 2 + PLAYER_RADIUS + 3;
  return { x: x + (handle === 0 ? -off : off), y };
}
