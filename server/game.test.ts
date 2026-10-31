import { describe, expect, it } from 'vitest';
import { CARRY_BIG_SPEED, COUNTDOWN, INPUT_DT, KEYPAD_COOLDOWN, PLAYER_RADIUS, SOLO_BIG_SPEED, SOLO_CAMERA_OFF_TIME, SOLO_JAIL_TIME } from '../shared/constants';
import { circleHitsAny, rectHitsAny } from '../shared/geometry';
import { LEVELS, LEVEL_BY_ID, makePuzzle, type Level } from '../shared/levels';
import { JAIL, SWITCH_POS, TRUCK_ZONE, bigItemRect, handlePos } from '../shared/map';
import { inTruckZone } from '../shared/rules';
import type { InputCmd, Seat } from '../shared/types';
import { Game } from './game';
import { NavGrid } from './nav';

type Cmd = Partial<Omit<InputCmd, 'seq'>>;

const DUPONT = LEVEL_BY_ID.dupont;
const CAMERA = DUPONT.cameras[0];
const STATIC_OBSTACLES = DUPONT.staticObstacles;

function setup(opts: { solo?: boolean; level?: string; rand?: () => number } = {}) {
  const g = new Game(opts);
  g.tick(COUNTDOWN + 0.01);
  expect(g.phase).toBe('playing');
  return { g, seq: [0, 0] };
}

/** Avance d'un pas avec une commande par joueur. */
function step(ctx: { g: Game; seq: number[] }, cmds: [Cmd?, Cmd?] = [], ticks = 1) {
  for (let i = 0; i < ticks; i++) {
    for (const seat of [0, 1] as Seat[]) {
      const c = cmds[seat] ?? {};
      ctx.g.pushInput(seat, { seq: ++ctx.seq[seat], x: c.x ?? 0, y: c.y ?? 0, e: c.e ?? false, drop: c.drop ?? false });
    }
    ctx.g.tick(INPUT_DT);
  }
}

/** Met le gardien hors jeu pour tester une règle isolément. */
function parkGuard(g: Game) {
  g.guard.x = 1230;
  g.guard.y = 60;
  g.guard.stun();
  (g.guard as unknown as { timer: number }).timer = 1e9;
}

function parkGuards(g: Game) {
  g.guards.forEach((gd, i) => {
    gd.x = 1230;
    gd.y = 60 + i * 40;
    gd.stun();
    (gd as unknown as { timer: number }).timer = 1e9;
  });
}

function place(g: Game, seat: Seat, x: number, y: number) {
  g.players[seat].x = x;
  g.players[seat].y = y;
}

const item = (g: Game, id: string) => g.items.find((i) => i.id === id)!;

describe('déplacements et collisions', () => {
  it('les murs bloquent les joueurs', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    place(ctx.g, 0, 300, 320); // jardin, face à un pan de mur plein
    step(ctx, [{ x: 1 }], 90);
    expect(ctx.g.players[0].x).toBeLessThanOrEqual(332 - PLAYER_RADIUS + 0.01);
  });

  it('un joueur sans commandes récentes s’arrête', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    step(ctx, [{ x: 1, y: -1 }], 5);
    const before = { ...ctx.g.players[0] };
    expect(before.moving).toBe(true);
    // Plus aucune commande : le personnage ne doit pas continuer à marcher.
    for (let i = 0; i < 60; i++) ctx.g.tick(INPUT_DT);
    expect(ctx.g.players[0].x).toBe(before.x);
    expect(ctx.g.players[0].y).toBe(before.y);
    expect(ctx.g.players[0].moving).toBe(false);
  });

  it('limite le débit de commandes (pas d’accélération par envoi massif)', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    place(ctx.g, 0, 260, 300);
    for (let i = 0; i < 40; i++) ctx.g.pushInput(0, { seq: ++ctx.seq[0], x: 0, y: 1, e: false, drop: false });
    ctx.g.tick(INPUT_DT);
    // Au plus quelques pas appliqués en un tick.
    expect(ctx.g.players[0].y - 300).toBeLessThan(165 * INPUT_DT * 2.1);
  });
});

describe('petits objets', () => {
  it('se ramassent une seule fois et se comptent une seule fois au camion', () => {
    const ctx = setup();
    const { g } = ctx;
    parkGuard(g);
    const console_ = item(g, 'console');
    place(g, 0, console_.x, console_.y + 20);
    place(g, 1, console_.x + 20, console_.y + 20);
    step(ctx, [{ e: true }, {}]);
    step(ctx, [{}, { e: true }]);
    expect(g.players[0].carry).toEqual({ kind: 'small', item: 'console' });
    expect(g.players[1].carry).toBeNull();
    expect(console_.carrier).toBe(0);

    // Un seul objet à la fois.
    const toaster = item(g, 'toaster');
    place(g, 0, toaster.x, toaster.y + 20);
    step(ctx, [{ e: false }]);
    step(ctx, [{ e: true }]);
    expect(g.players[0].carry).toEqual({ kind: 'small', item: 'console' });
    expect(toaster.state).toBe('idle');

    // Dépôt dans la zone du camion.
    place(g, 0, TRUCK_ZONE.x + 50, TRUCK_ZONE.y - 20);
    step(ctx, [{ y: 1 }], 15);
    expect(console_.state).toBe('delivered');
    expect(g.loot).toBe(200);
    expect(g.delivered).toBe(1);
    expect(g.players[0].carry).toBeNull();

    // Rien ne peut le recompter.
    step(ctx, [{ e: true, drop: true }], 3);
    step(ctx, [{ y: -1 }], 20);
    step(ctx, [{ y: 1 }], 20);
    expect(g.loot).toBe(200);
    expect(g.delivered).toBe(1);
  });

  it('refuse un ramassage hors de portée', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    const n = item(ctx.g, 'necklace');
    place(ctx.g, 0, n.x - 120, n.y + 60);
    step(ctx, [{ e: true }]);
    expect(ctx.g.players[0].carry).toBeNull();
    expect(n.state).toBe('idle');
  });

  it('se lâche avec Espace là où se trouve le joueur', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    const l = item(ctx.g, 'laptop');
    place(ctx.g, 1, l.x - 20, l.y);
    step(ctx, [{}, { e: true }]);
    step(ctx, [{}, { x: -1 }], 10);
    step(ctx, [{}, { drop: true }]);
    expect(ctx.g.players[1].carry).toBeNull();
    expect(l.state).toBe('idle');
    expect(l.x).toBeCloseTo(ctx.g.players[1].x);
  });
});

describe('gros objets', () => {
  function grab(ctx: ReturnType<typeof setup>, id: string) {
    const it = item(ctx.g, id);
    const h0 = handlePos(it.x, it.y, it.def, 0);
    const h1 = handlePos(it.x, it.y, it.def, 1);
    place(ctx.g, 0, h0.x, h0.y);
    place(ctx.g, 1, h1.x, h1.y);
    step(ctx, [{ e: true }, { e: true }]);
    step(ctx);
    return it;
  }

  function assertClear(it: ReturnType<typeof item>) {
    expect(rectHitsAny(bigItemRect(it.x, it.y, it.def), STATIC_OBSTACLES)).toBe(false);
    for (const h of [0, 1] as const) {
      const p = handlePos(it.x, it.y, it.def, h);
      expect(circleHitsAny(p.x, p.y, PLAYER_RADIUS, STATIC_OBSTACLES)).toBe(false);
    }
  }

  /** Pousse à deux dans une direction jusqu'à la condition. */
  function push(ctx: ReturnType<typeof setup>, it: ReturnType<typeof item>, x: number, y: number, until: () => boolean) {
    for (let i = 0; i < 400 && !until(); i++) {
      step(ctx, [{ x, y }, { x, y }]);
      if (it.state !== 'delivered') assertClear(it);
    }
    expect(until()).toBe(true);
  }

  it('demande deux joueurs sur deux points de prise distincts', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    const it = item(ctx.g, 'safe');
    const h0 = handlePos(it.x, it.y, it.def, 0);
    place(ctx.g, 0, h0.x, h0.y);
    step(ctx, [{ e: true }]);
    expect(it.holders).toEqual([0, null]);
    expect(it.state).toBe('idle');
    // Seul, il ne bouge pas.
    const x0 = it.x;
    step(ctx, [{ x: -1 }], 20);
    expect(it.x).toBe(x0);
    expect(ctx.g.players[0].x).toBeCloseTo(h0.x);
    // Le partenaire ne peut pas prendre la même poignée.
    place(ctx.g, 1, h0.x, h0.y + 4);
    step(ctx, [{}, { e: true }]);
    expect(it.holders[1]).toBeNull();
  });

  it('immobile si un seul pousse ou si les directions s’opposent, avance si coordonné', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    const it = grab(ctx, 'safe');
    expect(it.state).toBe('carried');
    const start = { x: it.x, y: it.y };

    step(ctx, [{ x: -1 }, {}], 15);
    expect(it.x).toBe(start.x);
    expect(it.push).toBe('wait');

    step(ctx, [{ x: -1 }, { x: 1 }], 15);
    expect(it.x).toBe(start.x);
    expect(it.push).toBe('opposed');

    step(ctx, [{ x: -1 }, { x: -1 }], 15);
    expect(it.x).toBeLessThan(start.x - 30);
    expect(it.push).toBe('moving');
    // Les porteurs restent attachés aux points de prise.
    expect(ctx.g.players[0].x).toBeCloseTo(handlePos(it.x, it.y, it.def, 0).x);
    expect(ctx.g.players[1].x).toBeCloseTo(handlePos(it.x, it.y, it.def, 1).x);
  });

  it('ne traverse pas les murs', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    const it = grab(ctx, 'safe');
    // Vers le haut : le mur entre bureau et chambre (le coffre est trop à gauche de la porte).
    for (let i = 0; i < 150; i++) {
      step(ctx, [{ y: -1 }, { y: -1 }]);
      assertClear(it);
    }
    expect(it.y).toBeGreaterThan(354 + 8);
    expect(it.push).toBe('blocked');
  });

  it('lâcher ou être attrapé repose l’objet', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    const it = grab(ctx, 'clock');
    step(ctx, [{}, { drop: true }]);
    expect(it.state).toBe('idle');
    expect(ctx.g.players[0].carry).toBeNull();
    expect(ctx.g.players[1].carry).toBeNull();

    const it2 = grab(ctx, 'clock');
    expect(it2.state).toBe('carried');
    ctx.g.capture(ctx.g.players[0]);
    expect(it2.state).toBe('idle');
    expect(ctx.g.players[1].carry).toBeNull();
  });

  it('l’horloge peut aller de la chambre au camion', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    const it = grab(ctx, 'clock');
    push(ctx, it, 0, -1, () => it.y <= 176);
    push(ctx, it, -1, 0, () => it.x <= 730);
    push(ctx, it, 0, -1, () => it.y <= 130);
    push(ctx, it, -1, 0, () => it.x <= 460);
    push(ctx, it, 0, 1, () => it.y >= 200);
    push(ctx, it, -1, 0, () => it.x <= 268);
    push(ctx, it, 0, 1, () => it.state === 'delivered');
    expect(ctx.g.loot).toBe(600);
    expect(ctx.g.players[0].carry).toBeNull();
    expect(ctx.g.players[1].carry).toBeNull();
  });

  it('le coffre-fort peut aller du bureau au camion', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    const it = grab(ctx, 'safe');
    push(ctx, it, 0, -1, () => it.y <= 526);
    push(ctx, it, -1, 0, () => it.x <= 720);
    push(ctx, it, 0, -1, () => it.y <= 440);
    push(ctx, it, -1, 0, () => it.x <= 420);
    push(ctx, it, 0, 1, () => it.y >= 470);
    push(ctx, it, -1, 0, () => it.x <= 268);
    push(ctx, it, 0, 1, () => it.state === 'delivered');
    expect(ctx.g.loot).toBe(800);
    expect(ctx.g.delivered).toBe(1);
  });
});

describe('gardien, détention et libération', () => {
  it('attrape un joueur : il lâche son objet et part au cabanon', () => {
    const ctx = setup();
    const { g } = ctx;
    const c = item(g, 'console');
    place(g, 0, c.x, c.y + 20);
    step(ctx, [{ e: true }]);
    expect(g.players[0].carry).not.toBeNull();
    g.guard.x = g.players[0].x + 20;
    g.guard.y = g.players[0].y;
    const at = { x: g.players[0].x, y: g.players[0].y };
    step(ctx);
    const p = g.players[0];
    expect(p.jailed).toBe(true);
    expect(p.carry).toBeNull();
    expect(c.state).toBe('idle');
    expect(c.x).toBeCloseTo(at.x, 0);
    expect(p.x).toBe(JAIL.cells[0].x);
  });

  it('le cabanon est fermé et le partenaire libère en maintenant E deux secondes', () => {
    const ctx = setup();
    const { g } = ctx;
    parkGuard(g);
    g.capture(g.players[0]);
    // Impossible de sortir seul.
    step(ctx, [{ y: 1 }], 60);
    expect(g.players[0].jailed).toBe(true);
    expect(g.players[0].y).toBeLessThan(JAIL.outer.y + JAIL.outer.h);

    place(g, 1, JAIL.lock.x, JAIL.lock.y + 10);
    step(ctx, [{}, { e: true }], 30); // 1 s
    expect(g.players[0].jailed).toBe(true);
    expect(g.freeProgress).toBeGreaterThan(0.9);
    // Relâcher remet la progression à zéro.
    step(ctx, [{}, { e: false }]);
    expect(g.freeProgress).toBe(0);
    step(ctx, [{}, { e: true }], 62);
    expect(g.players[0].jailed).toBe(false);
    expect(g.players[0].y).toBeGreaterThan(JAIL.outer.y + JAIL.outer.h);
  });

  it('les deux enfermés : partie perdue', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    ctx.g.capture(ctx.g.players[0]);
    ctx.g.capture(ctx.g.players[1]);
    step(ctx);
    expect(ctx.g.phase).toBe('ended');
    expect(ctx.g.result?.outcome).toBe('caught');
  });

  it('repère un joueur visible, le poursuit puis abandonne', () => {
    const ctx = setup();
    const { g } = ctx;
    // Gardien dans le salon regardant vers la droite, joueur devant lui.
    g.guard.x = 450;
    g.guard.y = 460;
    g.guard.angle = 0;
    place(g, 0, 580, 460);
    for (let i = 0; i < 30 && g.guard.state !== 'chase'; i++) step(ctx);
    expect(g.guard.state).toBe('chase');
    // Le joueur disparaît dans le jardin, hors de vue.
    place(g, 0, 60, 640);
    place(g, 1, 100, 300);
    for (let i = 0; i < 30 * 8 && g.guard.state === 'chase'; i++) step(ctx);
    expect(['search', 'patrol']).toContain(g.guard.state);
  });

  it('ne voit pas à travers les murs', () => {
    const ctx = setup();
    const { g } = ctx;
    // Gardien dans la cuisine regardant vers le bas, joueur juste derrière la cloison, dans le salon.
    g.guard.x = 420;
    g.guard.y = 300;
    g.guard.angle = Math.PI / 2;
    place(g, 0, 420, 400);
    expect(g.guard.sees(g.players[0])).toBe(false);
    place(g, 0, 420, 340);
    expect(g.guard.sees(g.players[0])).toBe(true);
  });
});

describe('caméra et interrupteur', () => {
  it('détecte un joueur et envoie le gardien enquêter', () => {
    const ctx = setup();
    const { g } = ctx;
    g.drainEvents();
    place(g, 0, CAMERA.x + 10, CAMERA.y + 110);
    step(ctx);
    const ev = g.drainEvents();
    expect(ev.some((e) => e.type === 'cameraAlert')).toBe(true);
    expect(g.guard.state).toBe('investigate');
  });

  it('reste aveugle tant que le partenaire maintient l’interrupteur', () => {
    const ctx = setup();
    const { g } = ctx;
    g.drainEvents();
    place(g, 1, SWITCH_POS.x - 10, SWITCH_POS.y);
    place(g, 0, CAMERA.x + 10, CAMERA.y + 110);
    step(ctx, [{}, { e: true }], 10);
    expect(g.cameraEnabled).toBe(false);
    expect(g.drainEvents().some((e) => e.type === 'cameraAlert')).toBe(false);
    expect(g.guard.state).toBe('patrol');
    // Relâcher réactive la caméra.
    step(ctx, [{}, { e: false }]);
    expect(g.cameraEnabled).toBe(true);
  });

  it('les murs bloquent la vue de la caméra', () => {
    const ctx = setup();
    const { g } = ctx;
    g.drainEvents();
    // Juste derrière le mur de façade, dans l'axe de la caméra.
    place(g, 0, 300, 560);
    step(ctx);
    expect(g.drainEvents().some((e) => e.type === 'cameraAlert')).toBe(false);
  });
});

describe('fin de partie', () => {
  it('départ anticipé quand les deux confirment au camion', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    step(ctx, [{ e: true }, {}]);
    expect(ctx.g.players[0].leave).toBe(true);
    expect(ctx.g.phase).toBe('playing');
    step(ctx, [{ e: false }, { e: true }]);
    expect(ctx.g.phase).toBe('ended');
    expect(ctx.g.result?.outcome).toBe('escaped_empty');
  });

  it('quitter la zone annule la confirmation', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    step(ctx, [{ e: true }]);
    step(ctx, [{ y: -1 }], 40);
    expect(ctx.g.players[0].leave).toBe(false);
  });

  it('fin du chrono : réussite si les deux sont au camion', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    ctx.g.loot = 350;
    ctx.g.timeLeft = 0.01;
    step(ctx);
    expect(ctx.g.result?.outcome).toBe('escaped');
  });

  it('fin du chrono : échec si un joueur est loin du camion', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    place(ctx.g, 1, 600, 120);
    ctx.g.timeLeft = 0.01;
    step(ctx);
    expect(ctx.g.result?.outcome).toBe('timeout');
  });

  it('une nouvelle partie repart de zéro', () => {
    const g = new Game();
    expect(g.timeLeft).toBe(DUPONT.duration);
    expect(g.loot).toBe(0);
    expect(g.items.every((i) => i.state === 'idle')).toBe(true);
    expect(g.players.every((p) => !p.jailed && !p.carry)).toBe(true);
  });

  it('la pause gèle le chrono et reprend par un décompte', () => {
    const ctx = setup();
    parkGuard(ctx.g);
    step(ctx, [], 10);
    const t = ctx.g.timeLeft;
    ctx.g.pause();
    for (let i = 0; i < 100; i++) ctx.g.tick(INPUT_DT);
    expect(ctx.g.timeLeft).toBe(t);
    ctx.g.resume();
    expect(ctx.g.phase).toBe('countdown');
  });
});

/**
 * Un gros objet peut-il aller jusqu'au camion ? Recherche en largeur sur une grille fine,
 * avec les mêmes règles de collision que le jeu (toutes les portes ouvertes).
 * duo : les deux poignées doivent passer ; solo : une seule (la meilleure des deux).
 */
function bigItemCanReachTruck(level: Level, id: string, handles: (0 | 1)[]): boolean {
  const d = level.itemById[id];
  const obstacles = level.staticObstacles;
  const ok = (x: number, y: number) =>
    !rectHitsAny(bigItemRect(x, y, d), obstacles) &&
    handles.every((h) => {
      const p = handlePos(x, y, d, h);
      return !circleHitsAny(p.x, p.y, PLAYER_RADIUS, obstacles);
    });
  const STEP = 4;
  const seen = new Set<string>();
  const queue: [number, number][] = [[d.x, d.y]];
  seen.add(`${d.x},${d.y}`);
  while (queue.length) {
    const [x, y] = queue.shift()!;
    if (inTruckZone({ x, y })) return true;
    for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nx = x + dx;
      const ny = y + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key) || !ok(nx, ny)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return false;
}

describe.each(LEVELS.map((l) => [l.name, l] as const))('carte : %s', (_, level) => {
  const closed = level.gates.map((g) => g.rect);

  it('chaque gardien peut faire sa ronde, portes verrouillées fermées', () => {
    const nav = new NavGrid(level.staticObstacles, 14);
    level.patrols.forEach((patrol, gi) => {
      for (let i = 0; i < patrol.length; i++) {
        const a = patrol[i];
        const b = patrol[(i + 1) % patrol.length];
        expect(nav.findPath(a, b, closed).length, `gardien ${gi}, segment ${i}`).toBeGreaterThan(0);
      }
    });
  });

  it('objets, papiers et digicodes sont accessibles (une fois les portes ouvertes)', () => {
    const nav = new NavGrid(level.staticObstacles, PLAYER_RADIUS);
    const from = { x: 268, y: 620 };
    for (const it of level.items.filter((i) => i.kind === 'small')) {
      expect(nav.findPath(from, it).length, it.id).toBeGreaterThan(0);
    }
    for (const g of level.gates) {
      if (g.lock.type === 'plate') {
        const p = g.lock.plate;
        expect(nav.findPath(from, { x: p.x + p.w / 2, y: p.y + p.h / 2 }, closed).length, `plaque ${g.id}`).toBeGreaterThan(0);
        continue;
      }
      // Le digicode doit être atteignable sans ouvrir sa propre porte.
      expect(nav.findPath(from, g.lock.keypad, closed.filter((r) => r !== g.rect)).length, `digicode ${g.id}`).toBeGreaterThan(0);
      g.lock.notes.forEach((n, i) => expect(nav.findPath(from, n).length, `papier ${g.id}/${i}`).toBeGreaterThan(0));
    }
  });

  it('les points de prise des gros objets sont libres', () => {
    for (const d of level.items.filter((i) => i.kind === 'big')) {
      for (const h of [0, 1] as const) {
        const p = handlePos(d.x, d.y, d, h);
        expect(circleHitsAny(p.x, p.y, PLAYER_RADIUS, level.staticObstacles), `${d.id}/${h}`).toBe(false);
      }
    }
  });

  it('chaque gros objet peut aller jusqu’au camion, à deux comme en solo', () => {
    for (const d of level.items.filter((i) => i.kind === 'big')) {
      expect(bigItemCanReachTruck(level, d.id, [0, 1]), `${d.id} à deux`).toBe(true);
      expect(bigItemCanReachTruck(level, d.id, [0]) || bigItemCanReachTruck(level, d.id, [1]), `${d.id} en solo`).toBe(true);
    }
  });
});

describe('mode solo', () => {
  it('un seul cambrioleur, les commandes d’un second siège sont ignorées', () => {
    const ctx = setup({ solo: true });
    expect(ctx.g.players).toHaveLength(1);
    step(ctx, [{ x: 1 }, { x: 1 }], 5);
    const snap = ctx.g.snapshot(0, []);
    expect(snap.solo).toBe(true);
    expect(snap.players).toHaveLength(1);
  });

  it('porte seul un gros objet, plus lentement, jusqu’au camion', () => {
    const ctx = setup({ solo: true });
    const { g } = ctx;
    parkGuard(g);
    const it = item(g, 'clock');
    const h = handlePos(it.x, it.y, it.def, 0);
    place(g, 0, h.x, h.y);
    step(ctx, [{ e: true }]);
    step(ctx);
    expect(it.state).toBe('carried');
    const y0 = it.y;
    step(ctx, [{ y: -1 }], 30);
    expect(y0 - it.y).toBeGreaterThan(SOLO_BIG_SPEED * 0.8);
    expect(y0 - it.y).toBeLessThan(CARRY_BIG_SPEED * 0.8);

    const go = (x: number, y: number, until: () => boolean) => {
      for (let i = 0; i < 900 && !until(); i++) step(ctx, [{ x, y }]);
      expect(until()).toBe(true);
    };
    go(0, -1, () => it.y <= 176);
    go(-1, 0, () => it.x <= 730);
    go(0, -1, () => it.y <= 130);
    go(-1, 0, () => it.x <= 460);
    go(0, 1, () => it.y >= 200);
    go(-1, 0, () => it.x <= 268);
    go(0, 1, () => it.state === 'delivered');
    expect(g.loot).toBe(600);
    expect(g.players[0].carry).toBeNull();
  });

  it('attrapé : s’évade seul du cabanon après le délai, sans perdre la partie', () => {
    const ctx = setup({ solo: true });
    const { g } = ctx;
    parkGuard(g);
    g.capture(g.players[0]);
    step(ctx, [], Math.round((SOLO_JAIL_TIME - 0.5) / INPUT_DT));
    expect(g.phase).toBe('playing');
    expect(g.players[0].jailed).toBe(true);
    expect(g.freeProgress).toBeGreaterThan(0.9);
    step(ctx, [], Math.round(1 / INPUT_DT));
    expect(g.players[0].jailed).toBe(false);
    expect(g.players[0].y).toBeGreaterThan(JAIL.outer.y + JAIL.outer.h);
  });

  it('un appui sur l’interrupteur coupe la caméra quelques secondes', () => {
    const ctx = setup({ solo: true });
    const { g } = ctx;
    parkGuard(g);
    place(g, 0, SWITCH_POS.x - 10, SWITCH_POS.y);
    step(ctx, [{ e: true }]);
    step(ctx, [{ e: false }], Math.round((SOLO_CAMERA_OFF_TIME - 0.5) / INPUT_DT));
    expect(g.cameraEnabled).toBe(false);
    step(ctx, [], Math.round(1 / INPUT_DT));
    expect(g.cameraEnabled).toBe(true);
  });

  it('part seul avec E au camion', () => {
    const ctx = setup({ solo: true });
    const { g } = ctx;
    parkGuard(g);
    place(g, 0, TRUCK_ZONE.x + TRUCK_ZONE.w / 2, TRUCK_ZONE.y + TRUCK_ZONE.h / 2);
    step(ctx, [{ e: true }]);
    expect(g.phase).toBe('ended');
    expect(g.result?.outcome).toBe('escaped_empty');
  });
});

describe('porte à code et indices (villa)', () => {
  const villa = LEVEL_BY_ID.villa;
  const gate = villa.gates[0];
  if (gate.lock.type !== 'code') throw new Error('porte à code attendue');
  const lock = gate.lock;

  it('bloque le passage tant que le code n’est pas trouvé', () => {
    const ctx = setup({ level: 'villa' });
    parkGuards(ctx.g);
    place(ctx.g, 0, 850, 590);
    step(ctx, [{ x: 1 }], 60);
    expect(ctx.g.players[0].x).toBeLessThanOrEqual(gate.rect.x - PLAYER_RADIUS + 0.01);
  });

  it('chacun ne voit que les indices qu’il a lus lui-même', () => {
    const ctx = setup({ level: 'villa' });
    parkGuards(ctx.g);
    place(ctx.g, 0, lock.notes[0].x, lock.notes[0].y + 10);
    step(ctx, [{ e: true }]);
    const mine = ctx.g.snapshot(0, []).clues;
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain(ctx.g.gates[0].code![0]);
    expect(ctx.g.snapshot(1, []).clues).toHaveLength(0);
  });

  it('un mauvais code alerte le gardien, le bon ouvre la porte (avec un délai entre deux essais)', () => {
    const ctx = setup({ level: 'villa' });
    const { g } = ctx;
    const code = g.gates[0].code!;
    const wrong = code === '000' ? '111' : '000';
    place(g, 0, lock.keypad.x - 8, lock.keypad.y + 12);
    g.drainEvents();
    expect(g.submitCode(0, 'bureau', wrong)).toBe(false);
    expect(g.drainEvents().some((e) => e.type === 'codeWrong')).toBe(true);
    expect(g.guard.state).toBe('investigate');

    // Trop tôt : refusé même avec le bon code.
    expect(g.submitCode(0, 'bureau', code)).toBe(false);
    parkGuards(g);
    step(ctx, [], Math.ceil(KEYPAD_COOLDOWN / INPUT_DT) + 1);
    // Trop loin du digicode : refusé.
    place(g, 1, 400, 600);
    expect(g.submitCode(1, 'bureau', code)).toBe(false);
    expect(g.submitCode(0, 'bureau', code)).toBe(true);
    expect(g.gates[0].open).toBe(true);

    place(g, 0, 850, 590);
    step(ctx, [{ x: 1 }], 30);
    expect(g.players[0].x).toBeGreaterThan(gate.rect.x + gate.rect.w);
  });
});

describe('grille à plaque de pression (musée)', () => {
  const musee = LEVEL_BY_ID.musee;
  const gate = musee.gates.find((x) => x.id === 'bijoux')!;
  if (gate.lock.type !== 'plate') throw new Error('plaque attendue');
  const plate = gate.lock.plate;
  const center = { x: plate.x + plate.w / 2, y: plate.y + plate.h / 2 };
  const isOpen = (g: Game) => g.gates.find((x) => x.id === 'bijoux')!.open;

  it('ouverte tant que quelqu’un est sur la plaque', () => {
    const ctx = setup({ level: 'musee' });
    parkGuards(ctx.g);
    expect(isOpen(ctx.g)).toBe(false);
    place(ctx.g, 0, center.x, center.y);
    step(ctx);
    expect(isOpen(ctx.g)).toBe(true);
    place(ctx.g, 0, center.x, center.y - 120);
    step(ctx);
    expect(isOpen(ctx.g)).toBe(false);
  });

  it('ne se referme pas sur un joueur dans l’embrasure', () => {
    const ctx = setup({ level: 'musee' });
    parkGuards(ctx.g);
    place(ctx.g, 0, center.x, center.y);
    step(ctx);
    place(ctx.g, 1, gate.rect.x + gate.rect.w / 2, gate.rect.y + gate.rect.h / 2);
    place(ctx.g, 0, center.x, center.y - 120);
    step(ctx);
    expect(isOpen(ctx.g)).toBe(true);
    place(ctx.g, 1, 1100, 160);
    step(ctx);
    expect(isOpen(ctx.g)).toBe(false);
  });

  it('un objet lourd posé sur la plaque la maintient (astuce du solo)', () => {
    const ctx = setup({ level: 'musee', solo: true });
    parkGuards(ctx.g);
    const statue = item(ctx.g, 'statue');
    statue.x = center.x;
    statue.y = center.y;
    step(ctx);
    expect(isOpen(ctx.g)).toBe(true);
  });
});

describe('lasers (musée)', () => {
  const laser = LEVEL_BY_ID.musee.lasers[0];

  /** Avance jusqu'à ce que le premier laser soit allumé. */
  function untilOn(ctx: ReturnType<typeof setup>) {
    for (let i = 0; i < 200 && !ctx.g.snapshot(0, []).lasers[0]; i++) step(ctx);
    expect(ctx.g.snapshot(0, []).lasers[0]).toBe(true);
  }

  it('toucher un laser allumé déclenche l’alarme et attire un gardien', () => {
    const ctx = setup({ level: 'musee' });
    const { g } = ctx;
    place(g, 1, 300, 600);
    untilOn(ctx);
    g.drainEvents();
    place(g, 0, laser.a.x, 260);
    step(ctx);
    expect(g.drainEvents().some((e) => e.type === 'laser')).toBe(true);
    expect(g.guards.some((gd) => gd.state === 'investigate')).toBe(true);
  });

  it('le boîtier électrique coupe aussi les lasers', () => {
    const ctx = setup({ level: 'musee' });
    const { g } = ctx;
    parkGuards(g);
    place(g, 1, SWITCH_POS.x - 10, SWITCH_POS.y);
    untilOn(ctx);
    g.drainEvents();
    place(g, 0, laser.a.x, 260);
    step(ctx, [{}, { e: true }], 10);
    expect(g.snapshot(0, []).lasers.every((on) => !on)).toBe(true);
    expect(g.drainEvents().some((e) => e.type === 'laser')).toBe(false);
  });
});

describe('niveaux', () => {
  it('le musée a deux gardiens qui patrouillent', () => {
    const ctx = setup({ level: 'musee' });
    expect(ctx.g.snapshot(0, []).guards).toHaveLength(2);
    expect(ctx.g.result).toBeNull();
    const starts = ctx.g.guards.map((gd) => ({ x: gd.x, y: gd.y }));
    step(ctx, [], 60);
    ctx.g.guards.forEach((gd, i) => expect(Math.hypot(gd.x - starts[i].x, gd.y - starts[i].y)).toBeGreaterThan(20));
  });

  it('un niveau inconnu retombe sur le premier', () => {
    expect(new Game({ level: 'nimporte' }).level.id).toBe('dupont');
  });

  it('les énigmes du musée donnent un code cohérent', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const { code, clues } = makePuzzle('riddle', 4, rand);
      const [d1, d2, d3, d4] = [...code].map(Number);
      expect(code).toMatch(/^[0-9]{4}$/);
      expect(clues).toHaveLength(4);
      expect(clues[0]).toContain(String(d1));
      expect(d3).toBe(d2 - d1);
      expect(d4).toBe(d1 * 2);
      expect(clues[1]).toContain(String(d2 - d1));
    }
  });
});
