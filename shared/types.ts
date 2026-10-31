export type Seat = 0 | 1;

export type GamePhase = 'countdown' | 'playing' | 'paused' | 'ended';
export type RoomPhase = 'lobby' | GamePhase;

/** Commande envoyée par le client à chaque pas d'entrée (30 par seconde). */
export interface InputCmd {
  seq: number;
  /** Direction souhaitée, composantes dans [-1, 1]. */
  x: number;
  y: number;
  /** E maintenu (ou appuyé depuis la dernière commande). */
  e: boolean;
  /** Espace appuyé depuis la dernière commande. */
  drop: boolean;
}

export type Carry = null | { kind: 'small'; item: string } | { kind: 'big'; item: string; handle: 0 | 1 };

export type HoldAction = null | 'switch' | 'free';

export interface PlayerSnap {
  seat: Seat;
  x: number;
  y: number;
  angle: number;
  moving: boolean;
  carry: Carry;
  jailed: boolean;
  leave: boolean;
  hold: HoldAction;
}

export type ItemState = 'idle' | 'carried' | 'delivered';
/** État de poussée d'un gros objet porté. */
export type PushState = 'wait' | 'moving' | 'opposed' | 'blocked';

export interface ItemSnap {
  id: string;
  x: number;
  y: number;
  state: ItemState;
  /** Joueurs aux points de prise (gros objets). */
  holders: [Seat | null, Seat | null];
  carrier: Seat | null;
  push: PushState;
}

export type GuardState = 'patrol' | 'chase' | 'investigate' | 'search' | 'stunned';

export interface GuardSnap {
  x: number;
  y: number;
  angle: number;
  state: GuardState;
  suspicion: number;
  moving: boolean;
  /** Joueur poursuivi. */
  target: Seat | null;
}

export type GameEvent =
  | { type: 'pickup'; seat: Seat; item: string }
  | { type: 'grab'; seat: Seat; item: string }
  | { type: 'drop'; seat: Seat; item: string }
  | { type: 'deliver'; item: string; value: number; x: number; y: number }
  | { type: 'capture'; seat: Seat; x: number; y: number }
  | { type: 'freed'; seat: Seat }
  | { type: 'cameraAlert'; x: number; y: number }
  | { type: 'laser'; x: number; y: number }
  | { type: 'note'; seat: Seat; gate: string; index: number }
  | { type: 'codeOk'; seat: Seat; gate: string }
  | { type: 'codeWrong'; seat: Seat; gate: string }
  | { type: 'guardAlert'; seat: Seat }
  | { type: 'guardLost' }
  | { type: 'leave'; seat: Seat }
  | { type: 'denied'; seat: Seat; reason: string };

export type Outcome = 'escaped' | 'escaped_empty' | 'caught' | 'timeout' | 'abandoned';

export interface GameResult {
  outcome: Outcome;
  loot: number;
  delivered: number;
  total: number;
  /** Précision (ex. nom du joueur parti). */
  detail?: string;
}

export interface GateSnap {
  id: string;
  open: boolean;
}

/** Indice lu par ce joueur (chacun ne voit que les siens). */
export interface ClueSnap {
  gate: string;
  index: number;
  text: string;
}

export interface Snapshot {
  t: number;
  level: string;
  phase: GamePhase;
  solo: boolean;
  timeLeft: number;
  countdown: number;
  you: Seat;
  ack: number;
  players: PlayerSnap[];
  items: ItemSnap[];
  guards: GuardSnap[];
  gates: GateSnap[];
  /** Lasers allumés, dans l'ordre du niveau. */
  lasers: boolean[];
  clues: ClueSnap[];
  camera: { enabled: boolean; alarm: boolean };
  loot: number;
  delivered: number;
  /** Libération en cours (en solo : progression de l'évasion du cabanon). */
  freeProgress: number;
  /** Solo : secondes restantes de caméra coupée. */
  cameraOff: number;
  events: GameEvent[];
}

export interface LobbyPlayer {
  name: string;
  ready: boolean;
  connected: boolean;
  replay: boolean;
}

export interface LobbyState {
  code: string;
  phase: RoomPhase;
  solo: boolean;
  level: string;
  you: Seat;
  players: [LobbyPlayer | null, LobbyPlayer | null];
  /** Pause pour déconnexion : siège absent et temps restant (ms). */
  pause: { seat: Seat; remainingMs: number } | null;
  result: GameResult | null;
}

export type JoinError = 'NOT_FOUND' | 'FULL' | 'BAD_NAME' | 'SESSION_EXPIRED' | 'RATE_LIMIT';

export type JoinAck = { ok: true; code: string; token: string; seat: Seat } | { ok: false; error: JoinError };
