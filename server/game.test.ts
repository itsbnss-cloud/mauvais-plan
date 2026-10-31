import { describe, expect, it } from 'vitest';
import { COUNTDOWN, GAME_DURATION, INPUT_DT, PLAYER_RADIUS } from '../shared/constants';
import { circleHitsAny, rectHitsAny } from '../shared/geometry';
import { CAMERA, GUARD_PATROL, ITEMS, JAIL, STATIC_OBSTACLES, SWITCH_POS, TRUCK_ZONE, bigItemRect, handlePos } from '../shared/map';
import type { InputCmd, Seat } from '../shared/types';
import { Game } from './game';
import { NavGrid } from './nav';

type Cmd = Partial<Omit<InputCmd, 'seq'>>;

function setup() {
  const g = new Game();
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

function place(g: Game, seat: Seat, x: number, y: number) {
  g.players[seat].x = x;
  g.players[seat].y = y;
}

const item = (g: Game, id: string) => g.items.find((i) => i.id === id)!;
const def = (id: string) => ITEMS.find((i) => i.id === id)!;

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
    expect(g.timeLeft).toBe(GAME_DURATION);
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

describe('carte', () => {
  it('le gardien peut rejoindre chaque point de ronde', () => {
    const nav = new NavGrid(STATIC_OBSTACLES, 14);
    for (let i = 0; i < GUARD_PATROL.length; i++) {
      const a = GUARD_PATROL[i];
      const b = GUARD_PATROL[(i + 1) % GUARD_PATROL.length];
      expect(nav.findPath(a, b).length, `segment ${i}`).toBeGreaterThan(0);
    }
  });

  it('chaque petit objet est accessible depuis le camion', () => {
    const nav = new NavGrid(STATIC_OBSTACLES, PLAYER_RADIUS);
    for (const it of ITEMS.filter((i) => i.kind === 'small')) {
      expect(nav.findPath({ x: 268, y: 620 }, { x: it.x, y: it.y }).length, it.id).toBeGreaterThan(0);
    }
  });

  it('les points de prise des gros objets sont libres', () => {
    for (const id of ['clock', 'safe']) {
      const d = def(id);
      for (const h of [0, 1] as const) {
        const p = handlePos(d.x, d.y, d, h);
        expect(circleHitsAny(p.x, p.y, PLAYER_RADIUS, STATIC_OBSTACLES), `${id}/${h}`).toBe(false);
      }
    }
  });
});
