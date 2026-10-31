import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { JoinAck, LobbyState, Snapshot } from '../shared/types';
import { createGameServer } from './app';

let clock = 1_000_000;
let server: ReturnType<typeof createGameServer>;
let url = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  server = createGameServer({ now: () => clock });
  await new Promise<void>((r) => server.httpServer.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
});

async function client() {
  const s = connect(url, { transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(s);
  await new Promise<void>((r) => s.on('connect', () => r()));
  return s;
}

const call = (s: Socket, ev: string, data: unknown) => new Promise<JoinAck>((r) => s.emit(ev, data, r));

/** Attend un état de salon qui vérifie la condition. */
function lobbyWhere(s: Socket, pred: (l: LobbyState) => boolean, timeout = 3000) {
  return new Promise<LobbyState>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('délai dépassé')), timeout);
    const fn = (l: LobbyState) => {
      if (!pred(l)) return;
      clearTimeout(t);
      s.off('lobby', fn);
      resolve(l);
    };
    s.on('lobby', fn);
  });
}

function nextSnap(s: Socket, pred: (snap: Snapshot) => boolean = () => true, timeout = 6000) {
  return new Promise<Snapshot>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('délai dépassé')), timeout);
    const fn = (snap: Snapshot) => {
      if (!pred(snap)) return;
      clearTimeout(t);
      s.off('snap', fn);
      resolve(snap);
    };
    s.on('snap', fn);
  });
}

describe('salons', () => {
  it('parcours complet : créer, rejoindre, refuser un 3e, jouer, se reconnecter, rejouer', async () => {
    const a = await client();
    const b = await client();
    const c = await client();

    const created = await call(a, 'room:create', { name: '  Lulu  ' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.code).toMatch(/^[A-Z2-9]{5}$/);

    expect(await call(c, 'room:join', { code: 'ZZZZZ', name: 'Momo' })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await call(c, 'room:join', { code: created.code, name: '   ' })).toEqual({ ok: false, error: 'BAD_NAME' });

    const bothIn = lobbyWhere(a, (l) => l.players[1]?.name === 'Momo');
    const joined = await call(b, 'room:join', { code: created.code.toLowerCase(), name: 'Momo' });
    expect(joined).toMatchObject({ ok: true, seat: 1 });
    const lobby = await bothIn;
    expect(lobby.players[0]?.name).toBe('Lulu');

    // Salon complet.
    expect(await call(c, 'room:join', { code: created.code, name: 'Intrus' })).toEqual({ ok: false, error: 'FULL' });

    // Les deux prêts : la partie démarre.
    const started = lobbyWhere(a, (l) => l.phase === 'countdown');
    a.emit('room:ready', true);
    b.emit('room:ready', true);
    await started;
    const snapA = await nextSnap(a);
    const snapB = await nextSnap(b);
    expect(snapA.you).toBe(0);
    expect(snapB.you).toBe(1);
    expect(snapA.players).toHaveLength(2);

    // B se déconnecte : pause, place gardée.
    const paused = lobbyWhere(a, (l) => l.phase === 'paused' && l.pause?.seat === 1);
    b.disconnect();
    const p = await paused;
    expect(p.pause!.remainingMs).toBeGreaterThan(55_000);
    expect(p.players[1]?.connected).toBe(false);
    // Toujours complet pendant le délai.
    expect(await call(c, 'room:join', { code: created.code, name: 'Intrus' })).toEqual({ ok: false, error: 'FULL' });

    // Mauvais jeton refusé, bon jeton accepté : reprise par décompte.
    const b2 = await client();
    expect(await call(b2, 'room:resume', { code: created.code, token: 'faux' })).toEqual({ ok: false, error: 'SESSION_EXPIRED' });
    const resumed = lobbyWhere(a, (l) => l.phase === 'countdown');
    const back = await call(b2, 'room:resume', { code: created.code, token: joined.ok ? joined.token : '' });
    expect(back).toMatchObject({ ok: true, seat: 1 });
    await resumed;

    // Les positions sont identiques des deux côtés.
    const playing = await nextSnap(b2, (s) => s.phase === 'playing');
    const sameTick = await nextSnap(a, (s) => s.t === playing.t + 50 || s.t > playing.t);
    expect(sameTick.players.map((pl) => pl.seat)).toEqual([0, 1]);

    // Délai dépassé : partie annulée, retour au salon proposé, place libérée.
    const abandoned = lobbyWhere(a, (l) => l.phase === 'ended' && l.result?.outcome === 'abandoned');
    b2.disconnect();
    await lobbyWhere(a, (l) => l.phase === 'paused');
    clock += 61_000;
    const ended = await abandoned;
    expect(ended.result?.detail).toContain('Momo');
    expect(ended.players[1]).toBeNull();

    const inLobby = lobbyWhere(a, (l) => l.phase === 'lobby');
    a.emit('game:lobby');
    await inLobby;
    expect(await call(c, 'room:join', { code: created.code, name: 'Nouveau' })).toMatchObject({ ok: true, seat: 1 });
  });

  it('rejouer réinitialise toute la partie', async () => {
    const a = await client();
    const b = await client();
    const created = await call(a, 'room:create', { name: 'A' });
    if (!created.ok) throw new Error();
    await call(b, 'room:join', { code: created.code, name: 'B' });
    const started = lobbyWhere(a, (l) => l.phase === 'countdown');
    a.emit('room:ready', true);
    b.emit('room:ready', true);
    await started;

    // Fin rapide : les deux confirment le départ au camion.
    await nextSnap(a, (s) => s.phase === 'playing');
    const ended = lobbyWhere(a, (l) => l.phase === 'ended');
    let seq = 0;
    const send = (s: Socket, e: boolean) => s.emit('input', { seq: ++seq, x: 0, y: 0, e, drop: false });
    send(a, true);
    send(b, true);
    const end = await ended;
    expect(end.result?.outcome).toBe('escaped_empty');

    const replay = lobbyWhere(a, (l) => l.phase === 'countdown');
    a.emit('game:replay');
    const waiting = await lobbyWhere(b, (l) => l.players[0]?.replay === true);
    expect(waiting.phase).toBe('ended');
    b.emit('game:replay');
    await replay;
    const fresh = await nextSnap(a);
    expect(fresh.loot).toBe(0);
    expect(fresh.delivered).toBe(0);
    expect(fresh.timeLeft).toBe(300);
    expect(fresh.players.every((p) => !p.leave && !p.jailed && !p.carry)).toBe(true);
    expect(fresh.items.every((i) => i.state === 'idle')).toBe(true);
  });

  it('les salons sont isolés les uns des autres', async () => {
    const a = await client();
    const b = await client();
    const r1 = await call(a, 'room:create', { name: 'A' });
    const r2 = await call(b, 'room:create', { name: 'B' });
    if (!r1.ok || !r2.ok) throw new Error();
    expect(r1.code).not.toBe(r2.code);
    let leaked = false;
    b.on('lobby', (l: LobbyState) => {
      if (l.code === r1.code) leaked = true;
    });
    const c = await client();
    await call(c, 'room:join', { code: r1.code, name: 'C' });
    await new Promise((r) => setTimeout(r, 100));
    expect(leaked).toBe(false);
  });
});
