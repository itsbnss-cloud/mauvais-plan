import {
  GUARD_CHASE_SPEED,
  GUARD_INVESTIGATE_SPEED,
  GUARD_LOSE_TIME,
  GUARD_PATROL_SPEED,
  GUARD_RADIUS,
  GUARD_SEARCH_TIME,
  GUARD_STUN_TIME,
  GUARD_VIEW_HALF_ANGLE,
  GUARD_VIEW_RANGE,
} from '../shared/constants';
import { angleDiff, coneSees, dist, lineOfSight, moveCircle, type Rect, type Vec } from '../shared/geometry';
import type { GameEvent, GuardSnap, GuardState, Seat } from '../shared/types';
import type { NavGrid } from './nav';

export interface GuardTarget {
  seat: Seat;
  x: number;
  y: number;
  jailed: boolean;
}

const TURN_RATE = 7;

export class Guard {
  x: number;
  y: number;
  angle = 0;
  state: GuardState = 'patrol';
  suspicion = 0;
  moving = false;
  target: Seat | null = null;
  lastSeen: Vec | null = null;

  private wp = 1;
  private path: Vec[] = [];
  private needPath = true;
  private repathIn = 0;
  private lostTime = 0;
  private timer = 0;
  private searchBase = 0;
  private stuckTime = 0;
  private stuckFails = 0;

  constructor(
    private readonly nav: NavGrid,
    private readonly patrol: readonly Vec[],
    private readonly staticObstacles: readonly Rect[],
    /** Ce qui bloque la vue à cet instant (murs et portes fermées). */
    private readonly blockers: () => readonly Rect[],
  ) {
    this.x = patrol[0].x;
    this.y = patrol[0].y;
    this.wp = 1 % patrol.length;
  }

  snap(): GuardSnap {
    return {
      x: round1(this.x),
      y: round1(this.y),
      angle: round2(this.angle),
      state: this.state,
      suspicion: round2(this.suspicion),
      moving: this.moving,
      target: this.state === 'chase' ? this.target : null,
    };
  }

  sees(p: Vec): boolean {
    const blockers = this.blockers();
    if (coneSees(this, this.angle, GUARD_VIEW_RANGE, GUARD_VIEW_HALF_ANGLE, p, blockers)) return true;
    // On sent un cambrioleur collé dans le dos.
    return dist(this, p) < 36 && lineOfSight(this, p, blockers);
  }

  /** Alerte de la caméra : aller voir la dernière position connue. */
  investigate(p: Vec) {
    if (this.state === 'chase' || this.state === 'stunned') return;
    this.state = 'investigate';
    this.lastSeen = { ...p };
    this.needPath = true;
    this.timer = 0;
  }

  stun() {
    this.state = 'stunned';
    this.timer = GUARD_STUN_TIME;
    this.target = null;
    this.path = [];
    this.suspicion = 0;
  }

  private backToPatrol() {
    this.state = 'patrol';
    this.target = null;
    this.lastSeen = null;
    let best = 0;
    let bestD = Infinity;
    this.patrol.forEach((w, i) => {
      const d = dist(this, w);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    this.wp = best;
    this.needPath = true;
  }

  update(dt: number, players: readonly GuardTarget[], dynamic: readonly Rect[], events: GameEvent[]) {
    this.moving = false;
    const visible = players.filter((p) => !p.jailed && this.sees(p));

    if (this.state === 'stunned') {
      this.timer -= dt;
      if (this.timer <= 0) this.backToPatrol();
      return;
    }

    if (this.state === 'chase') {
      const tp = players.find((p) => p.seat === this.target);
      if (!tp || tp.jailed) {
        // Changer de cible si l'autre est en vue, sinon reprendre la ronde.
        const other = visible[0];
        if (other) this.startChase(other.seat, other, events);
        else this.backToPatrol();
        return;
      }
      const seen = visible.includes(tp);
      if (seen) {
        this.lastSeen = { x: tp.x, y: tp.y };
        this.lostTime = 0;
      } else {
        this.lostTime += dt;
        const alt = visible[0];
        if (alt) {
          this.startChase(alt.seat, alt, events);
          return;
        }
      }
      if (this.lostTime > GUARD_LOSE_TIME) {
        this.startSearch(events);
        return;
      }
      this.repathIn -= dt;
      if (this.repathIn <= 0 || this.needPath) {
        this.path = this.nav.findPath(this, this.lastSeen!, dynamic);
        this.needPath = false;
        this.repathIn = 0.2;
      }
      const arrived = this.follow(GUARD_CHASE_SPEED, dt, dynamic);
      if (seen) this.faceTowards(Math.atan2(tp.y - this.y, tp.x - this.x), dt);
      if (arrived && !seen) this.startSearch(events);
      return;
    }

    // Ronde, enquête, fouille : la méfiance monte quand un joueur est en vue.
    if (visible.length) {
      const nearest = visible.reduce((a, b) => (dist(this, a) <= dist(this, b) ? a : b));
      const d = dist(this, nearest);
      const alert = this.state === 'patrol' ? 1 : 1.8;
      this.suspicion += dt * alert * (1.4 + 3 * Math.max(0, 1 - d / GUARD_VIEW_RANGE));
      if (this.suspicion >= 1) {
        this.startChase(nearest.seat, nearest, events);
        return;
      }
    } else {
      this.suspicion = Math.max(0, this.suspicion - dt * 0.35);
    }

    if (this.state === 'patrol') {
      if (this.needPath) {
        this.path = this.nav.findPath(this, this.patrol[this.wp], dynamic);
        this.needPath = false;
        if (!this.path.length) this.advanceWaypoint();
      }
      if (this.follow(GUARD_PATROL_SPEED, dt, dynamic)) this.advanceWaypoint();
    } else if (this.state === 'investigate') {
      if (this.needPath && this.lastSeen) {
        this.path = this.nav.findPath(this, this.lastSeen, dynamic);
        this.needPath = false;
      }
      if (this.follow(GUARD_INVESTIGATE_SPEED, dt, dynamic)) this.startSearch(events, false);
    } else if (this.state === 'search') {
      this.timer -= dt;
      this.angle = this.searchBase + Math.sin((GUARD_SEARCH_TIME - this.timer) * 2.6) * 1.3;
      if (this.timer <= 0) this.backToPatrol();
    }
  }

  private advanceWaypoint() {
    this.wp = (this.wp + 1) % this.patrol.length;
    this.needPath = true;
  }

  private startChase(seat: Seat, p: Vec, events: GameEvent[]) {
    const wasChasing = this.state === 'chase';
    this.state = 'chase';
    this.target = seat;
    this.lastSeen = { x: p.x, y: p.y };
    this.lostTime = 0;
    this.suspicion = 1;
    this.needPath = true;
    if (!wasChasing) events.push({ type: 'guardAlert', seat });
  }

  private startSearch(events: GameEvent[], lost = true) {
    if (lost) events.push({ type: 'guardLost' });
    this.state = 'search';
    this.target = null;
    this.timer = GUARD_SEARCH_TIME;
    this.searchBase = this.angle;
    this.path = [];
    this.suspicion = Math.min(this.suspicion, 0.6);
  }

  /** Avance le long du chemin. Retourne vrai une fois arrivé. */
  private follow(speed: number, dt: number, dynamic: readonly Rect[]): boolean {
    if (!this.path.length) return true;
    const obstacles = [...this.staticObstacles, ...dynamic];
    const start = { x: this.x, y: this.y };
    let budget = speed * dt;
    let moveAngle: number | null = null;
    while (budget > 0 && this.path.length) {
      const t = this.path[0];
      const d = dist(this, t);
      const step = Math.min(d, budget);
      if (d > 0.01) {
        moveAngle = Math.atan2(t.y - this.y, t.x - this.x);
        const next = moveCircle(this, ((t.x - this.x) / d) * step, ((t.y - this.y) / d) * step, GUARD_RADIUS, obstacles);
        this.x = next.x;
        this.y = next.y;
      }
      budget -= step;
      if (dist(this, t) < 3) this.path.shift();
      else if (step >= d) break;
    }
    const moved = dist(this, start);
    this.moving = moved > 0.05;
    if (moveAngle !== null) this.faceTowards(moveAngle, dt);

    // Détection de blocage (objet posé dans un passage, etc.).
    if (this.path.length && moved < speed * dt * 0.25) {
      this.stuckTime += dt;
      if (this.stuckTime > 0.8) {
        this.stuckTime = 0;
        this.stuckFails++;
        this.needPath = true;
        if (this.stuckFails >= 3) {
          this.stuckFails = 0;
          this.path = [];
          return true;
        }
      }
    } else {
      this.stuckTime = 0;
      if (moved > 1) this.stuckFails = 0;
    }
    return this.path.length === 0;
  }

  private faceTowards(target: number, dt: number) {
    const d = angleDiff(target, this.angle);
    const maxTurn = TURN_RATE * dt;
    this.angle += Math.abs(d) <= maxTurn ? d : Math.sign(d) * maxTurn;
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
