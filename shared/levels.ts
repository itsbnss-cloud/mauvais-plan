// Les niveaux : intérieur de la maison, objets, surveillance et énigmes.
import type { Rect, Vec } from './geometry';
import {
  BOUNDS,
  EXTERIOR_DOORS,
  GARDEN_FURNITURE,
  HOUSE,
  JAIL,
  SHELL_WALLS,
  TRUCK_RECT,
  hGapRect,
  hWall,
  placeItem,
  vGapRect,
  vWall,
  type Door,
  type Furniture,
  type ItemDef,
  type Room,
} from './map';

export interface CameraDef {
  x: number;
  y: number;
  angle: number;
}

/** Faisceau laser qui s'allume et s'éteint en boucle. */
export interface LaserDef {
  a: Vec;
  b: Vec;
  on: number;
  off: number;
  offset: number;
}

export type GateLock =
  /** Porte blindée : s'ouvre pour de bon avec le bon code, trouvé sur des indices. */
  | { type: 'code'; keypad: Vec; notes: Vec[]; puzzle: 'digits' | 'riddle' }
  /** Grille : ouverte tant que quelqu'un (ou quelque chose de lourd) est sur la plaque. */
  | { type: 'plate'; plate: Rect };

export interface GateDef {
  id: string;
  name: string;
  rect: Rect;
  vertical: boolean;
  lock: GateLock;
}

export interface LevelSpec {
  id: string;
  name: string;
  /** Une phrase d'accroche pour le choix du niveau. */
  blurb: string;
  stars: 1 | 2 | 3;
  duration: number;
  rooms: Room[];
  walls: Rect[];
  doors: Door[];
  furniture: Furniture[];
  items: ItemDef[];
  cameras: CameraDef[];
  /** Une ronde par gardien. */
  patrols: Vec[][];
  gates: GateDef[];
  lasers: LaserDef[];
}

export interface Level extends LevelSpec {
  allWalls: Rect[];
  allDoors: Door[];
  allFurniture: Furniture[];
  itemById: Record<string, ItemDef>;
  /** Obstacles fixes pour les déplacements (sans les portes verrouillées). */
  staticObstacles: Rect[];
  /** Ce qui bloque la vue (sans les portes verrouillées). */
  visionBlockers: Rect[];
}

function build(spec: LevelSpec): Level {
  const allWalls = [...SHELL_WALLS, ...spec.walls];
  const allFurniture = [...spec.furniture, ...GARDEN_FURNITURE];
  return {
    ...spec,
    allWalls,
    allDoors: [...EXTERIOR_DOORS, ...spec.doors, ...spec.gates.map((g) => ({ rect: g.rect, vertical: g.vertical, exterior: false }))],
    allFurniture,
    itemById: Object.fromEntries(spec.items.map((it) => [it.id, it])),
    staticObstacles: [...allWalls, ...JAIL.walls, ...BOUNDS, ...allFurniture.filter((f) => f.solid).map((f) => f.rect)],
    visionBlockers: [...allWalls, ...JAIL.walls, TRUCK_RECT],
  };
}

const H = HOUSE;
const deg = (d: number) => (d * Math.PI) / 180;

// ───────────── Niveau 1 : la maison des Dupont ─────────────

const DUPONT = build({
  id: 'dupont',
  name: 'Chez les Dupont',
  blurb: 'Une maison tranquille, un gardien, une caméra. Parfait pour se faire la main.',
  stars: 1,
  duration: 300,
  rooms: [
    { name: 'Cuisine', rect: { x: H.left, y: H.top, w: 800 - H.left, h: 354 - H.top }, floor: 'tiles' },
    { name: 'Salon', rect: { x: H.left, y: 354, w: 800 - H.left, h: H.bottom - 354 }, floor: 'wood' },
    { name: 'Chambre', rect: { x: 800, y: H.top, w: H.right - 800, h: 354 - H.top }, floor: 'carpet' },
    { name: 'Bureau', rect: { x: 800, y: 354, w: H.right - 800, h: H.bottom - 354 }, floor: 'parquet', labelTop: true },
  ],
  walls: [...vWall(800, H.top, H.bottom, [[120, 232], [470, 582]]), ...hWall(H.left, H.right, 354, [[466, 610], [990, 1134]])],
  doors: [
    { rect: vGapRect(800, [120, 232]), vertical: true, exterior: false },
    { rect: vGapRect(800, [470, 582]), vertical: true, exterior: false },
    { rect: hGapRect(354, [466, 610]), vertical: false, exterior: false },
    { rect: hGapRect(354, [990, 1134]), vertical: false, exterior: false },
  ],
  furniture: [
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
  ],
  items: [
    placeItem('toaster', 470, 102),
    placeItem('console', 600, 432),
    placeItem('necklace', 1074, 112),
    placeItem('laptop', 1136, 470),
    placeItem('clock', 930, 252),
    placeItem('safe', 990, 588),
  ],
  cameras: [{ x: 362, y: 376, angle: deg(68) }],
  patrols: [
    [
      { x: 450, y: 560 },
      { x: 740, y: 440 },
      { x: 900, y: 420 },
      { x: 1080, y: 640 },
      { x: 1050, y: 250 },
      { x: 870, y: 150 },
      { x: 720, y: 200 },
      { x: 420, y: 280 },
    ],
  ],
  gates: [],
  lasers: [],
});

// ───────────── Niveau 2 : la villa du notaire ─────────────

const VILLA = build({
  id: 'villa',
  name: 'La villa du notaire',
  blurb: 'Un couloir surveillé, deux caméras et un bureau fermé par une porte à code. Les chiffres traînent dans la maison…',
  stars: 2,
  duration: 330,
  rooms: [
    { name: 'Cuisine', rect: { x: H.left, y: H.top, w: 740 - H.left, h: 354 - H.top }, floor: 'tiles' },
    { name: 'Salon', rect: { x: H.left, y: 354, w: 740 - H.left, h: H.bottom - 354 }, floor: 'wood' },
    { name: 'Couloir', rect: { x: 740, y: H.top, w: 160, h: H.bottom - H.top }, floor: 'parquet', labelTop: true },
    { name: 'Chambre', rect: { x: 900, y: H.top, w: H.right - 900, h: 250 - H.top }, floor: 'carpet' },
    { name: 'Bibliothèque', rect: { x: 900, y: 250, w: H.right - 900, h: 220 }, floor: 'wood' },
    { name: 'Bureau', rect: { x: 900, y: 470, w: H.right - 900, h: H.bottom - 470 }, floor: 'velvet', labelTop: true },
  ],
  walls: [
    ...vWall(740, H.top, H.bottom, [[130, 240], [500, 640]]),
    ...hWall(H.left, 740, 354, [[480, 620]]),
    ...vWall(900, H.top, H.bottom, [[90, 200], [300, 410], [530, 650]]),
    ...hWall(900, H.right, 250),
    ...hWall(900, H.right, 470),
  ],
  doors: [
    { rect: vGapRect(740, [130, 240]), vertical: true, exterior: false },
    { rect: vGapRect(740, [500, 640]), vertical: true, exterior: false },
    { rect: hGapRect(354, [480, 620]), vertical: false, exterior: false },
    { rect: vGapRect(900, [90, 200]), vertical: true, exterior: false },
    { rect: vGapRect(900, [300, 410]), vertical: true, exterior: false },
  ],
  furniture: [
    // Cuisine
    { kind: 'counter', rect: { x: 356, y: 32, w: 236, h: 44 }, solid: true },
    { kind: 'fridge', rect: { x: 610, y: 32, w: 56, h: 58 }, solid: true },
    { kind: 'dining', rect: { x: 470, y: 248, w: 150, h: 70 }, solid: true },
    { kind: 'plant', rect: { x: 696, y: 304, w: 30, h: 30 }, solid: true },
    // Salon
    { kind: 'rug', rect: { x: 430, y: 450, w: 200, h: 120 }, solid: false },
    { kind: 'tv', rect: { x: 420, y: 364, w: 120, h: 30 }, solid: true },
    { kind: 'armchair', rect: { x: 450, y: 624, w: 50, h: 50 }, solid: true },
    { kind: 'sofa', rect: { x: 560, y: 626, w: 150, h: 50 }, solid: true },
    { kind: 'plant', rect: { x: 698, y: 368, w: 30, h: 30 }, solid: true },
    // Couloir
    { kind: 'plant', rect: { x: 858, y: 644, w: 30, h: 30 }, solid: true },
    // Chambre
    { kind: 'rug', rect: { x: 960, y: 110, w: 140, h: 100 }, solid: false, variant: 1 },
    { kind: 'bed', rect: { x: 1110, y: 36, w: 134, h: 150 }, solid: true },
    { kind: 'nightstand', rect: { x: 1068, y: 40, w: 36, h: 34 }, solid: true },
    { kind: 'wardrobe', rect: { x: 916, y: 34, w: 104, h: 44 }, solid: true },
    // Bibliothèque
    { kind: 'bookshelf', rect: { x: 916, y: 262, w: 150, h: 34 }, solid: true },
    { kind: 'bookshelf', rect: { x: 1094, y: 262, w: 150, h: 34 }, solid: true },
    { kind: 'bookshelf', rect: { x: 1094, y: 424, w: 150, h: 34 }, solid: true },
    { kind: 'armchair', rect: { x: 1040, y: 404, w: 44, h: 44 }, solid: true },
    // Bureau
    { kind: 'desk', rect: { x: 1170, y: 500, w: 76, h: 150 }, solid: true },
    { kind: 'bookshelf', rect: { x: 980, y: 640, w: 150, h: 34 }, solid: true },
    { kind: 'plant', rect: { x: 916, y: 640, w: 30, h: 30 }, solid: true },
  ],
  items: [
    placeItem('toaster', 470, 102),
    placeItem('vase', 620, 430),
    placeItem('necklace', 1000, 150),
    placeItem('laptop', 1000, 360),
    placeItem('goldbar', 1110, 560),
    placeItem('painting', 1150, 360),
    placeItem('safe', 1050, 590),
  ],
  cameras: [
    { x: 362, y: 376, angle: deg(68) },
    { x: 820, y: 44, angle: deg(90) },
  ],
  patrols: [
    [
      { x: 820, y: 90 },
      { x: 990, y: 150 },
      { x: 820, y: 150 },
      { x: 820, y: 350 },
      { x: 1040, y: 350 },
      { x: 820, y: 350 },
      { x: 820, y: 580 },
      { x: 560, y: 520 },
      { x: 520, y: 180 },
      { x: 820, y: 190 },
    ],
  ],
  gates: [
    {
      id: 'bureau',
      name: 'la porte du bureau',
      rect: vGapRect(900, [530, 650]),
      vertical: true,
      lock: {
        type: 'code',
        keypad: { x: 876, y: 508 },
        notes: [
          { x: 700, y: 112 },
          { x: 1226, y: 214 },
          { x: 380, y: 410 },
        ],
        puzzle: 'digits',
      },
    },
  ],
  lasers: [],
});

// ───────────── Niveau 3 : le musée Lumière ─────────────

const MUSEE = build({
  id: 'musee',
  name: 'Le musée Lumière',
  blurb: 'Deux gardiens, des lasers, une salle à plaque de pression et une chambre forte à énigmes. Bonne chance.',
  stars: 3,
  duration: 360,
  rooms: [
    { name: 'Atelier', rect: { x: H.left, y: H.top, w: 640 - H.left, h: 354 - H.top }, floor: 'wood' },
    { name: 'Hall', rect: { x: H.left, y: 354, w: 640 - H.left, h: H.bottom - 354 }, floor: 'marble' },
    { name: 'Grande galerie', rect: { x: 640, y: H.top, w: 370, h: H.bottom - H.top }, floor: 'parquet' },
    { name: 'Salle des bijoux', rect: { x: 1010, y: H.top, w: H.right - 1010, h: 354 - H.top }, floor: 'velvet' },
    { name: 'Chambre forte', rect: { x: 1010, y: 354, w: H.right - 1010, h: H.bottom - 354 }, floor: 'steel' },
  ],
  walls: [
    ...vWall(640, H.top, H.bottom, [[120, 230], [440, 560]]),
    ...hWall(H.left, 640, 354, [[420, 560]]),
    ...vWall(1010, H.top, H.bottom, [[100, 210], [480, 590]]),
    ...hWall(1010, H.right, 354),
  ],
  doors: [
    { rect: vGapRect(640, [120, 230]), vertical: true, exterior: false },
    { rect: vGapRect(640, [440, 560]), vertical: true, exterior: false },
    { rect: hGapRect(354, [420, 560]), vertical: false, exterior: false },
  ],
  furniture: [
    // Atelier
    { kind: 'bookshelf', rect: { x: 440, y: 32, w: 150, h: 34 }, solid: true },
    { kind: 'easel', rect: { x: 470, y: 268, w: 40, h: 50 }, solid: true },
    { kind: 'crate', rect: { x: 588, y: 290, w: 44, h: 44 }, solid: true },
    // Hall
    { kind: 'rug', rect: { x: 400, y: 450, w: 180, h: 110 }, solid: false },
    { kind: 'bench', rect: { x: 420, y: 370, w: 100, h: 28 }, solid: true },
    { kind: 'pedestal', rect: { x: 576, y: 372, w: 40, h: 40 }, solid: true },
    { kind: 'plant', rect: { x: 600, y: 640, w: 30, h: 30 }, solid: true },
    // Grande galerie
    { kind: 'bench', rect: { x: 785, y: 330, w: 90, h: 28 }, solid: true },
    { kind: 'pedestal', rect: { x: 940, y: 290, w: 40, h: 40 }, solid: true },
    { kind: 'plant', rect: { x: 960, y: 640, w: 30, h: 30 }, solid: true },
    // Salle des bijoux
    { kind: 'vitrine', rect: { x: 1040, y: 40, w: 80, h: 36 }, solid: true },
    { kind: 'vitrine', rect: { x: 1160, y: 40, w: 80, h: 36 }, solid: true },
    { kind: 'pedestal', rect: { x: 1200, y: 190, w: 40, h: 40 }, solid: true },
    // Chambre forte
    { kind: 'crate', rect: { x: 1196, y: 370, w: 48, h: 48 }, solid: true },
    { kind: 'crate', rect: { x: 1040, y: 370, w: 48, h: 48 }, solid: true },
  ],
  items: [
    placeItem('vase', 400, 200),
    placeItem('statue', 520, 610),
    placeItem('painting', 825, 90),
    placeItem('diamond', 1100, 110),
    placeItem('necklace', 1150, 260),
    placeItem('goldbar', 1110, 450),
    placeItem('safe', 1140, 620),
  ],
  cameras: [
    { x: 362, y: 376, angle: deg(68) },
    { x: 988, y: 44, angle: deg(130) },
  ],
  patrols: [
    [
      { x: 700, y: 90 },
      { x: 950, y: 90 },
      { x: 950, y: 420 },
      { x: 820, y: 620 },
      { x: 700, y: 420 },
    ],
    [
      { x: 560, y: 120 },
      { x: 560, y: 300 },
      { x: 500, y: 460 },
      { x: 400, y: 610 },
      { x: 600, y: 520 },
      { x: 400, y: 410 },
      { x: 400, y: 120 },
    ],
  ],
  gates: [
    {
      id: 'bijoux',
      name: 'la grille de la salle des bijoux',
      rect: vGapRect(1010, [100, 210]),
      vertical: true,
      lock: { type: 'plate', plate: { x: 676, y: 596, w: 56, h: 56 } },
    },
    {
      id: 'forte',
      name: 'la porte de la chambre forte',
      rect: vGapRect(1010, [480, 590]),
      vertical: true,
      lock: {
        type: 'code',
        keypad: { x: 986, y: 458 },
        notes: [
          { x: 600, y: 64 },
          { x: 370, y: 600 },
          { x: 1228, y: 318 },
          { x: 920, y: 660 },
        ],
        puzzle: 'riddle',
      },
    },
  ],
  lasers: [
    { a: { x: 760, y: 32 }, b: { x: 760, y: 676 }, on: 1.6, off: 1.5, offset: 0 },
    { a: { x: 890, y: 32 }, b: { x: 890, y: 676 }, on: 1.6, off: 1.5, offset: 1.4 },
  ],
});

export const LEVELS: Level[] = [DUPONT, VILLA, MUSEE];
export const LEVEL_BY_ID: Record<string, Level> = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
export const DEFAULT_LEVEL = DUPONT.id;

export const getLevel = (id: unknown): Level => (typeof id === 'string' && LEVEL_BY_ID[id]) || DUPONT;

// ───────────── Énigmes des portes à code ─────────────

const ORDINAL = ['1er', '2e', '3e', '4e'];

export interface CodePuzzle {
  code: string;
  /** Un texte par papier, dans l'ordre des positions du niveau. */
  clues: string[];
}

/** Tire un code et rédige les indices correspondants. */
export function makePuzzle(kind: 'digits' | 'riddle', count: number, rand: () => number = Math.random): CodePuzzle {
  const r = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  if (kind === 'riddle') {
    // Quatre chiffres liés entre eux : il faut tous les papiers pour retrouver le code.
    const d1 = r(1, 4);
    const k = r(2, Math.min(4, 8 - d1));
    const digits = [d1, d1 + k, k, d1 * 2];
    return {
      code: digits.join(''),
      clues: [
        `Le 1er chiffre est ${d1}.`,
        `Le 2e chiffre vaut le 1er plus ${k}.`,
        'Le 3e chiffre est l’écart entre le 2e et le 1er.',
        'Le 4e chiffre est le double du 1er.',
      ].slice(0, count),
    };
  }
  const digits = Array.from({ length: count }, () => r(0, 9));
  return { code: digits.join(''), clues: digits.map((d, i) => `Le ${ORDINAL[i]} chiffre du code est ${d}.`) };
}
