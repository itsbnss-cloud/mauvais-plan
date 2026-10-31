// Clavier : codes physiques, donc ZQSD (AZERTY) et WASD (QWERTY) fonctionnent tous les deux.
const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const HANDLED = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, 'KeyE', 'Space']);

export class KeyboardInput {
  private down = new Set<string>();
  private eLatch = false;
  private dropLatch = false;
  enabled = true;

  constructor() {
    window.addEventListener('keydown', (ev) => {
      if (!this.enabled || isTyping(ev.target)) return;
      if (!HANDLED.has(ev.code)) return;
      ev.preventDefault();
      if (!ev.repeat) {
        if (ev.code === 'KeyE') this.eLatch = true;
        if (ev.code === 'Space') this.dropLatch = true;
      }
      this.down.add(ev.code);
    });
    window.addEventListener('keyup', (ev) => this.down.delete(ev.code));
    // Perte de focus : on relâche tout pour ne pas laisser le personnage marcher.
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  clear() {
    this.down.clear();
    this.eLatch = false;
    this.dropLatch = false;
  }

  private any(codes: string[]) {
    return codes.some((c) => this.down.has(c));
  }

  /** Lit l'état courant ; les appuis brefs entre deux lectures ne sont pas perdus. */
  sample() {
    let x = (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0);
    let y = (this.any(DOWN) ? 1 : 0) - (this.any(UP) ? 1 : 0);
    if (x && y) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    const e = this.down.has('KeyE') || this.eLatch;
    const drop = this.dropLatch;
    this.eLatch = false;
    this.dropLatch = false;
    return { x, y, e, drop };
  }
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}
