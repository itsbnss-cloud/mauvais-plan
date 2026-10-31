import Phaser from 'phaser';
import {
  CAMERA_HALF_ANGLE,
  CAMERA_RANGE,
  GUARD_VIEW_HALF_ANGLE,
  GUARD_VIEW_RANGE,
  INPUT_DT,
  MAX_CAMERAS,
  MAX_GUARDS,
  SOLO_CAMERA_OFF_TIME,
  SOLO_JAIL_TIME,
  WORLD_H,
  WORLD_W,
} from '../../../shared/constants';
import { angleDiff, pointInRect, raycast, type Rect, type Vec } from '../../../shared/geometry';
import { DEFAULT_LEVEL, getLevel, type Level } from '../../../shared/levels';
import { ITEM_CATALOG, JAIL, SWITCH_POS, TRUCK_RECT, TRUCK_ZONE } from '../../../shared/map';
import { closedGateRects, dynamicObstacles, findInteraction, stepPlayer } from '../../../shared/rules';
import type { GameEvent, GuardSnap, InputCmd, ItemSnap, PlayerSnap, Seat, Snapshot } from '../../../shared/types';
import { sfx } from '../sfx';
import { CHAR_H, PALETTES, charKey, makeTextures, type Facing } from './art';
import { KeyboardInput } from './input';
import { makeWorldTexture } from './world';

export interface SceneBridge {
  send(cmd: InputCmd): void;
  names(): [string, string];
  onSnapshot(s: Snapshot): void;
  toast(msg: string, tone?: 'info' | 'good' | 'bad'): void;
  /** E devant un digicode : ouvrir le pavé numérique. */
  openKeypad(gate: string): void;
}

interface CamView {
  sprite: Phaser.GameObjects.Image;
  led: Phaser.GameObjects.Image;
  off: Phaser.GameObjects.Text;
}

const INTERP_DELAY = 110;
const FONT = 'Fredoka, system-ui, sans-serif';

interface CharView {
  shadow: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  carried: Phaser.GameObjects.Image;
  badge: Phaser.GameObjects.Image;
  walk: number;
  lastX: number;
  lastY: number;
}

interface ItemView {
  sprite: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  spark: Phaser.GameObjects.Image;
}

function facingOf(angle: number): { dir: Facing; flip: boolean } {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  if (s < -0.7) return { dir: 'up', flip: false };
  if (s > 0.7) return { dir: 'down', flip: false };
  return { dir: 'side', flip: c < 0 };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class GameScene extends Phaser.Scene {
  private bridge: SceneBridge;
  private input2 = new KeyboardInput();
  private ready = false;
  private early: Snapshot[] = [];

  private buffer: Snapshot[] = [];
  private latest: Snapshot | null = null;
  private offset: number | null = null;

  // Prédiction locale.
  private seq = Date.now();
  private acc = 0;
  private pending: InputCmd[] = [];
  private pred: Vec | null = null;
  private prevPred: Vec | null = null;
  private corr = { x: 0, y: 0 };
  private myAngle = -Math.PI / 2;
  private myMoving = false;

  private players: CharView[] = [];
  private guards: CharView[] = [];
  private guardBubbles: Phaser.GameObjects.Text[] = [];
  private level: Level = getLevel(DEFAULT_LEVEL);
  private worldImage!: Phaser.GameObjects.Image;
  /** Objets propres au niveau affiché (étiquettes, digicodes, papiers). */
  private levelObjects: Phaser.GameObjects.GameObject[] = [];
  private floorFx!: Phaser.GameObjects.Graphics;
  private wallFx!: Phaser.GameObjects.Graphics;
  private prevE = false;
  private coneBlockers: Rect[] = [];
  private items = new Map<string, ItemView>();
  private truckLoot = new Map<string, Phaser.GameObjects.Image>();
  private truck!: Phaser.GameObjects.Image;
  private cones!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private cams: CamView[] = [];
  private switchSprite!: Phaser.GameObjects.Image;
  private lock!: Phaser.GameObjects.Image;
  private hintBg!: Phaser.GameObjects.Graphics;
  private hintText!: Phaser.GameObjects.Text;
  private hintContainer!: Phaser.GameObjects.Container;
  private bigCenter!: Phaser.GameObjects.Text;
  private sparkEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private coinEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private puffEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private lastCount = -1;
  private camFlash = 0;

  constructor(bridge: SceneBridge) {
    super('game');
    this.bridge = bridge;
  }

  create() {
    makeTextures(this);
    this.worldImage = this.add.image(0, 0, makeWorldTexture(this, this.level)).setOrigin(0).setDepth(-1000);
    this.add
      .text(JAIL.outer.x + JAIL.outer.w / 2, JAIL.outer.y - 2, 'CABANON', { fontFamily: FONT, fontSize: '12px', color: '#ffffff', fontStyle: '600', stroke: '#2a1f3d', strokeThickness: 3 })
      .setOrigin(0.5, 0)
      .setDepth(-800);
    this.add
      .text(TRUCK_ZONE.x + TRUCK_ZONE.w / 2, TRUCK_ZONE.y + 4, 'ZONE DE FUITE', { fontFamily: FONT, fontSize: '12px', color: '#fff6c9', fontStyle: '600', stroke: '#6b5300', strokeThickness: 3 })
      .setOrigin(0.5, 0)
      .setDepth(-800);

    this.cones = this.add.graphics().setDepth(-500);
    this.floorFx = this.add.graphics().setDepth(-450);
    this.wallFx = this.add.graphics().setDepth(2950);
    this.truck = this.add.image(TRUCK_RECT.x - 2, TRUCK_RECT.y - 2, 'truck').setOrigin(0).setDepth(TRUCK_RECT.y + TRUCK_RECT.h / 2);

    for (const id of Object.keys(ITEM_CATALOG)) {
      const def = ITEM_CATALOG[id];
      const glow = this.add.image(0, 0, 'glow').setDepth(-600).setScale(def.kind === 'big' ? 1.6 : 1).setVisible(false);
      const sprite = this.add.image(0, 0, `item_${id}`).setVisible(false);
      const spark = this.add.image(0, 0, 'spark').setDepth(5000).setTint(0xfff3a0).setVisible(false);
      this.tweens.add({ targets: spark, scale: { from: 0.2, to: 0.9 }, alpha: { from: 1, to: 0 }, duration: 900, repeat: -1, repeatDelay: 600 + Math.random() * 1500 });
      this.items.set(id, { sprite, glow, spark });
    }

    this.players = [0, 1].map((seat) => this.makeChar(`p${seat}`, PALETTES[seat].css));
    for (let i = 0; i < MAX_GUARDS; i++) {
      const view = this.makeChar('guard', '#ffffff');
      view.label.setText('Gardien').setColor('#cfe0ff');
      this.guards.push(view);
      this.guardBubbles.push(
        this.add
          .text(0, 0, '', { fontFamily: FONT, fontSize: '30px', fontStyle: '700', color: '#ff4d4d', stroke: '#ffffff', strokeThickness: 6 })
          .setOrigin(0.5, 1)
          .setDepth(9000),
      );
    }

    for (let i = 0; i < MAX_CAMERAS; i++) {
      this.cams.push({
        sprite: this.add.image(0, 0, 'cam').setDepth(3000),
        led: this.add.image(0, 0, 'led').setDepth(3001).setScale(0.7),
        off: this.add
          .text(0, 0, 'OFF', { fontFamily: FONT, fontSize: '12px', fontStyle: '700', color: '#ffffff', backgroundColor: '#2a1f3d', padding: { x: 4, y: 1 } })
          .setDepth(3002)
          .setVisible(false),
      });
    }
    this.switchSprite = this.add.image(SWITCH_POS.x + 8, SWITCH_POS.y, 'switch_on').setDepth(3000);
    this.lock = this.add.image(JAIL.lock.x, JAIL.lock.y - 16, 'lock').setDepth(3000);

    this.hintBg = this.add.graphics();
    this.hintText = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '14px', color: '#ffffff', fontStyle: '600', align: 'center' }).setOrigin(0.5);
    this.hintContainer = this.add.container(0, 0, [this.hintBg, this.hintText]).setDepth(9500).setVisible(false);

    this.overlay = this.add.graphics().setDepth(9800);
    this.bigCenter = this.add
      .text(WORLD_W / 2, WORLD_H / 2, '', { fontFamily: FONT, fontSize: '96px', fontStyle: '700', color: '#ffd34d', stroke: '#2a1f3d', strokeThickness: 12 })
      .setOrigin(0.5)
      .setDepth(9900);

    const burst = (tex: string, cfg: Phaser.Types.GameObjects.Particles.ParticleEmitterConfig) =>
      this.add.particles(0, 0, tex, { emitting: false, ...cfg }).setDepth(8000);
    this.sparkEmitter = burst('spark', { speed: { min: 60, max: 160 }, lifespan: 600, scale: { start: 0.9, end: 0 }, tint: [0xffffff, 0xffd34d, 0xc9b6ff] });
    this.coinEmitter = burst('coin', { speed: { min: 120, max: 260 }, angle: { min: 200, max: 340 }, gravityY: 500, lifespan: 900, scale: { start: 1.1, end: 0.5 } });
    this.puffEmitter = burst('puff', { speed: { min: 30, max: 90 }, lifespan: 700, scale: { start: 0.8, end: 1.6 }, alpha: { start: 0.9, end: 0 } });

    this.ready = true;
    this.setLevel(this.level, true);
    for (const s of this.early) this.pushSnapshot(s);
    this.early = [];
  }

  /** Change le décor et les éléments propres au niveau. */
  private setLevel(level: Level, force = false) {
    if (!force && level.id === this.level.id) return;
    this.level = level;
    this.worldImage.setTexture(makeWorldTexture(this, level));
    for (const o of this.levelObjects) o.destroy();
    this.levelObjects = [];
    for (const room of level.rooms) {
      this.levelObjects.push(
        this.add
          .text(room.rect.x + 14, room.labelTop ? room.rect.y + 14 : room.rect.y + room.rect.h - 14, room.name.toUpperCase(), {
            fontFamily: FONT,
            fontSize: '13px',
            color: room.floor === 'velvet' || room.floor === 'steel' ? '#ffffff' : '#2a1f3d',
            fontStyle: '600',
          })
          .setOrigin(0, room.labelTop ? 0 : 1)
          .setAlpha(0.4)
          .setDepth(-900),
      );
    }
    for (const g of level.gates) {
      if (g.lock.type !== 'code') continue;
      this.levelObjects.push(this.add.image(g.lock.keypad.x, g.lock.keypad.y, 'keypad').setDepth(3000));
      for (const n of g.lock.notes) this.levelObjects.push(this.add.image(n.x, n.y, 'note').setDepth(-300));
    }
    this.cams.forEach((c, i) => {
      const cam = level.cameras[i];
      for (const o of [c.sprite, c.led]) o.setVisible(!!cam);
      c.off.setVisible(false);
      if (!cam) return;
      c.sprite.setPosition(cam.x, cam.y).setRotation(cam.angle);
      c.led.setPosition(cam.x - 4, cam.y - 4);
      c.off.setPosition(cam.x + 18, cam.y - 18);
    });
    for (const [id, view] of this.items) {
      const used = !!level.itemById[id];
      for (const o of [view.sprite, view.glow, view.spark]) o.setVisible(used);
    }
    this.clearTruck();
  }

  private blockers(s: Snapshot): Rect[] {
    return [...this.level.visionBlockers, ...closedGateRects(this.level, s.gates)];
  }
  private makeChar(prefix: string, color: string): CharView {
    const shadow = this.add.image(0, 0, 'shadow');
    const body = this.add.image(0, 0, `${prefix}_down_0`).setOrigin(0.5, 0.86);
    const label = this.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '12px', fontStyle: '600', color, stroke: '#2a1f3d', strokeThickness: 4 })
      .setOrigin(0.5, 1);
    const carried = this.add.image(0, 0, 'item_console').setVisible(false);
    const badge = this.add.image(0, 0, 'check').setVisible(false);
    return { shadow, body, label, carried, badge, walk: 0, lastX: 0, lastY: 0 };
  }

  /** Nouvelle partie : on repart d'un état vierge. */
  resetState() {
    this.buffer = [];
    this.latest = null;
    this.offset = null;
    this.pending = [];
    this.pred = this.prevPred = null;
    this.corr = { x: 0, y: 0 };
    this.lastCount = -1;
    this.input2.clear();
  }

  setInputEnabled(on: boolean) {
    this.input2.enabled = on;
    if (!on) this.input2.clear();
  }

  pushSnapshot(s: Snapshot) {
    if (!this.ready) {
      this.early.push(s);
      return;
    }
    if (this.latest && s.t < this.latest.t - 500) this.resetState();
    const now = performance.now();
    const sample = now - s.t;
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;

    this.setLevel(getLevel(s.level));
    this.buffer.push(s);
    while (this.buffer.length > 2 && this.buffer[1].t < s.t - 1000) this.buffer.shift();
    const prevPhase = this.latest?.phase;
    this.latest = s;
    this.handleEvents(s.events, s);
    this.reconcile(s);
    this.bridge.onSnapshot(s);

    if (s.phase === 'countdown') {
      const n = Math.max(1, Math.ceil(s.countdown));
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.bigCenter.setText(String(n)).setAlpha(1).setScale(1.4);
        this.tweens.add({ targets: this.bigCenter, scale: 1, duration: 250, ease: 'Back.Out' });
        sfx.tick();
      }
    } else if (s.phase === 'playing' && prevPhase === 'countdown') {
      this.lastCount = -1;
      this.bigCenter.setText("C'est parti !").setAlpha(1).setScale(0.6);
      sfx.go();
      this.tweens.add({ targets: this.bigCenter, scale: 1, duration: 300, ease: 'Back.Out' });
      this.tweens.add({ targets: this.bigCenter, alpha: 0, delay: 700, duration: 400 });
    } else if (this.lastCount !== -1) {
      this.lastCount = -1;
      this.bigCenter.setAlpha(0);
    }
  }

  private predictionActive(s: Snapshot) {
    const me = s.players[s.you];
    return s.phase === 'playing' && !me.jailed && me.carry?.kind !== 'big';
  }

  private reconcile(s: Snapshot) {
    const me = s.players[s.you];
    this.pending = this.pending.filter((c) => c.seq > s.ack);
    if (!this.predictionActive(s)) {
      this.pred = this.prevPred = null;
      this.corr = { x: 0, y: 0 };
      return;
    }
    const dyn = dynamicObstacles(this.level, s.items, s.gates);
    const small = me.carry?.kind === 'small';
    let p: Vec = { x: me.x, y: me.y };
    for (const c of this.pending) p = stepPlayer(this.level, p, c.x, c.y, small, dyn);
    if (this.pred && this.prevPred) {
      const dx = p.x - this.pred.x;
      const dy = p.y - this.pred.y;
      if (Math.hypot(dx, dy) > 70) {
        this.corr = { x: 0, y: 0 };
        this.prevPred = { ...p };
      } else {
        this.prevPred = { x: this.prevPred.x + dx, y: this.prevPred.y + dy };
        this.corr.x -= dx;
        this.corr.y -= dy;
      }
    } else {
      this.prevPred = { ...p };
    }
    this.pred = p;
  }

  private inputStep() {
    const s = this.latest;
    const smp = this.input2.sample();
    if (!s || s.phase !== 'playing') return;
    // E devant un digicode : on ouvre le pavé numérique.
    if (smp.e && !this.prevE) {
      const me = s.players[s.you];
      const pos = this.myDisplayPos(s) ?? me;
      const players = s.players.map((p, i) => (i === s.you ? { ...p, x: pos.x, y: pos.y } : p));
      const inter = findInteraction(this.level, players, s.items, s.gates, s.you);
      if (inter?.type === 'keypad') this.bridge.openKeypad(inter.gate);
    }
    this.prevE = smp.e;
    const cmd: InputCmd = { seq: ++this.seq, ...smp };
    this.bridge.send(cmd);
    this.pending.push(cmd);
    if (this.pending.length > 120) this.pending.shift();
    this.myMoving = smp.x !== 0 || smp.y !== 0;
    if (this.myMoving) this.myAngle = Math.atan2(smp.y, smp.x);
    if (this.pred) {
      const me = s.players[s.you];
      this.prevPred = this.pred;
      this.pred = stepPlayer(this.level, this.pred, cmd.x, cmd.y, me.carry?.kind === 'small', dynamicObstacles(this.level, s.items, s.gates));
    }
  }

  update(_time: number, deltaMs: number) {
    if (!this.ready) return;
    const dt = Math.min(0.1, deltaMs / 1000);
    this.acc = Math.min(this.acc + dt, 0.2);
    while (this.acc >= INPUT_DT) {
      this.acc -= INPUT_DT;
      this.inputStep();
    }
    const decay = Math.exp(-dt * 10);
    this.corr.x *= decay;
    this.corr.y *= decay;

    const s = this.latest;
    if (!s) return;
    const [a, b, t] = this.sampleBuffer();
    this.renderItems(a, b, t, s);
    this.renderPlayers(a, b, t, s, dt);
    this.renderGuards(a, b, t, s, dt);
    this.overlay.clear();
    this.renderDevices(s);
    this.renderCones(a, b, t, s);
    this.renderHint(s);
    this.renderOverlay(s);
    this.camFlash = Math.max(0, this.camFlash - dt);
  }

  private sampleBuffer(): [Snapshot, Snapshot, number] {
    const last = this.buffer[this.buffer.length - 1];
    if (this.offset === null || this.buffer.length < 2) return [last, last, 0];
    const rt = performance.now() - this.offset - INTERP_DELAY;
    for (let i = this.buffer.length - 2; i >= 0; i--) {
      const a = this.buffer[i];
      const b = this.buffer[i + 1];
      if (a.t <= rt) {
        if (rt >= b.t) return [b, b, 0];
        return [a, b, (rt - a.t) / (b.t - a.t)];
      }
    }
    return [this.buffer[0], this.buffer[0], 0];
  }

  private myDisplayPos(s: Snapshot): Vec | null {
    if (!this.pred || !this.prevPred || !this.predictionActive(s)) return null;
    const t = this.acc / INPUT_DT;
    return { x: lerp(this.prevPred.x, this.pred.x, t) + this.corr.x, y: lerp(this.prevPred.y, this.pred.y, t) + this.corr.y };
  }

  private renderPlayers(a: Snapshot, b: Snapshot, t: number, s: Snapshot, dt: number) {
    const names = this.bridge.names();
    for (const seat of [0, 1] as Seat[]) {
      const pa = a.players[seat];
      const pb = b.players[seat];
      const cur = s.players[seat];
      const view = this.players[seat];
      // Solo : le deuxième cambrioleur n'existe pas.
      const present = !!cur && !!pa && !!pb;
      for (const o of [view.body, view.shadow, view.label]) o.setVisible(present);
      if (!present) {
        view.carried.setVisible(false);
        view.badge.setVisible(false);
        continue;
      }
      let x = lerp(pa.x, pb.x, t);
      let y = lerp(pa.y, pb.y, t);
      // Téléportation (capture, libération) : pas d'interpolation.
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > 60) {
        x = pb.x;
        y = pb.y;
      }
      let angle = pa.angle + angleDiff(pb.angle, pa.angle) * t;
      let moving = pb.moving;
      if (seat === s.you) {
        const mine = this.myDisplayPos(s);
        if (mine) {
          x = mine.x;
          y = mine.y;
          angle = this.myAngle;
          moving = this.myMoving;
        }
      }
      const label = seat === s.you ? 'Toi' : names[seat] || 'Complice';
      this.drawChar(view, `p${seat}`, x, y, angle, moving, cur, dt, label);
    }
  }

  private drawChar(view: CharView, prefix: string, x: number, y: number, angle: number, moving: boolean, p: PlayerSnap | null, dt: number, label: string) {
    const { dir, flip } = facingOf(angle);
    if (moving) view.walk += dt * 8;
    else view.walk = 0;
    const frame = moving ? 1 + (Math.floor(view.walk) % 2) : 0;
    const carry = !!p?.carry;
    view.body.setTexture(charKey(prefix as 'p0', dir, frame, carry && prefix !== 'guard'));
    view.body.setFlipX(flip);
    const bob = moving ? -Math.abs(Math.sin(view.walk * Math.PI)) * 2.5 : 0;
    view.body.setPosition(x, y + 6 + bob);
    view.shadow.setPosition(x, y + 6);
    const depth = y + 10;
    view.body.setDepth(depth);
    view.shadow.setDepth(depth - 1);
    view.label.setText(label).setPosition(x, y - CHAR_H + 6).setDepth(9000);
    view.body.setAlpha(p?.jailed ? 0.85 : 1);

    if (p?.carry?.kind === 'small') {
      view.carried
        .setTexture(`item_${p.carry.item}`)
        .setVisible(true)
        .setPosition(x, y - 38 + bob + Math.sin(this.time.now / 150) * 1.5)
        .setDepth(depth + 1)
        .setScale(0.85);
      view.label.setY(y - CHAR_H - 16);
    } else {
      view.carried.setVisible(false);
    }
    view.badge.setVisible(!!p?.leave).setPosition(x + 18, y - 40).setDepth(9001);
  }

  private renderGuards(a: Snapshot, b: Snapshot, t: number, s: Snapshot, dt: number) {
    this.guards.forEach((view, i) => {
      const ga = a.guards[i];
      const gb = b.guards[i];
      const present = !!ga && !!gb && !!s.guards[i];
      for (const o of [view.body, view.shadow, view.label, this.guardBubbles[i]]) o.setVisible(present);
      if (present) this.renderGuard(view, this.guardBubbles[i], ga, gb, s.guards[i], t, dt);
    });
  }

  private renderGuard(view: CharView, bubble: Phaser.GameObjects.Text, ga: GuardSnap, gb: GuardSnap, g: GuardSnap, t: number, dt: number) {
    const x = lerp(ga.x, gb.x, t);
    const y = lerp(ga.y, gb.y, t);
    const angle = ga.angle + angleDiff(gb.angle, ga.angle) * t;
    this.drawChar(view, 'guard', x, y, angle, gb.moving, null, dt, 'Gardien');
    let txt = '';
    let color = '#ff4d4d';
    if (g.state === 'chase') txt = '!';
    else if (g.state === 'stunned') {
      txt = '★';
      color = '#ffd34d';
    } else if (g.state === 'investigate' || g.state === 'search' || g.suspicion > 0.15) {
      txt = '?';
      color = g.suspicion > 0.5 ? '#ff8a3c' : '#ffd34d';
    }
    const pulse = txt === '!' ? 1 + Math.sin(this.time.now / 80) * 0.12 : 1;
    bubble.setText(txt).setColor(color).setPosition(x, y - CHAR_H - 8).setScale(pulse);
    view.label.setVisible(!txt);
  }

  private renderItems(a: Snapshot, b: Snapshot, t: number, s: Snapshot) {
    const now = this.time.now;
    for (const it of s.items) {
      const view = this.items.get(it.id)!;
      const def = ITEM_CATALOG[it.id];
      const ia = a.items.find((i) => i.id === it.id) ?? it;
      const ib = b.items.find((i) => i.id === it.id) ?? it;
      const x = lerp(ia.x, ib.x, t);
      const y = lerp(ia.y, ib.y, t);
      const onMap = it.state === 'idle' || (it.state === 'carried' && def.kind === 'big');
      view.sprite.setVisible(onMap);
      view.glow.setVisible(it.state === 'idle');
      view.spark.setVisible(it.state === 'idle');
      if (onMap) {
        const bob = it.state === 'idle' && def.kind === 'small' ? Math.sin(now / 300 + it.id.length * 40) * 2 : 0;
        view.sprite.setPosition(x, y + bob).setDepth(y + (def.kind === 'big' ? def.h / 2 : 8));
        view.glow.setPosition(x, y);
        view.spark.setPosition(x + 10, y - 12);
      }
      if (it.state === 'delivered') this.showInTruck(it);
    }
  }

  private showInTruck(it: ItemSnap) {
    if (this.truckLoot.has(it.id)) return;
    const slots: Record<string, [number, number, number]> = {
      safe: [120, 34, 0.75],
      clock: [170, 32, 0.7],
      toaster: [100, 76, 0.8],
      console: [130, 78, 0.8],
      necklace: [160, 76, 0.8],
      laptop: [185, 72, 0.8],
      painting: [150, 30, 0.6],
      statue: [92, 36, 0.65],
      vase: [112, 56, 0.75],
      goldbar: [142, 56, 0.8],
      diamond: [168, 56, 0.8],
    };
    const [sx, sy, sc] = slots[it.id] ?? [140, 50, 0.7];
    const img = this.add.image(TRUCK_RECT.x + sx - 6, TRUCK_RECT.y + sy, `item_${it.id}`).setScale(0).setDepth(this.truck.depth + 1);
    this.tweens.add({ targets: img, scale: sc, duration: 350, ease: 'Back.Out' });
    this.truckLoot.set(it.id, img);
  }

  clearTruck() {
    for (const img of this.truckLoot.values()) img.destroy();
    this.truckLoot.clear();
  }

  private renderDevices(s: Snapshot) {
    const cam = s.camera;
    const blink = Math.floor(this.time.now / 400) % 2 === 0;
    this.level.cameras.forEach((_, i) => {
      const v = this.cams[i];
      if (!v) return;
      v.led.setTint(cam.alarm ? 0xff3b3b : 0xff6b6b).setVisible(cam.enabled && (cam.alarm || blink));
      v.sprite.setAlpha(cam.enabled ? 1 : 0.55);
      v.off.setVisible(!cam.enabled).setText(s.cameraOff > 0 ? `OFF ${Math.ceil(s.cameraOff)} s` : 'OFF');
    });
    this.switchSprite.setTexture(cam.enabled ? 'switch_on' : 'switch_off');
    this.lock.setVisible(s.players.some((p) => p.jailed));
    // Progression de libération autour du cadenas, visible des deux côtés.
    if (s.freeProgress > 0) this.drawProgress(JAIL.lock.x, JAIL.lock.y - 16, s.freeProgress);
    this.renderPuzzles(s);
  }

  /** Portes verrouillées, plaques de pression et lasers. */
  private renderPuzzles(s: Snapshot) {
    const f = this.floorFx;
    const w = this.wallFx;
    f.clear();
    w.clear();
    const now = this.time.now;
    for (const g of this.level.gates) {
      const open = !!s.gates.find((x) => x.id === g.id)?.open;
      const r = g.rect;
      if (g.lock.type === 'plate') {
        const p = g.lock.plate;
        f.fillStyle(0x2a1f3d, 0.5);
        f.fillRoundedRect(p.x - 3, p.y - 3, p.w + 6, p.h + 6, 8);
        f.fillStyle(open ? 0x4fd18b : 0xb8bfce);
        f.fillRoundedRect(p.x, p.y + (open ? 3 : 0), p.w, p.h - (open ? 3 : 0), 6);
        f.lineStyle(2, open ? 0x2f9e64 : 0x8a92a6);
        f.strokeRoundedRect(p.x + 8, p.y + 8 + (open ? 3 : 0), p.w - 16, p.h - 16 - (open ? 3 : 0), 4);
        if (!open) {
          // Grille : barreaux dans l'ouverture.
          w.fillStyle(0x3a3f52);
          w.fillRect(r.x, r.y, r.w, r.h);
          w.fillStyle(0xb8bfce);
          if (g.vertical) for (let y = r.y + 4; y < r.y + r.h; y += 10) w.fillRect(r.x, y, r.w, 4);
          else for (let x = r.x + 4; x < r.x + r.w; x += 10) w.fillRect(x, r.y, 4, r.h);
        }
      } else if (!open) {
        // Porte blindée.
        w.fillStyle(0x2a1f3d);
        w.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
        w.fillStyle(0x7c879c);
        w.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        w.fillStyle(0xff5a5a);
        w.fillCircle(r.x + r.w / 2, r.y + r.h / 2, 4);
      }
    }
    this.level.lasers.forEach((l, i) => {
      const on = !!s.lasers[i];
      for (const end of [l.a, l.b]) {
        w.fillStyle(0x2a1f3d);
        w.fillCircle(end.x, end.y, 7);
        w.fillStyle(on ? 0xff3b3b : 0x6b6478);
        w.fillCircle(end.x, end.y, 4);
      }
      if (on) {
        const pulse = 0.55 + Math.abs(Math.sin(now / 90)) * 0.35;
        w.lineStyle(7, 0xff3b3b, 0.22);
        w.lineBetween(l.a.x, l.a.y, l.b.x, l.b.y);
        w.lineStyle(2.5, 0xff5a5a, pulse);
        w.lineBetween(l.a.x, l.a.y, l.b.x, l.b.y);
      } else {
        // Faisceau éteint : pointillés discrets pour qu'on sache où il passe.
        f.lineStyle(1.5, 0xff5a5a, 0.35);
        const len = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y);
        for (let d = 0; d < len; d += 16) {
          const t0 = d / len;
          const t1 = Math.min(1, (d + 7) / len);
          f.lineBetween(l.a.x + (l.b.x - l.a.x) * t0, l.a.y + (l.b.y - l.a.y) * t0, l.a.x + (l.b.x - l.a.x) * t1, l.a.y + (l.b.y - l.a.y) * t1);
        }
      }
    });
  }

  private cone(origin: Vec, angle: number, range: number, half: number, color: number, alpha: number) {
    const rays = 36;
    const pts: Vec[] = [{ x: origin.x, y: origin.y }];
    for (let i = 0; i <= rays; i++) {
      const a = angle - half + (i / rays) * half * 2;
      const d = raycast(origin, a, range, this.coneBlockers);
      pts.push({ x: origin.x + Math.cos(a) * d, y: origin.y + Math.sin(a) * d });
    }
    this.cones.fillStyle(color, alpha);
    this.cones.fillPoints(pts, true);
    this.cones.lineStyle(2, color, Math.min(1, alpha * 2.4));
    this.cones.strokePoints(pts, true);
  }

  private renderCones(a: Snapshot, b: Snapshot, t: number, s: Snapshot) {
    this.cones.clear();
    this.coneBlockers = this.blockers(s);
    s.guards.forEach((g, i) => {
      const ga = a.guards[i];
      const gb = b.guards[i];
      if (!ga || !gb || g.state === 'stunned') return;
      const gpos = { x: lerp(ga.x, gb.x, t), y: lerp(ga.y, gb.y, t) };
      const gangle = ga.angle + angleDiff(gb.angle, ga.angle) * t;
      let color = 0xfff3a0;
      let alpha = 0.22;
      if (g.state === 'chase') {
        color = 0xff4d4d;
        alpha = 0.26;
      } else if (g.suspicion > 0.3 || g.state === 'investigate') {
        color = 0xffa04d;
        alpha = 0.24;
      }
      this.cone(gpos, gangle, GUARD_VIEW_RANGE, GUARD_VIEW_HALF_ANGLE, color, alpha);
    });
    if (s.camera.enabled) {
      const alarm = s.camera.alarm || this.camFlash > 0;
      const pulse = alarm ? 0.22 + Math.abs(Math.sin(this.time.now / 120)) * 0.14 : 0.16;
      for (const cam of this.level.cameras) this.cone(cam, cam.angle, CAMERA_RANGE, CAMERA_HALF_ANGLE, alarm ? 0xff4d4d : 0x8fd3ff, pulse);
    }
  }

  private renderHint(s: Snapshot) {
    const me = s.players[s.you];
    const names = this.bridge.names();
    const partner = names[s.you === 0 ? 1 : 0] || 'ton complice';
    const pos = this.myDisplayPos(s) ?? me;
    let text = '';
    if (s.phase !== 'playing') text = '';
    else if (me.jailed && s.solo) text = `Enfermé ! Tu crochètes le cadenas…\nÉvasion dans ${Math.max(1, Math.ceil(SOLO_JAIL_TIME * (1 - s.freeProgress)))} s`;
    else if (me.jailed) text = `Enfermé ! ${partner} peut te libérer\nen maintenant E au cadenas`;
    else if (me.carry?.kind === 'small') text = `Apporte-le au camion · Espace : lâcher`;
    else if (me.carry?.kind === 'big') {
      const it = s.items.find((i) => i.id === me.carry!.item)!;
      if (s.solo) text = it.push === 'blocked' ? 'Ça coince ! Essaie un autre angle' : it.push === 'wait' ? 'C’est lourd… tire-le jusqu’au camion\nEspace : lâcher' : '';
      else if (it.state === 'idle') text = `En attente de ${partner} à l'autre poignée…\nEspace : lâcher`;
      else if (it.push === 'opposed') text = 'Poussez dans la même direction !';
      else if (it.push === 'blocked') text = 'Ça coince ! Essayez un autre angle';
      else if (it.push === 'wait') text = 'Avancez ensemble · Espace : lâcher';
      else text = '';
    } else if (me.leave) {
      text = `Prêt à partir ✓ — en attente de ${partner}`;
    } else {
      const players = s.players.map((p, i) => (i === s.you ? { ...p, x: pos.x, y: pos.y } : p));
      const inter = findInteraction(this.level, players, s.items, s.gates, s.you);
      const plate = this.level.gates.find((g) => g.lock.type === 'plate' && pointInRect(pos.x, pos.y, g.lock.plate));
      if (inter?.type === 'keypad') text = 'E : taper le code';
      else if (inter?.type === 'note') text = s.clues.some((c) => c.gate === inter.gate && c.index === inter.index) ? 'E : relire l’indice' : 'E : lire le papier';
      else if (plate) text = `Tu tiens ${plate.name} ouverte`;
      else if (inter?.type === 'free') text = `Maintiens E : libérer ${partner}`;
      else if (inter?.type === 'switch' && s.solo) text = s.cameraOff > 0 ? `Caméra coupée (${Math.ceil(s.cameraOff)} s)` : `E : couper la caméra ${SOLO_CAMERA_OFF_TIME} s`;
      else if (inter?.type === 'switch') text = me.hold === 'switch' ? 'Caméra coupée ! Garde E enfoncé' : 'Maintiens E : couper la caméra';
      else if (inter?.type === 'grab') text = `E : saisir ${ITEM_CATALOG[inter.item].name} (${s.solo ? 'lourd !' : 'à deux'})`;
      else if (inter?.type === 'pick') {
        const d = ITEM_CATALOG[inter.item];
        text = `E : prendre ${d.name} (${d.value} €)`;
      } else if (inter?.type === 'leave' && s.solo) {
        text = 'E : partir avec le butin';
      } else if (inter?.type === 'leave') {
        const ready = s.players.filter((p) => p.leave).length;
        text = `E : partir (${ready}/2 prêts)`;
      }
    }
    if (!text) {
      this.hintContainer.setVisible(false);
      return;
    }
    if (this.hintText.text !== text) {
      this.hintText.setText(text);
      const w = this.hintText.width + 18;
      const h = this.hintText.height + 10;
      this.hintBg.clear();
      this.hintBg.fillStyle(0x2a1f3d, 0.88);
      this.hintBg.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
      this.hintBg.lineStyle(2, Phaser.Display.Color.HexStringToColor(PALETTES[s.you].css).color, 1);
      this.hintBg.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    }
    const h = this.hintText.height + 10;
    const above = me.carry?.kind === 'small' ? 92 : 76;
    const hx = Phaser.Math.Clamp(pos.x, this.hintText.width / 2 + 14, WORLD_W - this.hintText.width / 2 - 14);
    // Trop près du haut de la carte : l'indication passe sous le personnage.
    const hy = pos.y - above < h / 2 + 4 ? pos.y + 34 : pos.y - above;
    this.hintContainer.setVisible(true).setPosition(hx, hy);
  }

  private drawProgress(x: number, y: number, p: number) {
    this.overlay.lineStyle(5, 0x2a1f3d, 0.8);
    this.overlay.strokeCircle(x, y, 20);
    this.overlay.lineStyle(4, 0x4fd18b, 1);
    this.overlay.beginPath();
    this.overlay.arc(x, y, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p));
    this.overlay.strokePath();
  }

  private renderOverlay(s: Snapshot) {
    // Bordure rouge quand le gardien me poursuit.
    if (s.guards.some((g) => g.state === 'chase' && g.target === s.you)) {
      const a = 0.25 + Math.abs(Math.sin(this.time.now / 180)) * 0.25;
      this.overlay.lineStyle(26, 0xff3b3b, a);
      this.overlay.strokeRect(0, 0, WORLD_W, WORLD_H);
    }
  }

  private floatText(x: number, y: number, text: string, color: string, size = 22) {
    const t = this.add
      .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: '700', color, stroke: '#2a1f3d', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(9600);
    this.tweens.add({ targets: t, y: y - 46, alpha: { from: 1, to: 0 }, duration: 1300, ease: 'Cubic.Out', onComplete: () => t.destroy() });
  }

  private handleEvents(events: GameEvent[], s: Snapshot) {
    const names = this.bridge.names();
    const you = s.you;
    const nameOf = (seat: Seat) => (seat === you ? 'Toi' : names[seat] || 'Ton complice');
    const partner = names[you === 0 ? 1 : 0] || 'Ton complice';
    for (const ev of events) {
      switch (ev.type) {
        case 'pickup': {
          const p = s.players[ev.seat];
          this.sparkEmitter.explode(14, p.x, p.y - 30);
          this.floatText(p.x, p.y - 60, ITEM_CATALOG[ev.item].name, '#ffffff', 16);
          sfx.pickup();
          break;
        }
        case 'grab': {
          sfx.pickup();
          if (ev.seat !== you) {
            const it = s.items.find((i) => i.id === ev.item);
            if (it && it.state === 'idle') this.bridge.toast(`${partner} tient ${ITEM_CATALOG[ev.item].name} : prends l'autre poignée !`);
          }
          break;
        }
        case 'drop':
          sfx.drop();
          break;
        case 'deliver': {
          this.coinEmitter.explode(18, ev.x, ev.y);
          this.sparkEmitter.explode(10, ev.x, ev.y);
          this.floatText(ev.x, ev.y - 40, `+${ev.value} €`, '#ffd34d', 28);
          this.tweens.add({ targets: this.truck, y: this.truck.y - 6, yoyo: true, duration: 110, repeat: 1 });
          sfx.deliver();
          break;
        }
        case 'capture': {
          this.puffEmitter.explode(12, ev.x, ev.y);
          this.floatText(ev.x, ev.y - 40, 'Attrapé !', '#ff4d4d', 26);
          this.cameras.main.shake(220, 0.006);
          sfx.capture();
          this.bridge.toast(
            s.solo
              ? `Le gardien t’a attrapé ! ${SOLO_JAIL_TIME} s au cabanon.`
              : ev.seat === you
                ? 'Le gardien t’a attrapé ! Direction le cabanon.'
                : `${partner} est au cabanon ! Maintiens E devant le cadenas pour le libérer.`,
            'bad',
          );
          break;
        }
        case 'freed': {
          const ex = JAIL.exits[ev.seat];
          this.sparkEmitter.explode(16, ex.x, ex.y);
          this.floatText(ex.x, ex.y - 30, 'Libéré !', '#4fd18b', 22);
          sfx.freed();
          break;
        }
        case 'cameraAlert':
          this.camFlash = 0.8;
          sfx.camera();
          this.bridge.toast(`La caméra ${s.solo ? 't’a repéré' : 'vous a repérés'} ! Le gardien vient voir.`, 'bad');
          break;
        case 'guardAlert':
          sfx.alert();
          this.bridge.toast(ev.seat === you ? 'Le gardien t’a repéré ! Cours !' : `Le gardien poursuit ${partner} !`, 'bad');
          break;
        case 'guardLost':
          this.bridge.toast(`Ouf… le gardien a perdu ${s.solo ? 'ta' : 'votre'} trace.`, 'good');
          break;
        case 'leave':
          if (ev.seat !== you) this.bridge.toast(`${nameOf(ev.seat)} est prêt à partir : rejoins le camion et appuie sur E.`, 'info');
          break;
        case 'denied':
          if (ev.seat === you) this.bridge.toast(ev.reason, 'info');
          break;
        case 'laser':
          this.camFlash = 0.8;
          this.puffEmitter.explode(6, ev.x, ev.y);
          sfx.camera();
          this.bridge.toast('Laser touché ! L’alarme prévient le gardien.', 'bad');
          break;
        case 'note': {
          if (ev.seat !== you) break;
          const clue = s.clues.find((c) => c.gate === ev.gate && c.index === ev.index);
          sfx.pickup();
          if (clue) this.bridge.toast(`Indice : ${clue.text}`, 'good');
          break;
        }
        case 'codeOk': {
          const g = this.level.gates.find((x) => x.id === ev.gate);
          sfx.freed();
          if (g) {
            this.sparkEmitter.explode(18, g.rect.x + g.rect.w / 2, g.rect.y + g.rect.h / 2);
            this.bridge.toast(`Code bon ! ${g.name.charAt(0).toUpperCase() + g.name.slice(1)} s’ouvre.`, 'good');
          }
          break;
        }
        case 'codeWrong':
          sfx.camera();
          this.bridge.toast(ev.seat === you ? 'Mauvais code ! Le bip a alerté le gardien.' : `${partner} s’est trompé de code ! Le gardien arrive.`, 'bad');
          break;
      }
    }
  }
}
