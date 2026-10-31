import { randomInt, randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { MAX_NAME_LENGTH, RECONNECT_GRACE_MS, SNAPSHOT_RATE } from '../shared/constants';
import type { JoinAck, LobbyState, RoomPhase, Seat } from '../shared/types';
import { Game } from './game';

interface SeatInfo {
  token: string;
  name: string;
  socketId: string | null;
  ready: boolean;
  replay: boolean;
  disconnectedAt: number | null;
}

interface Room {
  code: string;
  seats: [SeatInfo | null, SeatInfo | null];
  game: Game | null;
  /** Partie à un seul joueur : pas de salon, pas d'invitation. */
  solo: boolean;
  createdAt: number;
  snapAcc: number;
  lastPhase: RoomPhase;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const MAX_ROOMS = 1000;
const ROOM_MAX_AGE_MS = 12 * 3600_000;
const SEATS: Seat[] = [0, 1];

type Ack = (res: JoinAck) => void;

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return name.length ? name : null;
}

export function normalizeCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : '';
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly io: Server,
    private readonly now: () => number = Date.now,
  ) {}

  // ───────────── Connexions ─────────────

  handle(socket: Socket) {
    const on = (event: string, fn: (...args: any[]) => void) =>
      socket.on(event, (...args: any[]) => {
        try {
          fn(...args);
        } catch (err) {
          console.error(`[${event}]`, err);
        }
      });

    const create = (solo: boolean) => (data: { name?: unknown }, ack: Ack) => {
      if (typeof ack !== 'function') return;
      if (!this.allow(socket.id)) return ack({ ok: false, error: 'RATE_LIMIT' });
      const name = cleanName(data?.name);
      if (!name) return ack({ ok: false, error: 'BAD_NAME' });
      if (this.rooms.size >= MAX_ROOMS) this.gc(true);
      const room: Room = {
        code: this.newCode(),
        seats: [null, null],
        game: null,
        solo,
        createdAt: this.now(),
        snapAcc: 0,
        lastPhase: 'lobby',
      };
      this.rooms.set(room.code, room);
      const token = this.takeSeat(socket, room, 0, name);
      ack({ ok: true, code: room.code, token, seat: 0 });
      // En solo, on saute le salon : la partie démarre tout de suite.
      if (solo) this.startGame(room);
      this.broadcastLobby(room);
    };
    on('room:create', create(false));
    on('room:solo', create(true));

    on('room:join', (data: { code?: unknown; name?: unknown }, ack: Ack) => {
      if (typeof ack !== 'function') return;
      if (!this.allow(socket.id)) return ack({ ok: false, error: 'RATE_LIMIT' });
      const name = cleanName(data?.name);
      if (!name) return ack({ ok: false, error: 'BAD_NAME' });
      const room = this.rooms.get(normalizeCode(data?.code));
      if (!room) return ack({ ok: false, error: 'NOT_FOUND' });
      if (room.solo) return ack({ ok: false, error: 'FULL' });
      const seat = SEATS.find((s) => room.seats[s] === null);
      // Siège libre mais partie en cours (abandonnée) : on attend le retour au salon.
      if (seat === undefined || (room.game && room.game.phase !== 'ended')) return ack({ ok: false, error: 'FULL' });
      if (room.game) room.game = null;
      const token = this.takeSeat(socket, room, seat, name);
      ack({ ok: true, code: room.code, token, seat });
      this.broadcastLobby(room);
    });

    on('room:resume', (data: { code?: unknown; token?: unknown }, ack: Ack) => {
      if (typeof ack !== 'function') return;
      const room = this.rooms.get(normalizeCode(data?.code));
      const seat = room ? SEATS.find((s) => room.seats[s]?.token === data?.token) : undefined;
      if (!room || seat === undefined) return ack({ ok: false, error: 'SESSION_EXPIRED' });
      const info = room.seats[seat]!;
      if (info.socketId && info.socketId !== socket.id) {
        // La même session s'ouvre ailleurs (onglet dupliqué) : l'ancien est déconnecté.
        const old = this.io.sockets.sockets.get(info.socketId);
        old?.emit('kicked', 'Ta session a été reprise dans une autre fenêtre.');
        old?.leave(room.code);
        if (old) old.data = {};
      }
      this.detach(socket);
      info.socketId = socket.id;
      info.disconnectedAt = null;
      socket.join(room.code);
      socket.data = { code: room.code, seat };
      ack({ ok: true, code: room.code, token: info.token, seat });
      if (room.game?.phase === 'paused' && this.allConnected(room)) room.game.resume();
      this.broadcastLobby(room);
    });

    on('room:ready', (ready: unknown) => {
      const ctx = this.ctx(socket);
      if (!ctx || ctx.room.game) return;
      ctx.info.ready = ready === true;
      const { room } = ctx;
      if (!room.solo && SEATS.every((s) => room.seats[s]?.ready && room.seats[s]?.socketId)) this.startGame(room);
      this.broadcastLobby(room);
    });

    on('game:replay', () => {
      const ctx = this.ctx(socket);
      if (!ctx || ctx.room.game?.phase !== 'ended') return;
      ctx.info.replay = true;
      const { room } = ctx;
      if (this.activeSeats(room).every((s) => room.seats[s]?.replay && room.seats[s]?.socketId)) this.startGame(room);
      this.broadcastLobby(room);
    });

    on('game:lobby', () => {
      const ctx = this.ctx(socket);
      if (!ctx || ctx.room.solo || ctx.room.game?.phase !== 'ended') return;
      this.backToLobby(ctx.room);
    });

    on('room:leave', () => {
      const ctx = this.ctx(socket);
      if (!ctx) return;
      this.removeSeat(ctx.room, ctx.seat, `${ctx.info.name} a quitté la partie.`);
      socket.leave(ctx.room.code);
      socket.data = {};
    });

    on('input', (cmd: unknown) => {
      const ctx = this.ctx(socket);
      if (!ctx?.room.game || typeof cmd !== 'object' || cmd === null) return;
      ctx.room.game.pushInput(ctx.seat, cmd);
    });

    on('ping:t', (t: unknown, ack: (t: unknown) => void) => {
      if (typeof ack === 'function') ack(t);
    });

    socket.on('disconnect', () => {
      this.attempts.delete(socket.id);
      this.detach(socket);
    });
  }

  private ctx(socket: Socket) {
    const { code, seat } = (socket.data ?? {}) as { code?: string; seat?: Seat };
    if (!code || seat === undefined) return null;
    const room = this.rooms.get(code);
    const info = room?.seats[seat];
    if (!room || !info || info.socketId !== socket.id) return null;
    return { room, seat, info };
  }

  /** Le socket quitte son siège actuel sans le libérer (délai de reconnexion). */
  private detach(socket: Socket) {
    const ctx = this.ctx(socket);
    if (!ctx) return;
    ctx.info.socketId = null;
    ctx.info.disconnectedAt = this.now();
    ctx.info.ready = false;
    socket.leave(ctx.room.code);
    socket.data = {};
    ctx.room.game?.pause();
    this.broadcastLobby(ctx.room);
  }

  private takeSeat(socket: Socket, room: Room, seat: Seat, name: string): string {
    this.detach(socket);
    const token = randomUUID();
    room.seats[seat] = { token, name, socketId: socket.id, ready: false, replay: false, disconnectedAt: null };
    socket.join(room.code);
    socket.data = { code: room.code, seat };
    return token;
  }

  private allow(id: string): boolean {
    const t = this.now();
    const list = (this.attempts.get(id) ?? []).filter((x) => t - x < 10_000);
    list.push(t);
    this.attempts.set(id, list);
    return list.length <= 12;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private activeSeats(room: Room): Seat[] {
    return room.solo ? [0] : SEATS;
  }

  private allConnected(room: Room) {
    return this.activeSeats(room).every((s) => room.seats[s]?.socketId);
  }

  // ───────────── Cycle de vie des salons ─────────────

  private startGame(room: Room) {
    room.game = new Game({ solo: room.solo });
    room.snapAcc = 1;
    for (const s of SEATS) {
      const info = room.seats[s];
      if (info) info.replay = false;
    }
  }

  private backToLobby(room: Room) {
    room.game = null;
    for (const s of SEATS) {
      const info = room.seats[s];
      if (info) {
        info.ready = false;
        info.replay = false;
      }
    }
    this.broadcastLobby(room);
  }

  private removeSeat(room: Room, seat: Seat, reason: string) {
    room.seats[seat] = null;
    if (room.game && room.game.phase !== 'ended') room.game.abandon(reason);
    for (const s of SEATS) {
      const info = room.seats[s];
      if (info) {
        info.ready = false;
        info.replay = false;
      }
    }
    if (SEATS.every((s) => room.seats[s] === null)) {
      this.rooms.delete(room.code);
      return;
    }
    this.broadcastLobby(room);
  }

  lobbyState(room: Room, you: Seat): LobbyState {
    const t = this.now();
    let pause: LobbyState['pause'] = null;
    for (const s of SEATS) {
      const info = room.seats[s];
      if (info?.disconnectedAt != null) {
        pause = { seat: s, remainingMs: Math.max(0, RECONNECT_GRACE_MS - (t - info.disconnectedAt)) };
        break;
      }
    }
    return {
      code: room.code,
      phase: room.game ? room.game.phase : 'lobby',
      solo: room.solo,
      you,
      players: SEATS.map((s) => {
        const info = room.seats[s];
        return info ? { name: info.name, ready: info.ready, connected: info.socketId !== null, replay: info.replay } : null;
      }) as LobbyState['players'],
      pause,
      result: room.game?.result ?? null,
    };
  }

  private broadcastLobby(room: Room) {
    room.lastPhase = room.game ? room.game.phase : 'lobby';
    for (const s of SEATS) {
      const id = room.seats[s]?.socketId;
      if (id) this.io.to(id).emit('lobby', this.lobbyState(room, s));
    }
  }

  /** Avance toutes les parties d'un pas. */
  tick(dt: number) {
    const t = this.now();
    for (const room of this.rooms.values()) {
      for (const s of SEATS) {
        const info = room.seats[s];
        if (info?.disconnectedAt != null && t - info.disconnectedAt > RECONNECT_GRACE_MS) {
          this.removeSeat(room, s, `Pas de nouvelles de ${info.name} depuis 60 secondes : la partie est annulée.`);
        }
      }
      const game = room.game;
      if (!game || !this.rooms.has(room.code)) continue;
      game.tick(dt);
      const phase = game.phase;
      const phaseChanged = phase !== room.lastPhase;
      room.snapAcc += dt;
      if (phaseChanged || ((phase === 'playing' || phase === 'countdown') && room.snapAcc >= 1 / SNAPSHOT_RATE)) {
        room.snapAcc = 0;
        const events = game.drainEvents();
        for (const s of SEATS) {
          const id = room.seats[s]?.socketId;
          if (id) this.io.to(id).emit('snap', game.snapshot(s, events));
        }
      }
      if (phaseChanged) this.broadcastLobby(room);
    }
  }

  /** Supprime les salons trop anciens (ou vides). */
  gc(force = false) {
    const t = this.now();
    for (const room of this.rooms.values()) {
      const empty = SEATS.every((s) => !room.seats[s]?.socketId);
      if (t - room.createdAt > ROOM_MAX_AGE_MS || (force && empty)) {
        for (const s of SEATS) {
          const id = room.seats[s]?.socketId;
          if (id) this.io.to(id).emit('kicked', 'Ce salon a expiré.');
        }
        this.rooms.delete(room.code);
      }
    }
  }
}

