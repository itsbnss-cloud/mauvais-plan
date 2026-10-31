import { PLAYER_RADIUS, WORLD_H, WORLD_W } from './constants';
import type { Rect, Vec } from './geometry';

/** Épaisseur des murs. */
export const WALL = 16;

// Contour de la maison et cloisons.
export const HOUSE = { left: 340, right: 1260, top: 24, bottom: 684, midX: 800, midY: 354 };

type Gap = [number, number];

function hWall(x1: number, x2: number, y: number, gaps: Gap[] = []): Rect[] {
  return splitByGaps(x1, x2, gaps).map(([a, b]) => ({ x: a, y: y - WALL / 2, w: b - a, h: WALL }));
}

function vWall(x: number, y1: number, y2: number, gaps: Gap[] = []): Rect[] {
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

const H = HOUSE;
const half = WALL / 2;

// Ouvertures (portes).
const KITCHEN_DOOR: Gap = [150, 250];
const FRONT_DOOR: Gap = [416, 528];
const KITCHEN_BEDROOM_DOOR: Gap = [120, 232];
const LIVING_OFFICE_DOOR: Gap = [470, 582];
const KITCHEN_LIVING_DOOR: Gap = [466, 610];
const BEDROOM_OFFICE_DOOR: Gap = [990, 1134];

export const WALLS: Rect[] = [
  ...hWall(H.left - half, H.right + half, H.top),
  ...hWall(H.left - half, H.right + half, H.bottom),
  ...vWall(H.left, H.top, H.bottom, [KITCHEN_DOOR, FRONT_DOOR]),
  ...vWall(H.right, H.top, H.bottom),
  ...vWall(H.midX, H.top, H.bottom, [KITCHEN_BEDROOM_DOOR, LIVING_OFFICE_DOOR]),
  ...hWall(H.left, H.right, H.midY, [KITCHEN_LIVING_DOOR, BEDROOM_OFFICE_DOOR]),
];

export interface Door {
  /** Rectangle de l'ouverture (dans l'épaisseur du mur). */
  rect: Rect;
  vertical: boolean;
  exterior: boolean;
}

export const DOORS: Door[] = [
  { rect: { x: H.left - half, y: KITCHEN_DOOR[0], w: WALL, h: KITCHEN_DOOR[1] - KITCHEN_DOOR[0] }, vertical: true, exterior: true },
  { rect: { x: H.left - half, y: FRONT_DOOR[0], w: WALL, h: FRONT_DOOR[1] - FRONT_DOOR[0] }, vertical: true, exterior: true },
  { rect: { x: H.midX - half, y: KITCHEN_BEDROOM_DOOR[0], w: WALL, h: KITCHEN_BEDROOM_DOOR[1] - KITCHEN_BEDROOM_DOOR[0] }, vertical: true, exterior: false },
  { rect: { x: H.midX - half, y: LIVING_OFFICE_DOOR[0], w: WALL, h: LIVING_OFFICE_DOOR[1] - LIVING_OFFICE_DOOR[0] }, vertical: true, exterior: false },
  { rect: { x: KITCHEN_LIVING_DOOR[0], y: H.midY - half, w: KITCHEN_LIVING_DOOR[1] - KITCHEN_LIVING_DOOR[0], h: WALL }, vertical: false, exterior: false },
  { rect: { x: BEDROOM_OFFICE_DOOR[0], y: H.midY - half, w: BEDROOM_OFFICE_DOOR[1] - BEDROOM_OFFICE_DOOR[0], h: WALL }, vertical: false, exterior: false },
];

export type FloorKind = 'tiles' | 'wood' | 'carpet' | 'parquet';

export interface Room {
  name: string;
  rect: Rect;
  floor: FloorKind;
}

export const ROOMS: Room[] = [
  { name: 'Cuisine', rect: { x: H.left, y: H.top, w: H.midX - H.left, h: H.midY - H.top }, floor: 'tiles' },
  { name: 'Salon', rect: { x: H.left, y: H.midY, w: H.midX - H.left, h: H.bottom - H.midY }, floor: 'wood' },
  { name: 'Chambre', rect: { x: H.midX, y: H.top, w: H.right - H.midX, h: H.midY - H.top }, floor: 'carpet' },
  { name: 'Bureau', rect: { x: H.midX, y: H.midY, w: H.right - H.midX, h: H.bottom - H.midY }, floor: 'parquet' },
];

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
  | 'rug';

export interface Furniture {
  kind: FurnitureKind;
  rect: Rect;
  solid: boolean;
  /** Variante de couleur ou d'orientation pour le rendu. */
  variant?: number;
}

export const FURNITURE: Furniture[] = [
  // Cuisine
  { kind: 'counter', rect: { x: 356, y: 32, w: 236, h: 44 }, solid: true },
  { kind: 'fridge', rect: { x: 610, y: 32, w: 56, h: 58 }, solid: true },
  { kind: 'dining', rect: { x: 520, y: 172, w: 150, h: 80 }, solid: true },
  { kind: 'plant', rect: { x: 754, y: 296, w: 30, h: 30 }, solid: true },
  // Salon
  { kind: 'rug', rect: { x: 500, y: 440, w: 200, h: 140 }, solid: false },
  { kind: 'tv', rect: { x: 540, y: 364, w: 120, h: 30 }, solid: true },
  { kind: 'coffeeTable', rect: { x: 560, y: 488, w: 80, h: 46 }, solid: true },
  { kind: 'sofa', rect: { x: 525, y: 592, w: 150, h: 56 }, solid: true },
  { kind: 'armchair', rect: { x: 440, y: 604, w: 50, h: 50 }, solid: true },
  { kind: 'plant', rect: { x: 754, y: 638, w: 30, h: 30 }, solid: true },
  // Chambre
  { kind: 'rug', rect: { x: 980, y: 150, w: 150, h: 110 }, solid: false, variant: 1 },
  { kind: 'bed', rect: { x: 1110, y: 40, w: 134, h: 150 }, solid: true },
  { kind: 'nightstand', rect: { x: 1068, y: 42, w: 36, h: 34 }, solid: true },
  { kind: 'wardrobe', rect: { x: 830, y: 34, w: 104, h: 44 }, solid: true },
  { kind: 'dresser', rect: { x: 1150, y: 298, w: 96, h: 40 }, solid: true },
  // Bureau
  { kind: 'desk', rect: { x: 1170, y: 430, w: 76, h: 150 }, solid: true },
  { kind: 'bookshelf', rect: { x: 820, y: 636, w: 150, h: 34 }, solid: true },
  { kind: 'plant', rect: { x: 1212, y: 630, w: 30, h: 30 }, solid: true },
  // Jardin
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

export const CAMERA = { x: 362, y: 376, angle: (68 * Math.PI) / 180 };

export const GUARD_PATROL: Vec[] = [
  { x: 450, y: 560 },
  { x: 740, y: 440 },
  { x: 900, y: 420 },
  { x: 1080, y: 640 },
  { x: 1050, y: 250 },
  { x: 870, y: 150 },
  { x: 720, y: 200 },
  { x: 420, y: 280 },
];

export type ItemKind = 'small' | 'big';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  value: number;
  x: number;
  y: number;
  /** Dimensions de collision des gros objets. */
  w: number;
  h: number;
}

export const ITEMS: ItemDef[] = [
  { id: 'toaster', name: 'Grille-pain doré', kind: 'small', value: 150, x: 470, y: 102, w: 0, h: 0 },
  { id: 'console', name: 'Console de jeu', kind: 'small', value: 200, x: 600, y: 432, w: 0, h: 0 },
  { id: 'necklace', name: 'Collier de perles', kind: 'small', value: 350, x: 1074, y: 112, w: 0, h: 0 },
  { id: 'laptop', name: 'Ordinateur portable', kind: 'small', value: 250, x: 1136, y: 470, w: 0, h: 0 },
  { id: 'clock', name: 'Horloge ancienne', kind: 'big', value: 600, x: 930, y: 252, w: 40, h: 56 },
  { id: 'safe', name: 'Coffre-fort', kind: 'big', value: 800, x: 990, y: 588, w: 52, h: 46 },
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

/** Limites du monde. */
export const BOUNDS: Rect[] = [
  { x: -60, y: -60, w: WORLD_W + 120, h: 64 },
  { x: -60, y: WORLD_H - 4, w: WORLD_W + 120, h: 64 },
  { x: -60, y: -60, w: 64, h: WORLD_H + 120 },
  { x: WORLD_W - 4, y: -60, w: 64, h: WORLD_H + 120 },
];

export const TRUCK_RECT = FURNITURE.find((f) => f.kind === 'truck')!.rect;

/** Obstacles fixes pour les déplacements. */
export const STATIC_OBSTACLES: Rect[] = [
  ...WALLS,
  ...JAIL.walls,
  ...BOUNDS,
  ...FURNITURE.filter((f) => f.solid).map((f) => f.rect),
];

/** Ce qui bloque la vision du gardien et de la caméra. */
export const VISION_BLOCKERS: Rect[] = [...WALLS, ...JAIL.walls, TRUCK_RECT];

export function bigItemRect(x: number, y: number, def: ItemDef): Rect {
  return { x: x - def.w / 2, y: y - def.h / 2, w: def.w, h: def.h };
}

/** Points de prise d'un gros objet : 0 = gauche, 1 = droite. */
export function handlePos(x: number, y: number, def: ItemDef, handle: 0 | 1): Vec {
  const off = def.w / 2 + PLAYER_RADIUS + 3;
  return { x: x + (handle === 0 ? -off : off), y };
}
