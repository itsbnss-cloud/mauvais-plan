// Simulation autoritaire d'une partie. Aucune dépendance réseau : testable directement.
import {
  CAMERA_HALF_ANGLE,
  CAMERA_RANGE,
  CARRY_BIG_SPEED,
  COUNTDOWN,
  FREE_HOLD_TIME,
  GAME_DURATION,
  GUARD_CATCH_DIST,
  GUARD_RADIUS,
  INPUT_RATE,
  INPUT_STALE_AFTER,
  ITEM_COUNT,
  PLAYER_RADIUS,
  SOLO_BIG_SPEED,
  SOLO_CAMERA_OFF_TIME,
  SOLO_JAIL_TIME,
} from '../shared/constants';
import { circleHitsAny, coneSees, dist, normalize, rectHitsAny } from '../shared/geometry';
import {
  CAMERA,
  ITEMS,
  JAIL,
  SPAWNS,
  STATIC_OBSTACLES,
  VISION_BLOCKERS,
  bigItemRect,
  handlePos,
  type ItemDef,
} from '../shared/map';
import { bigItemObstacles, findInteraction, inTruckZone, sanitizeAxis, stepPlayer } from '../shared/rules';
import type {
  Carry,
  GameEvent,
  GamePhase,
  GameResult,
  HoldAction,
  InputCmd,
  ItemSnap,
  ItemState,
  Outcome,
  PushState,
  Seat,
  Snapshot,
} from '../shared/types';
import { Guard } from './guard';
import { NavGrid } from './nav';

interface PlayerState {
  seat: Seat;
  x: number;
  y: number;
  angle: number;
  moving: boolean;
  carry: Carry;
  jailed: boolean;
  /** Solo : temps restant avant l'évasion du cabanon. */
  jailLeft: number;
  leave: boolean;
  hold: HoldAction;
  queue: InputCmd[];
  tokens: number;
  lastSeq: number;
  lastInputAt: number;
  dirX: number;
  dirY: number;
  eHeld: boolean;
  prevE: boolean;
}

interface ItemRuntime {
  id: string;
  def: ItemDef;
  x: number;
  y: number;
  state: ItemState;
  holders: [Seat | null, Seat | null];
  carrier: Seat | null;
  push: PushState;
}

const MAX_QUEUE = 12;
const MAX_TOKENS = 4;

let sharedNav: NavGrid | null = null;
const getNav = () => (sharedNav ??= new NavGrid(STATIC_OBSTACLES, GUARD_RADIUS));

export class Game {
  phase: GamePhase = 'countdown';
  countdown = COUNTDOWN;
  timeLeft = GAME_DURATION;
  /** Horloge interne de simulation (secondes). */
  time = 0;
  players: PlayerState[];
  items: ItemRuntime[];
  guard: Guard;
  cameraEnabled = true;
  cameraAlarm = 0;
  freeProgress = 0;
  /** Solo : la caméra reste coupée jusqu'à cet instant (horloge interne). */
  cameraOffUntil = 0;
  loot = 0;
  delivered = 0;
  result: GameResult | null = null;

  private cameraCooldown = 0;
  private events: GameEvent[] = [];

  readonly solo: boolean;

  constructor(opts: { solo?: boolean } = {}) {
    this.solo = opts.solo === true;
    this.players = ((this.solo ? [0] : [0, 1]) as Seat[]).map((seat) => ({
      seat,
      x: SPAWNS[seat].x,
      y: SPAWNS[seat].y,
      angle: -Math.PI / 2,
      moving: false,
      carry: null,
      jailed: false,
      jailLeft: 0,
      leave: false,
      hold: null,
      queue: [],
      tokens: 0,
      lastSeq: 0,
      lastInputAt: -Infinity,
      dirX: 0,
      dirY: 0,
      eHeld: false,
      prevE: false,
    }));
    this.items = ITEMS.map((def) => ({
      id: def.id,
      def,
      x: def.x,
      y: def.y,
      state: 'idle',
      holders: [null, null],
      carrier: null,
      push: 'wait',
    }));
    this.guard = new Guard(getNav());
  }

  // ───────────── Entrées ─────────────

  pushInput(seat: Seat, raw: Partial<InputCmd> | undefined) {
    const p = this.players[seat];
    if (!p || !raw || typeof raw.seq !== 'number' || !Number.isFinite(raw.seq)) return;
    const seq = Math.floor(raw.seq);
    if (seq <= p.lastSeq) return;
    const cmd: InputCmd = { seq, x: sanitizeAxis(raw.x), y: sanitizeAxis(raw.y), e: raw.e === true, drop: raw.drop === true };
    if (this.phase !== 'playing') {
      // Hors jeu, on acquitte sans appliquer.
      p.lastSeq = seq;
      return;
    }
    p.queue.push(cmd);
    while (p.queue.length > MAX_QUEUE) p.lastSeq = p.queue.shift()!.seq;
  }

  private fresh(p: PlayerState) {
    return this.time - p.lastInputAt <= INPUT_STALE_AFTER;
  }

  private applyCmd(p: PlayerState, cmd: InputCmd) {
    p.lastSeq = cmd.seq;
    p.lastInputAt = this.time;
    const dir = normalize(cmd.x, cmd.y);
    p.dirX = dir.x;
    p.dirY = dir.y;

    if (p.carry?.kind !== 'big') {
      const next = stepPlayer(p, cmd.x, cmd.y, p.carry?.kind === 'small', bigItemObstacles(this.items));
      p.x = next.x;
      p.y = next.y;
      if (dir.x || dir.y) p.angle = Math.atan2(dir.y, dir.x);
    }

    if (cmd.e && !p.prevE) this.pressE(p);
    p.prevE = cmd.e;
    p.eHeld = cmd.e;
    if (cmd.drop) this.dropAction(p);

    if (p.carry?.kind === 'small' && inTruckZone(p)) this.deliver(this.item(p.carry.item));
  }

  private item(id: string) {
    return this.items.find((i) => i.id === id)!;
  }

  private pressE(p: PlayerState) {
    const inter = findInteraction(this.players, this.items, p.seat);
    if (!inter) return;
    if (inter.type === 'pick') {
      const it = this.item(inter.item);
      if (it.state !== 'idle' || p.carry) return;
      it.state = 'carried';
      it.carrier = p.seat;
      p.carry = { kind: 'small', item: it.id };
      this.events.push({ type: 'pickup', seat: p.seat, item: it.id });
    } else if (inter.type === 'grab') {
      const it = this.item(inter.item);
      const pos = handlePos(it.x, it.y, it.def, inter.handle);
      const obstacles = [...STATIC_OBSTACLES, ...bigItemObstacles(this.items, it.id)];
      if (circleHitsAny(pos.x, pos.y, PLAYER_RADIUS, obstacles)) {
        this.events.push({ type: 'denied', seat: p.seat, reason: 'Pas la place de ce côté !' });
        return;
      }
      p.x = pos.x;
      p.y = pos.y;
      p.carry = { kind: 'big', item: it.id, handle: inter.handle };
      it.holders[inter.handle] = p.seat;
      // En solo, un seul porteur suffit (mais il avance lentement).
      if (this.solo || (it.holders[0] !== null && it.holders[1] !== null)) it.state = 'carried';
      it.push = 'wait';
      this.events.push({ type: 'grab', seat: p.seat, item: it.id });
    } else if (inter.type === 'switch' && this.solo) {
      this.cameraOffUntil = this.time + SOLO_CAMERA_OFF_TIME;
    } else if (inter.type === 'leave') {
      p.leave = true;
      this.events.push({ type: 'leave', seat: p.seat });
    }
    // 'free' et 'switch' (à deux) sont des actions maintenues, traitées à chaque tick.
  }

  private dropAction(p: PlayerState) {
    if (!p.carry) return;
    const it = this.item(p.carry.item);
    if (p.carry.kind === 'small') {
      it.state = 'idle';
      it.carrier = null;
      it.x = p.x;
      it.y = p.y;
      p.carry = null;
      this.events.push({ type: 'drop', seat: p.seat, item: it.id });
      if (inTruckZone(it)) this.deliver(it);
    } else {
      this.releaseBig(it);
      this.events.push({ type: 'drop', seat: p.seat, item: it.id });
    }
  }

  private releaseBig(it: ItemRuntime) {
    for (const s of it.holders) if (s !== null) this.players[s].carry = null;
    it.holders = [null, null];
    if (it.state !== 'delivered') it.state = 'idle';
    it.push = 'wait';
  }

  private deliver(it: ItemRuntime) {
    if (it.state === 'delivered') return;
    const at = it.def.kind === 'small' && it.carrier !== null ? this.players[it.carrier] : it;
    const x = at.x;
    const y = at.y;
    if (it.def.kind === 'small') {
      if (it.carrier !== null) this.players[it.carrier].carry = null;
    } else {
      this.releaseBig(it);
    }
    it.state = 'delivered';
    it.carrier = null;
    it.holders = [null, null];
    it.x = x;
    it.y = y;
    this.loot += it.def.value;
    this.delivered++;
    this.events.push({ type: 'deliver', item: it.id, value: it.def.value, x, y });
  }

  // ───────────── Simulation ─────────────

  tick(dt: number) {
    this.time += dt;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'playing';
        for (const p of this.players) p.queue = [];
      }
      return;
    }
    if (this.phase !== 'playing') return;

    this.timeLeft = Math.max(0, this.timeLeft - dt);

    for (const p of this.players) {
      p.tokens = Math.min(MAX_TOKENS, p.tokens + dt * INPUT_RATE);
      while (p.queue.length && p.tokens >= 1) {
        p.tokens -= 1;
        this.applyCmd(p, p.queue.shift()!);
      }
      if (!this.fresh(p)) {
        // Plus de commandes (focus perdu, réseau coupé) : on s'arrête net.
        p.dirX = 0;
        p.dirY = 0;
        p.eHeld = false;
        p.prevE = false;
      }
      p.moving = p.carry?.kind !== 'big' && (p.dirX !== 0 || p.dirY !== 0) && this.fresh(p);
    }

    this.updateBigItems(dt);
    this.updateHoldActions(dt);
    this.updateCamera(dt);
    this.guard.update(dt, this.players, bigItemObstacles(this.items), this.events);
    this.checkCapture();
    this.checkEnd();
  }

  private updateBigItems(dt: number) {
    for (const it of this.items) {
      if (it.def.kind !== 'big' || it.state !== 'carried') continue;
      const carriers = it.holders.filter((s) => s !== null).map((s) => this.players[s]);
      const dirs = carriers.map((p) => (this.fresh(p) ? { x: p.dirX, y: p.dirY } : { x: 0, y: 0 }));
      const lens = dirs.map((d) => Math.hypot(d.x, d.y));
      const [da, db] = dirs;
      for (const p of carriers) p.moving = false;
      if (lens.some((l) => l < 0.1)) {
        it.push = 'wait';
      } else if (db && (da.x * db.x + da.y * db.y) / (lens[0] * lens[1]) < 0.3) {
        it.push = 'opposed';
      } else {
        const dir = normalize(da.x + (db?.x ?? 0), da.y + (db?.y ?? 0));
        const step = (this.solo ? SOLO_BIG_SPEED : CARRY_BIG_SPEED) * dt;
        const mx = this.tryMoveBig(it, dir.x * step, 0);
        const my = this.tryMoveBig(it, 0, dir.y * step);
        it.push = mx || my ? 'moving' : 'blocked';
        for (const p of carriers) {
          p.angle = Math.atan2(dir.y, dir.x);
          p.moving = it.push === 'moving';
        }
      }
      for (const p of carriers) {
        const h = (p.carry as { handle: 0 | 1 }).handle;
        const pos = handlePos(it.x, it.y, it.def, h);
        p.x = pos.x;
        p.y = pos.y;
      }
      if (inTruckZone(it)) this.deliver(it);
    }
  }

  /** Déplace l'ensemble objet + porteurs, uniquement si rien ne touche un obstacle. */
  private tryMoveBig(it: ItemRuntime, dx: number, dy: number): boolean {
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return false;
    const obstacles = [...STATIC_OBSTACLES, ...bigItemObstacles(this.items, it.id)];
    for (const f of [1, 0.5, 0.25]) {
      const nx = it.x + dx * f;
      const ny = it.y + dy * f;
      if (rectHitsAny(bigItemRect(nx, ny, it.def), obstacles)) continue;
      // Seules les poignées tenues doivent avoir la place pour leur porteur.
      const handles = ([0, 1] as const).filter((h) => it.holders[h] !== null).map((h) => handlePos(nx, ny, it.def, h));
      if (handles.some((h) => circleHitsAny(h.x, h.y, PLAYER_RADIUS, obstacles))) continue;
      it.x = nx;
      it.y = ny;
      return true;
    }
    return false;
  }

  private updateHoldActions(dt: number) {
    let switchHeld = false;
    let freeing = false;
    for (const p of this.players) {
      p.hold = null;
      if (!p.eHeld || !this.fresh(p)) continue;
      const inter = findInteraction(this.players, this.items, p.seat);
      if (inter?.type === 'switch') {
        switchHeld = true;
        p.hold = 'switch';
      } else if (inter?.type === 'free') {
        freeing = true;
        p.hold = 'free';
      }
    }
    this.cameraEnabled = !switchHeld && this.time >= this.cameraOffUntil;
    if (this.solo) return this.updateSoloJail(dt);
    if (!freeing) {
      this.freeProgress = 0;
      return;
    }
    this.freeProgress += dt;
    if (this.freeProgress >= FREE_HOLD_TIME) {
      this.freeProgress = 0;
      for (const p of this.players) if (p.jailed) this.release(p);
    }
  }

  /** Solo : personne pour ouvrir le cadenas, on s'évade seul au bout d'un moment. */
  private updateSoloJail(dt: number) {
    const p = this.players[0];
    if (!p.jailed) {
      this.freeProgress = 0;
      return;
    }
    p.jailLeft -= dt;
    this.freeProgress = Math.min(1, 1 - p.jailLeft / SOLO_JAIL_TIME);
    if (p.jailLeft <= 0) {
      this.freeProgress = 0;
      this.release(p);
    }
  }

  private release(p: PlayerState) {
    p.jailed = false;
    p.x = JAIL.exits[p.seat].x;
    p.y = JAIL.exits[p.seat].y;
    p.angle = Math.PI / 2;
    this.events.push({ type: 'freed', seat: p.seat });
  }

  private updateCamera(dt: number) {
    this.cameraAlarm = Math.max(0, this.cameraAlarm - dt);
    this.cameraCooldown -= dt;
    if (!this.cameraEnabled) return;
    for (const p of this.players) {
      if (p.jailed) continue;
      if (!coneSees(CAMERA, CAMERA.angle, CAMERA_RANGE, CAMERA_HALF_ANGLE, p, VISION_BLOCKERS)) continue;
      if (this.cameraAlarm <= 0) this.events.push({ type: 'cameraAlert', x: p.x, y: p.y });
      this.cameraAlarm = 1.2;
      if (this.cameraCooldown <= 0) {
        this.guard.investigate(p);
        this.cameraCooldown = 0.5;
      }
    }
  }

  private checkCapture() {
    if (this.guard.state === 'stunned') return;
    for (const p of this.players) {
      if (p.jailed || dist(this.guard, p) >= GUARD_CATCH_DIST) continue;
      this.capture(p);
      this.guard.stun();
      return;
    }
  }

  /** Envoie un joueur au cabanon. Exposé pour les tests. */
  capture(p: PlayerState) {
    if (p.carry) {
      const it = this.item(p.carry.item);
      if (p.carry.kind === 'small') {
        it.state = 'idle';
        it.carrier = null;
        it.x = p.x;
        it.y = p.y;
        p.carry = null;
      } else {
        this.releaseBig(it);
      }
    }
    this.events.push({ type: 'capture', seat: p.seat, x: p.x, y: p.y });
    p.jailed = true;
    p.jailLeft = SOLO_JAIL_TIME;
    p.leave = false;
    p.hold = null;
    p.x = JAIL.cells[p.seat].x;
    p.y = JAIL.cells[p.seat].y;
  }

  private checkEnd() {
    for (const p of this.players) if (p.leave && (p.jailed || p.carry || !inTruckZone(p))) p.leave = false;

    if (!this.solo && this.players.every((p) => p.jailed)) return this.end('caught');
    if (this.players.every((p) => p.leave)) return this.end(this.loot > 0 ? 'escaped' : 'escaped_empty');
    if (this.timeLeft <= 0) {
      const safe = this.players.every((p) => !p.jailed && inTruckZone(p));
      return this.end(safe ? (this.loot > 0 ? 'escaped' : 'escaped_empty') : 'timeout');
    }
  }

  private end(outcome: Outcome, detail?: string) {
    this.phase = 'ended';
    this.result = { outcome, loot: this.loot, delivered: this.delivered, total: ITEM_COUNT, detail };
  }

  // ───────────── Cycle de vie ─────────────

  pause() {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    this.phase = 'paused';
    for (const p of this.players) {
      p.queue = [];
      p.dirX = p.dirY = 0;
      p.eHeld = p.prevE = false;
      p.moving = false;
    }
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
  }

  abandon(detail: string) {
    if (this.phase === 'ended') return;
    this.end('abandoned', detail);
  }

  drainEvents(): GameEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  snapshot(you: Seat, events: GameEvent[]): Snapshot {
    return {
      t: Math.round(this.time * 1000),
      phase: this.phase,
      solo: this.solo,
      timeLeft: Math.round(this.timeLeft * 10) / 10,
      countdown: Math.round(this.countdown * 10) / 10,
      you,
      ack: this.players[you].lastSeq,
      players: this.players.map((p) => ({
        seat: p.seat,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        angle: Math.round(p.angle * 100) / 100,
        moving: p.moving,
        carry: p.carry,
        jailed: p.jailed,
        leave: p.leave,
        hold: p.hold,
      })),
      items: this.items.map(
        (it): ItemSnap => ({
          id: it.id,
          x: Math.round(it.x * 10) / 10,
          y: Math.round(it.y * 10) / 10,
          state: it.state,
          holders: [...it.holders],
          carrier: it.carrier,
          push: it.push,
        }),
      ),
      guard: this.guard.snap(),
      camera: { enabled: this.cameraEnabled, alarm: this.cameraAlarm > 0 },
      loot: this.loot,
      delivered: this.delivered,
      freeProgress: Math.round((this.solo ? this.freeProgress : this.freeProgress / FREE_HOLD_TIME) * 100) / 100,
      cameraOff: Math.max(0, Math.round((this.cameraOffUntil - this.time) * 10) / 10),
      events,
    };
  }
}

