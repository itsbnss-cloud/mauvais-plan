import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { WORLD_H, WORLD_W } from '../../shared/constants';
import { ITEMS, ITEM_BY_ID } from '../../shared/map';
import type { GameResult, JoinAck, JoinError, LobbyState, RoomPhase, Seat, Snapshot } from '../../shared/types';
import { GameScene } from './game/GameScene';
import { ICON_SOUND_OFF, ICON_SOUND_ON, thiefSvg } from './portrait';
import { isMuted, sfx, toggleMute, unlockAudio } from './sfx';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ───────────── Session ─────────────

interface Session {
  code: string;
  token: string;
}

const SESSION_KEY = 'mp.session';
// sessionStorage : propre à chaque onglet (on peut tester à deux dans le même navigateur)
// et conservé lors d'un rafraîchissement.
function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* stockage indisponible */
  }
}

let session = loadSession();
let lobby: LobbyState | null = null;
let names: [string, string] = ['', ''];
let prevPhase: RoomPhase | null = null;

// ───────────── Réseau ─────────────

const socket = io({ reconnectionDelay: 500, reconnectionDelayMax: 3000 });

const ERRORS: Record<JoinError, string> = {
  NOT_FOUND: 'Aucune partie avec ce code. Vérifie les lettres et les chiffres.',
  FULL: 'Cette partie est déjà complète (deux joueurs maximum).',
  BAD_NAME: 'Choisis un pseudo (16 caractères maximum).',
  SESSION_EXPIRED: 'Ta partie précédente n’existe plus.',
  RATE_LIMIT: 'Doucement ! Réessaie dans quelques secondes.',
};

function request(event: string, data: unknown): Promise<JoinAck> {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'RATE_LIMIT' });
      return;
    }
    socket.timeout(6000).emit(event, data, (err: Error | null, res: JoinAck) => {
      resolve(err ? { ok: false, error: 'RATE_LIMIT' } : res);
    });
  });
}

function setBanner(text: string | null) {
  const el = $('conn-banner');
  el.textContent = text ?? '';
  el.classList.toggle('hidden', !text);
}

socket.on('connect', async () => {
  setBanner(null);
  if (!session) return;
  const res = await request('room:resume', session);
  if (!res.ok) {
    saveSession(null);
    showHome(ERRORS.SESSION_EXPIRED);
  }
});

socket.on('disconnect', () => {
  if (session) setBanner('Connexion perdue… reconnexion en cours');
  scene?.setInputEnabled(false);
});

socket.on('connect_error', () => {
  setBanner(session ? 'Connexion perdue… reconnexion en cours' : 'Impossible de joindre le serveur, nouvelle tentative…');
});

socket.on('kicked', (msg: string) => {
  saveSession(null);
  showHome(msg);
});

socket.on('lobby', (l: LobbyState) => applyLobby(l));
let lastSnap: Snapshot | null = null;
socket.on('snap', (s: Snapshot) => {
  lastSnap = s;
  if (lobby && lobby.phase !== 'lobby') scene?.pushSnapshot(s);
});
// Lecture seule, pour le débogage et les tests automatisés.
Object.assign(window, { __mp: { lobby: () => lobby, snap: () => lastSnap } });

// ───────────── Écrans ─────────────

type ScreenName = 'home' | 'lobby' | 'game';
function showScreen(name: ScreenName) {
  for (const n of ['home', 'lobby', 'game'] as ScreenName[]) $(`screen-${n}`).classList.toggle('hidden', n !== name);
  if (name === 'game') {
    phaser?.scale.refresh();
    scene?.setInputEnabled(true);
  } else {
    scene?.setInputEnabled(false);
  }
}

function showHome(error = '') {
  lobby = null;
  prevPhase = null;
  showScreen('home');
  $('home-error').textContent = error;
  const url = new URL(location.href);
  if (url.searchParams.has('code') && !error) return;
  url.searchParams.delete('code');
  history.replaceState(null, '', url);
}

// Accueil
const nameInput = $<HTMLInputElement>('name');
const codeInput = $<HTMLInputElement>('code');
$('home-portraits').innerHTML = thiefSvg(0) + thiefSvg(1);
try {
  nameInput.value = localStorage.getItem('mp.name') ?? '';
} catch {
  /* stockage indisponible */
}
const urlCode = new URL(location.href).searchParams.get('code');
if (urlCode) {
  codeInput.value = urlCode.toUpperCase().slice(0, 5);
  $('btn-join').classList.add('primary');
}

function readName(): string | null {
  const name = nameInput.value.trim();
  if (!name) {
    $('home-error').textContent = 'Choisis d’abord un pseudo.';
    nameInput.focus();
    return null;
  }
  try {
    localStorage.setItem('mp.name', name);
  } catch {
    /* stockage indisponible */
  }
  return name;
}

function enterRoom(res: JoinAck, solo = false) {
  if (!res.ok) {
    $('home-error').textContent = ERRORS[res.error];
    return;
  }
  session = { code: res.code, token: res.token };
  saveSession(session);
  // Pas de code dans l'adresse en solo : il n'y a personne à inviter.
  const url = new URL(location.href);
  if (solo) url.searchParams.delete('code');
  else url.searchParams.set('code', res.code);
  history.replaceState(null, '', url);
}

let busy = false;
async function withBusy(fn: () => Promise<void>) {
  if (busy) return;
  busy = true;
  try {
    await fn();
  } finally {
    busy = false;
  }
}

$('btn-create').addEventListener('click', () =>
  withBusy(async () => {
    unlockAudio();
    const name = readName();
    if (!name) return;
    $('home-error').textContent = '';
    enterRoom(await request('room:create', { name }));
  }),
);

$('btn-solo').addEventListener('click', () =>
  withBusy(async () => {
    unlockAudio();
    const name = readName();
    if (!name) return;
    $('home-error').textContent = '';
    enterRoom(await request('room:solo', { name }), true);
  }),
);

async function join() {
  unlockAudio();
  const name = readName();
  if (!name) return;
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 5) {
    $('home-error').textContent = 'Le code fait 5 caractères.';
    codeInput.focus();
    return;
  }
  $('home-error').textContent = '';
  enterRoom(await request('room:join', { code, name }));
}
$('btn-join').addEventListener('click', () => withBusy(join));
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && withBusy(join));
nameInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (codeInput.value.trim().length === 5) withBusy(join);
  else $('btn-create').click();
});

// Salon
$('btn-copy').addEventListener('click', async () => {
  const input = $<HTMLInputElement>('invite-link');
  const btn = $('btn-copy');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  btn.textContent = 'Copié !';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = 'Copier le lien';
    btn.classList.remove('copied');
  }, 1600);
});

$('btn-ready').addEventListener('click', () => {
  unlockAudio();
  if (!lobby) return;
  const me = lobby.players[lobby.you];
  socket.emit('room:ready', !me?.ready);
});

function leaveRoom() {
  socket.emit('room:leave');
  saveSession(null);
  session = null;
  showHome();
}
$('btn-leave').addEventListener('click', leaveRoom);

function fmtTime(sec: number) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let pauseDeadline = 0;

function renderLobby(l: LobbyState) {
  $('lobby-code').textContent = l.code;
  const link = `${location.origin}${location.pathname}?code=${l.code}`;
  $<HTMLInputElement>('invite-link').value = link;

  for (const seat of [0, 1] as Seat[]) {
    const el = $(`seat-${seat}`);
    const p = l.players[seat];
    el.className = 'seat';
    el.replaceChildren();
    if (!p) {
      el.classList.add('empty');
      el.textContent = 'En attente d’un complice…';
      continue;
    }
    if (seat === l.you) el.classList.add('me');
    const art = document.createElement('div');
    art.innerHTML = thiefSvg(seat);
    const info = document.createElement('div');
    info.style.minWidth = '0';
    const who = document.createElement('div');
    who.className = 'who';
    who.style.color = seat === 0 ? 'var(--violet)' : 'var(--orange)';
    who.textContent = p.name + (seat === l.you ? ' (toi)' : '');
    const state = document.createElement('span');
    state.className = 'state';
    if (!p.connected) {
      state.classList.add('away');
      state.dataset.away = '1';
      state.textContent = 'Déconnecté…';
    } else if (p.ready) {
      state.classList.add('ready');
      state.textContent = 'Prêt !';
    } else {
      state.textContent = 'Pas encore prêt';
    }
    info.append(who, state);
    el.append(art.firstElementChild!, info);
  }

  const me = l.players[l.you];
  const other = l.players[l.you === 0 ? 1 : 0];
  const btn = $<HTMLButtonElement>('btn-ready');
  btn.textContent = me?.ready ? 'Finalement, pas prêt' : 'Je suis prêt !';
  btn.classList.toggle('ready-on', !!me?.ready);
  $('lobby-status').textContent = !other
    ? 'Il faut être deux pour lancer le casse. Partage le lien !'
    : !other.connected
      ? `${other.name} a perdu la connexion. On lui garde sa place 60 secondes.`
      : other.ready && !me?.ready
        ? `${other.name} est prêt. Et toi ?`
        : 'La partie démarre dès que vous êtes prêts tous les deux.';
}

// ───────────── Jeu ─────────────

let phaser: Phaser.Game | null = null;
let scene: GameScene | null = null;

function ensureGame() {
  if (phaser) return;
  scene = new GameScene({
    send: (cmd) => {
      if (socket.connected) socket.emit('input', cmd);
    },
    names: () => names,
    onSnapshot: updateHud,
    toast,
  });
  phaser = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-canvas',
    width: WORLD_W,
    height: WORLD_H,
    backgroundColor: '#2a1f3d',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, roundPixels: false },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    banner: false,
    scene: [scene],
  });
}

// HUD
const slotsEl = $('hud-slots');
slotsEl.innerHTML = ITEMS.map((it) => `<i data-id="${it.id}" class="${it.kind === 'big' ? 'big' : ''}" title="${it.name} (${it.value} €)"></i>`).join('');
let lastLoot = -1;

function partnerStatus(s: Snapshot): [string, string] {
  const other = s.players[s.you === 0 ? 1 : 0];
  const away = lobby && !lobby.players[other.seat]?.connected;
  if (away) return ['Déconnecté', 'away'];
  if (other.jailed) return ['Enfermé au cabanon !', 'bad'];
  if (other.hold === 'switch') return ['Coupe la caméra', ''];
  if (other.hold === 'free') return ['Te libère…', ''];
  if (other.leave) return ['Prêt à partir', ''];
  if (other.carry) {
    const it = s.items.find((i) => i.id === other.carry!.item);
    const name = ITEM_BY_ID[other.carry.item].name;
    if (other.carry.kind === 'big' && it?.state === 'idle') return [`T’attend : ${name}`, ''];
    return [`Porte : ${name}`, ''];
  }
  return ['Libre', ''];
}

function updateHud(s: Snapshot) {
  const timerBlock = $('hud-timer').parentElement!;
  $('hud-timer').textContent = fmtTime(s.timeLeft);
  timerBlock.classList.toggle('urgent', s.phase === 'playing' && s.timeLeft <= 30);

  const lootEl = $('hud-loot');
  lootEl.textContent = `${s.loot} €`;
  if (lastLoot !== -1 && s.loot > lastLoot) {
    lootEl.classList.remove('bump');
    void lootEl.offsetWidth;
    lootEl.classList.add('bump');
  }
  lastLoot = s.loot;
  for (const it of s.items) slotsEl.querySelector(`[data-id="${it.id}"]`)?.classList.toggle('done', it.state === 'delivered');

  const cam = $('hud-cam');
  cam.className = `chip ${!s.camera.enabled ? 'off' : s.camera.alarm ? 'alarm' : 'on'}`;
  cam.textContent = !s.camera.enabled ? 'Coupée' : s.camera.alarm ? 'Alerte !' : 'Active';

  const block = $('hud-partner-name').closest<HTMLElement>('.partner-block')!;
  block.classList.toggle('hidden', s.solo);
  if (s.solo) return;
  const otherSeat = s.you === 0 ? 1 : 0;
  $('hud-partner-name').textContent = names[otherSeat] || 'Complice';
  $('hud-partner-dot').style.background = otherSeat === 0 ? 'var(--violet)' : 'var(--orange)';
  const [status, cls] = partnerStatus(s);
  $('hud-partner-status').textContent = status;
  block.classList.toggle('bad', cls === 'bad');
  block.classList.toggle('away', cls === 'away');
}

const toastTimes = new Map<string, number>();
function toast(msg: string, tone: 'info' | 'good' | 'bad' = 'info') {
  const now = performance.now();
  if ((toastTimes.get(msg) ?? 0) > now - 2500) return;
  toastTimes.set(msg, now);
  const box = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.textContent = msg;
  box.append(el);
  while (box.children.length > 3) box.firstElementChild!.remove();
  setTimeout(() => el.classList.add('fade'), 2800);
  setTimeout(() => el.remove(), 3300);
}

// Son
const muteBtn = $('btn-mute');
const renderMute = () => {
  muteBtn.innerHTML = isMuted() ? ICON_SOUND_OFF : ICON_SOUND_ON;
  muteBtn.title = isMuted() ? 'Activer le son' : 'Couper le son';
};
renderMute();
muteBtn.addEventListener('click', () => {
  unlockAudio();
  toggleMute();
  renderMute();
  muteBtn.blur();
});

// Fin de partie
const OUTCOMES: Record<GameResult['outcome'], { badge: string; cls: string; title: string; sub: string; escaped: boolean }> = {
  escaped: { badge: 'Casse réussi', cls: 'win', title: 'Le plan a marché !', sub: '', escaped: true },
  escaped_empty: {
    badge: 'Évasion… à vide',
    cls: 'meh',
    title: 'Les mains vides',
    sub: 'Vous vous êtes échappés, mais le camion est vide. Un plan parfait… pour rien.',
    escaped: true,
  },
  caught: { badge: 'Échec', cls: 'lose', title: 'Pris la main dans le sac', sub: 'Vous êtes tous les deux enfermés dans le cabanon. Le gardien est très fier de lui.', escaped: false },
  timeout: {
    badge: 'Échec',
    cls: 'lose',
    title: 'Trop tard !',
    sub: 'Le temps est écoulé et vous n’étiez pas tous les deux au camion. Les sirènes approchent…',
    escaped: false,
  },
  abandoned: { badge: 'Partie interrompue', cls: 'meh', title: 'Ton complice a filé', sub: '', escaped: false },
};

function renderEnd(l: LobbyState) {
  const r = l.result;
  if (!r) return;
  const o = OUTCOMES[r.outcome];
  const badge = $('end-badge');
  badge.className = `end-badge ${o.cls}`;
  badge.textContent = o.badge;
  $('end-title').textContent = o.title;
  let sub = r.detail ?? o.sub;
  if (r.outcome === 'escaped') {
    sub =
      r.delivered === r.total
        ? 'Le camion est plein à craquer. Casse parfait !'
        : r.delivered >= 3
          ? 'Vous filez avec un beau butin. Personne ne saura jamais.'
          : 'Vous filez avec un petit butin… c’est déjà ça.';
  }
  if (l.solo) sub = soloSub(r) ?? sub;
  $('end-sub').textContent = sub;
  $('end-loot').textContent = `${r.loot} €`;
  $('end-items').textContent = `${r.delivered} / ${r.total}`;
  $('end-escape').textContent = o.escaped ? 'Réussie' : 'Ratée';
  const stars = o.escaped ? (r.loot >= 2000 ? 3 : r.loot >= 1100 ? 2 : r.loot > 0 ? 1 : 0) : 0;
  $('end-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');

  const me = l.players[l.you];
  const otherSeat = l.you === 0 ? 1 : 0;
  const other = l.players[otherSeat];
  const replay = $<HTMLButtonElement>('btn-replay');
  const status = $('end-replay-status');
  $('btn-to-lobby').textContent = l.solo ? 'Menu principal' : 'Retour au salon';
  if (l.solo) {
    replay.disabled = !!me?.replay;
    replay.textContent = 'Rejouer';
    status.textContent = '';
  } else if (!other) {
    replay.disabled = true;
    replay.textContent = 'Rejouer';
    status.textContent = 'Retourne au salon pour inviter un nouveau complice.';
  } else if (me?.replay) {
    replay.disabled = true;
    replay.textContent = 'En attente…';
    status.textContent = `On attend que ${other.name} clique sur « Rejouer ».`;
  } else {
    replay.disabled = false;
    replay.textContent = other.replay ? `Rejouer (${other.name} est partant)` : 'Rejouer';
    status.textContent = other.replay ? `${other.name} veut remettre ça !` : '';
  }
}

/** Textes de fin au singulier pour le mode solo. */
function soloSub(r: GameResult): string | null {
  switch (r.outcome) {
    case 'escaped':
      return r.delivered === r.total
        ? 'Le camion est plein à craquer. Casse parfait, et tout seul !'
        : r.delivered >= 3
          ? 'Tu files avec un beau butin. Personne ne saura jamais.'
          : 'Tu files avec un petit butin… c’est déjà ça.';
    case 'escaped_empty':
      return 'Tu t’es échappé, mais le camion est vide. Un plan parfait… pour rien.';
    case 'timeout':
      return 'Le temps est écoulé et tu n’étais pas au camion. Les sirènes approchent…';
    default:
      return null;
  }
}

$('btn-replay').addEventListener('click', () => socket.emit('game:replay'));
$('btn-to-lobby').addEventListener('click', () => (lobby?.solo ? leaveRoom() : socket.emit('game:lobby')));

function applyLobby(l: LobbyState) {
  lobby = l;
  names = [l.players[0]?.name ?? '', l.players[1]?.name ?? ''];
  const from = prevPhase;
  prevPhase = l.phase;

  if (l.pause) pauseDeadline = performance.now() + l.pause.remainingMs;

  if (l.phase === 'lobby') {
    $('overlay-end').classList.add('hidden');
    $('overlay-pause').classList.add('hidden');
    showScreen('lobby');
    renderLobby(l);
    return;
  }

  const newGame = l.phase === 'countdown' && (from === null || from === 'lobby' || from === 'ended');
  showScreen('game');
  ensureGame();
  if (newGame) {
    scene?.resetState();
    scene?.clearTruck();
    lastLoot = -1;
  }

  const paused = l.phase === 'paused' && l.pause;
  $('overlay-pause').classList.toggle('hidden', !paused);
  if (paused) {
    const who = l.players[l.pause!.seat]?.name ?? 'Ton complice';
    $('pause-text').textContent = `${who} a perdu la connexion. On lui garde sa place pendant :`;
  }

  const ended = l.phase === 'ended';
  $('overlay-end').classList.toggle('hidden', !ended);
  scene?.setInputEnabled(!ended && !paused);
  if (ended) {
    renderEnd(l);
    if (from !== 'ended' && l.result) (OUTCOMES[l.result.outcome].escaped && l.result.loot > 0 ? sfx.win : sfx.lose)();
  }
}

// Comptes à rebours locaux (pause et salon).
setInterval(() => {
  if (!lobby?.pause) return;
  const left = (pauseDeadline - performance.now()) / 1000;
  $('pause-timer').textContent = fmtTime(left);
  const away = document.querySelector<HTMLElement>('.seat .state[data-away]');
  if (away) away.textContent = `Déconnecté — place gardée ${fmtTime(left)}`;
}, 250);

if (session) {
  setBanner('Reconnexion à ta partie…');
  $('screen-home').classList.add('hidden');
} else {
  showHome();
}
