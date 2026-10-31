// Petits sons synthétisés (aucun fichier audio).
let ctx: AudioContext | null = null;
let muted = false;
try {
  muted = localStorage.getItem('mp.muted') === '1';
} catch {
  /* stockage indisponible */
}

export function unlockAudio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem('mp.muted', muted ? '1' : '0');
  } catch {
    /* stockage indisponible */
  }
  return muted;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'square', vol = 0.06, slideTo?: number) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  pickup: () => tone(520, 0, 0.12, 'triangle', 0.08, 880),
  drop: () => tone(300, 0, 0.12, 'triangle', 0.06, 180),
  deliver: () => {
    tone(988, 0, 0.1, 'square', 0.05);
    tone(1319, 0.08, 0.25, 'square', 0.05);
  },
  alert: () => {
    tone(880, 0, 0.12, 'sawtooth', 0.05);
    tone(660, 0.13, 0.18, 'sawtooth', 0.05);
  },
  camera: () => {
    tone(1200, 0, 0.08, 'square', 0.04);
    tone(1200, 0.12, 0.08, 'square', 0.04);
  },
  capture: () => tone(220, 0, 0.4, 'sawtooth', 0.07, 80),
  freed: () => {
    [523, 659, 784].forEach((f, i) => tone(f, i * 0.08, 0.15, 'triangle', 0.07));
  },
  tick: () => tone(660, 0, 0.08, 'square', 0.04),
  go: () => tone(990, 0, 0.25, 'square', 0.05),
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.25, 'triangle', 0.08));
  },
  lose: () => {
    [392, 330, 262].forEach((f, i) => tone(f, i * 0.18, 0.3, 'triangle', 0.08));
  },
};
