// Règles partagées : le serveur s'en sert pour valider, le client pour afficher les indications.
import { CARRY_SMALL_SPEED, GRAB_RANGE, INPUT_DT, KEYPAD_RANGE, LOCK_RANGE, NOTE_RANGE, PICK_RANGE, PLAYER_RADIUS, PLAYER_SPEED, SWITCH_RANGE } from './constants';
import { dist, moveCircle, normalize, pointInRect, type Rect, type Vec } from './geometry';
import type { LaserDef, Level } from './levels';
import { JAIL, SWITCH_POS, TRUCK_ZONE, bigItemRect, handlePos } from './map';
import type { Carry, ItemState, Seat } from './types';

export interface RulesPlayer {
  x: number;
  y: number;
  carry: Carry;
  jailed: boolean;
  leave: boolean;
}

export interface RulesItem {
  id: string;
  x: number;
  y: number;
  state: ItemState;
  holders: [Seat | null, Seat | null];
}

export interface RulesGate {
  id: string;
  open: boolean;
}

export type Interaction =
  | { type: 'free' }
  | { type: 'switch' }
  | { type: 'keypad'; gate: string }
  | { type: 'note'; gate: string; index: number }
  | { type: 'grab'; item: string; handle: 0 | 1 }
  | { type: 'pick'; item: string }
  | { type: 'leave' };

export const inTruckZone = (p: Vec) => pointInRect(p.x, p.y, TRUCK_ZONE);

/** Action disponible pour un joueur avec E, par ordre de priorité. */
export function findInteraction(
  level: Level,
  players: readonly (RulesPlayer | undefined)[],
  items: readonly RulesItem[],
  gates: readonly RulesGate[],
  seat: Seat,
): Interaction | null {
  const p = players[seat];
  if (!p || p.jailed || p.carry) return null;
  const other = players[seat === 0 ? 1 : 0];

  if (other?.jailed && dist(p, JAIL.lock) <= LOCK_RANGE) return { type: 'free' };
  if (dist(p, SWITCH_POS) <= SWITCH_RANGE) return { type: 'switch' };

  for (const g of level.gates) {
    if (g.lock.type !== 'code') continue;
    if (!gates.find((s) => s.id === g.id)?.open && dist(p, g.lock.keypad) <= KEYPAD_RANGE) return { type: 'keypad', gate: g.id };
    const index = g.lock.notes.findIndex((n) => dist(p, n) <= NOTE_RANGE);
    if (index >= 0) return { type: 'note', gate: g.id, index };
  }

  let best: Interaction | null = null;
  let bestD = Infinity;
  for (const it of items) {
    if (it.state !== 'idle') continue;
    const def = level.itemById[it.id];
    if (def.kind === 'small') {
      const d = dist(p, it);
      if (d <= PICK_RANGE && d < bestD) {
        best = { type: 'pick', item: it.id };
        bestD = d;
      }
    } else {
      for (const h of [0, 1] as const) {
        if (it.holders[h] !== null || it.holders[h === 0 ? 1 : 0] === seat) continue;
        const d = dist(p, handlePos(it.x, it.y, def, h));
        if (d <= GRAB_RANGE && d < bestD) {
          best = { type: 'grab', item: it.id, handle: h };
          bestD = d;
        }
      }
    }
  }
  if (best) return best;
  if (!p.leave && inTruckZone(p)) return { type: 'leave' };
  return null;
}

/** Rectangles des gros objets encore dans la maison (solides pour les joueurs). */
export function bigItemObstacles(level: Level, items: readonly RulesItem[], exclude?: string): Rect[] {
  const out: Rect[] = [];
  for (const it of items) {
    if (it.state === 'delivered' || it.id === exclude) continue;
    const def = level.itemById[it.id];
    if (def.kind === 'big') out.push(bigItemRect(it.x, it.y, def));
  }
  return out;
}

/** Portes verrouillées : des murs tant qu'elles sont fermées. */
export function closedGateRects(level: Level, gates: readonly RulesGate[]): Rect[] {
  return level.gates.filter((g) => !gates.find((s) => s.id === g.id)?.open).map((g) => g.rect);
}

/** Tout ce qui bouge et bloque le passage : gros objets et portes fermées. */
export function dynamicObstacles(level: Level, items: readonly RulesItem[], gates: readonly RulesGate[], exclude?: string): Rect[] {
  return [...bigItemObstacles(level, items, exclude), ...closedGateRects(level, gates)];
}

/**
 * Un pas de déplacement libre d'un joueur. Utilisé à l'identique par le serveur
 * et par la prédiction locale du client.
 */
export function stepPlayer(level: Level, pos: Vec, inputX: number, inputY: number, carrySmall: boolean, dynamic: readonly Rect[]): Vec {
  const len = Math.hypot(inputX, inputY);
  const dir = len > 1 ? normalize(inputX, inputY) : { x: inputX, y: inputY };
  const speed = carrySmall ? CARRY_SMALL_SPEED : PLAYER_SPEED;
  return moveCircle(pos, dir.x * speed * INPUT_DT, dir.y * speed * INPUT_DT, PLAYER_RADIUS, [...level.staticObstacles, ...dynamic]);
}

/** Le laser est-il allumé à cet instant de la partie ? */
export function laserOn(l: LaserDef, time: number): boolean {
  const period = l.on + l.off;
  return (((time + l.offset) % period) + period) % period < l.on;
}

/** Distance d'un point à un segment. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Nettoie une commande reçue du réseau. */
export function sanitizeAxis(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n > 1 ? 1 : n < -1 ? -1 : n;
}
