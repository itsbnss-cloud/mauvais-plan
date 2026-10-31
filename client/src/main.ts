import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { WORLD_H, WORLD_W } from '../../shared/constants';
import { DEFAULT_LEVEL, LEVELS, getLevel } from '../../shared/levels';
import { ITEM_CATALOG } from '../../shared/map';
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
    scene?.setInputEnabled(!keypadGate);
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

// Choix du niveau
let homeLevel = DEFAULT_LEVEL;
try {
  homeLevel = getLevel(localStorage.getItem('mp.level')).id;
} catch {
  /* stockage indisponible */
}

function renderLevels(el: HTMLElement, selected: string, onPick: (id: string) => void) {
  el.replaceChildren();
  for (const lv of LEVELS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `level-card${lv.id === selected ? ' selected' : ''}`;
    const stars = [1, 2, 3].map((i) => `<span class="${i <= lv.stars ? '' : 'off'}">★</span>`).join('');
    btn.innerHTML = `<span class="lv-stars">${stars}</span><b></b>`;
    btn.querySelector('b')!.textContent = lv.name;
    btn.title = lv.blurb;
    btn.addEventListener('click', () => onPick(lv.id));
    el.append(btn);
  }
  const desc = document.createElement('p');
  desc.className = 'level-desc';
  desc.style.gridColumn = '1 / -1';
  desc.textContent = getLevel(selected).blurb;
  el.append(desc);
}

function renderHomeLevels() {
  renderLevels($('home-levels'), homeLevel, (id) => {
    homeLevel = id;
    try {
      localStorage.setItem('mp.level', id);
    } catch {
      /* stockage indisponible */
    }
    renderHomeLevels();
  });
}
renderHomeLevels();

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
    enterRoom(await request('room:create', { name, level: homeLevel }));
  }),
);

$('btn-solo').addEventListener('click', () =>
  withBusy(async () => {
    unlockAudio();
    const name = readName();
    if (!name) return;
    $('home-error').textContent = '';
    enterRoom(await request('room:solo', { name, level: homeLevel }), true);
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

  renderLevels($('lobby-levels'), l.level, (id) => socket.emit('room:level', id));

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
    openKeypad,
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
let hudLevel = '';
let lastLoot = -1;

/** Cases du butin et libellés qui dépendent du niveau. */
function setHudLevel(id: string) {
  if (id === hudLevel) return;
  hudLevel = id;
  const level = getLevel(id);
  slotsEl.innerHTML = level.items.map((it) => `<i data-id="${it.id}" class="${it.kind === 'big' ? 'big' : ''}" title="${it.name} (${it.value} €)"></i>`).join('');
  $('hud-cam-label').textContent = level.lasers.length ? 'Caméras + lasers' : level.cameras.length > 1 ? 'Caméras' : 'Caméra';
}

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
    const name = ITEM_CATALOG[other.carry.item].name;
    if (other.carry.kind === 'big' && it?.state === 'idle') return [`T’attend : ${name}`, ''];
    return [`Porte : ${name}`, ''];
  }
  return ['Libre', ''];
}

function updateHud(s: Snapshot) {
  setHudLevel(s.level);
  renderClues(s);
  if (keypadGate && (s.phase !== 'playing' || s.players[s.you].jailed || s.gates.find((g) => g.id === keypadGate)?.open)) closeKeypad();
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

// Carnet d'indices
let lastClues = '';
function renderClues(s: Snapshot) {
  const level = getLevel(s.level);
  const key = `${s.level}|${s.clues.map((c) => c.text).join('|')}`;
  if (key === lastClues) return;
  lastClues = key;
  const box = $('clues');
  const codeGates = level.gates.filter((g) => g.lock.type === 'code');
  box.classList.toggle('hidden', !codeGates.length);
  if (!codeGates.length) return;
  const total = codeGates.reduce((n, g) => n + (g.lock.type === 'code' ? g.lock.notes.length : 0), 0);
  const list = $('clues-list');
  list.replaceChildren();
  for (const c of s.clues) {
    const li = document.createElement('li');
    li.textContent = c.text;
    list.append(li);
  }
  if (!s.clues.length) {
    const li = document.createElement('li');
    li.textContent = 'Aucun pour l’instant : cherche les papiers jaunes.';
    list.append(li);
  }
  $('clues-tip').textContent = `${s.clues.length}/${total} papiers lus${s.solo ? '' : ' · ton complice ne voit pas les tiens, dis-les-lui !'}`;
}

// Digicode
let keypadGate: string | null = null;
let keypadCode = '';
let keypadBusy = false;
const keypadDisplay = $('keypad-display');

function keypadLength() {
  const g = lobby ? getLevel(lobby.level).gates.find((x) => x.id === keypadGate) : null;
  return g?.lock.type === 'code' ? g.lock.notes.length : 4;
}

function renderKeypad() {
  keypadDisplay.textContent = keypadCode.padEnd(keypadLength(), '_');
}

function openKeypad(gate: string) {
  if (keypadGate) return;
  keypadGate = gate;
  keypadCode = '';
  keypadDisplay.className = 'keypad-display';
  $('keypad-msg').textContent = 'Tape les chiffres au clavier ou clique. Échap pour fermer.';
  renderKeypad();
  $('overlay-keypad').classList.remove('hidden');
  scene?.setInputEnabled(false);
}

function closeKeypad() {
  if (!keypadGate) return;
  keypadGate = null;
  $('overlay-keypad').classList.add('hidden');
  const ended = lobby?.phase === 'ended';
  if (lobby && !ended && !lobby.pause) scene?.setInputEnabled(true);
}

function keypadPress(k: string) {
  if (!keypadGate || keypadBusy) return;
  if (k === 'back') keypadCode = keypadCode.slice(0, -1);
  else if (k === 'ok') return submitKeypad();
  else if (/^[0-9]$/.test(k) && keypadCode.length < keypadLength()) keypadCode += k;
  keypadDisplay.className = 'keypad-display';
  renderKeypad();
  if (keypadCode.length === keypadLength()) submitKeypad();
}

function submitKeypad() {
  if (!keypadGate || keypadBusy || keypadCode.length < keypadLength()) return;
  keypadBusy = true;
  const gate = keypadGate;
  socket.timeout(4000).emit('keypad', { gate, code: keypadCode }, (err: Error | null, ok: boolean) => {
    keypadBusy = false;
    if (keypadGate !== gate) return;
    if (!err && ok) {
      keypadDisplay.className = 'keypad-display right';
      setTimeout(closeKeypad, 450);
      return;
    }
    keypadDisplay.className = 'keypad-display wrong';
    $('keypad-msg').textContent = 'Faux ! Le digicode a bipé… Vérifie tes indices.';
    keypadCode = '';
    setTimeout(renderKeypad, 400);
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>('.keypad-grid button')) {
  b.addEventListener('click', () => {
    keypadPress(b.dataset.k!);
    b.blur();
  });
}
window.addEventListener('keydown', (e) => {
  if (!keypadGate) return;
  if (e.key === 'Escape') closeKeypad();
  else if (e.key === 'Backspace') keypadPress('back');
  else if (e.key === 'Enter') keypadPress('ok');
  else if (/^[0-9]$/.test(e.key)) keypadPress(e.key);
  else return;
  e.preventDefault();
});

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
  const idx = LEVELS.findIndex((lv) => lv.id === l.level);
  const next = LEVELS[idx + 1];
  const showNext = l.solo && !!next && o.escaped && r.loot > 0;
  $('btn-next').classList.toggle('hidden', !showNext);
  $('btn-next').textContent = next ? `Niveau suivant : ${next.name}` : '';
  replay.classList.toggle('primary', !showNext);
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
$('btn-next').addEventListener('click', () => {
  const idx = LEVELS.findIndex((lv) => lv.id === lobby?.level);
  const next = LEVELS[idx + 1];
  if (next) socket.emit('room:level', next.id);
});
$('btn-to-lobby').addEventListener('click', () => (lobby?.solo ? leaveRoom() : socket.emit('game:lobby')));

function applyLobby(l: LobbyState) {
  lobby = l;
  names = [l.players[0]?.name ?? '', l.players[1]?.name ?? ''];
  const from = prevPhase;
  prevPhase = l.phase;

  if (l.pause) pauseDeadline = performance.now() + l.pause.remainingMs;

  setHudLevel(l.level);
  if (l.phase !== 'playing') closeKeypad();
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
  scene?.setInputEnabled(!ended && !paused && !keypadGate);
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
