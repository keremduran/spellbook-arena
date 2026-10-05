import Phaser from 'phaser';
import { FOUNTAIN, FOUNTAIN_RADIUS, LANE_Y, MAP_H, MAP_W, STEP, Y_MAX, Y_MIN } from '../sim/constants';
import { Rng } from '../sim/rng';
import type { GameEvent, Slot, Unit } from '../sim/types';
import type { World } from '../sim/world';

const hex = (s: string) => parseInt(s.slice(1, 7), 16);
const TEAM_COLOR = { blue: 0x4fa3ff, red: 0xff5a5a };
const KEY_SLOTS: Record<string, Slot> = { q: 'Q', w: 'W', e: 'E', r: 'R' };

export interface SceneHooks {
  onEvents: (events: GameEvent[]) => void;
  onFrame: (dt: number) => void;
  onBoonKey: (index: number) => void;
  onToggleScoreboard: (show: boolean) => void;
  onPause: () => void;
  isPaused: () => boolean;
}

interface FloatText {
  text: Phaser.GameObjects.Text;
  x: number;
  y: number;
  born: number;
}

export class ArenaScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private labels = new Map<number, { icon: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text }>();
  private floats: FloatText[] = [];
  private acc = 0;
  private mouse = { x: 0, y: 0 };
  private rightDown = false;

  constructor(private world: World, private player: Unit, private hooks: SceneHooks) {
    super('arena');
  }

  create() {
    this.drawBackground();
    this.g = this.add.graphics().setDepth(5);
    for (const h of this.world.heroList) {
      const icon = this.add.text(0, 0, h.hero!.def.icon, { fontSize: '26px', fontFamily: 'sans-serif' }).setOrigin(0.5).setDepth(6);
      const name = this.add
        .text(0, 0, '', { fontSize: '15px', fontFamily: 'Inter, system-ui, sans-serif', color: h.hero!.isPlayer ? '#ffe082' : '#ffffff', stroke: '#000', strokeThickness: 3 })
        .setOrigin(0.5, 1)
        .setDepth(7);
      this.labels.set(h.id, { icon, name });
    }
    this.layoutCamera();
    this.scale.on('resize', () => this.layoutCamera());

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.hooks.isPaused()) return;
      this.rightDown = true;
      this.command(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.mouse = { x: wp.x, y: wp.y };
      if (this.rightDown && p.isDown && !p.wasTouch) this.command(p, true);
    });
    this.input.on('pointerup', () => (this.rightDown = false));

    const kb = this.input.keyboard!;
    kb.addCapture('TAB');
    kb.on('keydown', (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') return this.hooks.onPause();
      if (k === 'tab') return this.hooks.onToggleScoreboard(true);
      if (this.hooks.isPaused()) return;
      if (KEY_SLOTS[k]) this.world.castAbility(this.player, KEY_SLOTS[k], this.mouse);
      if (k === '1' || k === '2' || k === '3') this.hooks.onBoonKey(Number(k) - 1);
      if (k === 's') this.player.order = { kind: 'idle' };
    });
    kb.on('keyup', (e: KeyboardEvent) => {
      if (e.key === 'Tab') this.hooks.onToggleScoreboard(false);
    });
  }

  /** Click on an enemy to attack it, anywhere else to move. */
  private command(p: Phaser.Input.Pointer, dragging = false) {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    this.mouse = { x: wp.x, y: wp.y };
    const u = this.player;
    if (u.dead) return;
    const target = this.world.units.find((t) => t.team !== u.team && !t.dead && this.world.isVisible(t, u.team) && Math.hypot(t.x - wp.x, t.y - wp.y) < t.radius + 18);
    if (target) {
      u.order = { kind: 'attack', id: target.id };
    } else {
      u.order = { kind: 'move', x: wp.x, y: wp.y };
      if (!dragging) this.world.fx({ kind: 'ring', x: wp.x, y: wp.y, r: 22, color: '#a5d6a7', duration: 0.3 });
    }
  }

  private layoutCamera() {
    const cam = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const zoom = Math.min(width / (touch ? 1250 : 1600), height / (touch ? 720 : 900));
    cam.setZoom(zoom);
    cam.setBounds(0, 0, MAP_W, MAP_H);
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.1);
    if (!this.hooks.isPaused() && !this.world.winner) {
      this.acc += dt;
      while (this.acc >= STEP) {
        this.world.update(STEP);
        this.acc -= STEP;
      }
    }
    if (this.world.events.length) {
      const events = this.world.events.splice(0);
      for (const e of events) if (e.type === 'damage') this.spawnFloat(e);
      this.hooks.onEvents(events);
    }
    const focus = this.player.dead ? FOUNTAIN[this.player.team] : this.player;
    const cam = this.cameras.main;
    const cx = cam.midPoint.x + (focus.x - cam.midPoint.x) * Math.min(1, dt * 8);
    const cy = cam.midPoint.y + (focus.y - cam.midPoint.y) * Math.min(1, dt * 8);
    cam.centerOn(cx, cy);
    this.render();
    this.hooks.onFrame(dt);
  }

  // ------------------------------------------------------------------ drawing

  private drawBackground() {
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x0c140f).fillRect(-400, -400, MAP_W + 800, MAP_H + 800);
    g.fillStyle(0x1a2a1e).fillRect(0, Y_MIN - 40, MAP_W, Y_MAX - Y_MIN + 80);
    g.fillStyle(0x223828).fillRect(0, LANE_Y - 190, MAP_W, 380);
    g.fillStyle(0x2a4230, 0.6).fillRect(0, LANE_Y - 70, MAP_W, 140);
    // Base tints.
    g.fillStyle(TEAM_COLOR.blue, 0.07).fillRect(0, Y_MIN - 40, 1000, Y_MAX - Y_MIN + 80);
    g.fillStyle(TEAM_COLOR.red, 0.07).fillRect(MAP_W - 1000, Y_MIN - 40, 1000, Y_MAX - Y_MIN + 80);
    // Lane walls with trees and rocks.
    const rng = new Rng(42);
    for (let i = 0; i < 260; i++) {
      const top = i % 2 === 0;
      const x = rng.range(-100, MAP_W + 100);
      const y = top ? rng.range(-200, Y_MIN - 50) : rng.range(Y_MAX + 50, MAP_H + 200);
      const r = rng.range(30, 75);
      g.fillStyle(rng.next() < 0.75 ? 0x14301c : 0x2b2f33, 1).fillCircle(x, y, r);
      g.fillStyle(0x1d4027, 0.8).fillCircle(x - r * 0.25, y - r * 0.25, r * 0.55);
    }
    for (let i = 0; i < 120; i++) {
      g.fillStyle(0x2f4a35, 0.5).fillCircle(rng.range(0, MAP_W), rng.range(Y_MIN, Y_MAX), rng.range(2, 6));
    }
    for (const team of ['blue', 'red'] as const) {
      const f = FOUNTAIN[team];
      g.fillStyle(TEAM_COLOR[team], 0.12).fillCircle(f.x, f.y, FOUNTAIN_RADIUS);
      g.lineStyle(4, TEAM_COLOR[team], 0.5).strokeCircle(f.x, f.y, FOUNTAIN_RADIUS);
      g.fillStyle(TEAM_COLOR[team], 0.35).fillCircle(f.x, f.y, 60);
    }
  }

  private hpBar(x: number, y: number, w: number, h: number, pct: number, color: number, shield = 0) {
    const g = this.g;
    g.fillStyle(0x000000, 0.75).fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
    g.fillStyle(color, 1).fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, pct)), h);
    if (shield > 0) g.fillStyle(0xffffff, 0.85).fillRect(x - w / 2 + w * Math.min(1, pct), y, Math.min(w * (1 - pct), w * shield), h);
  }

  private render() {
    const w = this.world;
    const g = this.g;
    const t = w.time;
    const me = this.player;
    g.clear();

    for (const z of w.zones) {
      const c = hex(z.color);
      g.fillStyle(c, 0.16).fillCircle(z.x, z.y, z.radius);
      g.lineStyle(2, c, 0.6).strokeCircle(z.x, z.y, z.radius);
      if (z.pull) g.lineStyle(2, c, 0.4).strokeCircle(z.x, z.y, z.radius * (1 - ((t * 1.5) % 1)));
    }
    for (const n of w.novas) {
      const c = hex(n.color);
      const prog = n.at > n.start ? (t - n.start) / (n.at - n.start) : 1;
      g.lineStyle(2, c, 0.8).strokeCircle(n.x, n.y, n.radius);
      g.fillStyle(c, 0.12 + 0.2 * prog).fillCircle(n.x, n.y, n.radius * prog);
    }

    for (const u of w.units) {
      if (u.dead || u.kind === 'hero') continue;
      const tc = TEAM_COLOR[u.team];
      if (u.kind === 'tower') {
        const prot = w.isProtected(u);
        if (Math.hypot(me.x - u.x, me.y - u.y) < u.stats.attackRange + 250 && u.team !== me.team) {
          g.lineStyle(2, 0xff5252, 0.25).strokeCircle(u.x, u.y, u.stats.attackRange);
        }
        g.fillStyle(0x263238).fillRoundedRect(u.x - 40, u.y - 40, 80, 80, 14);
        g.fillStyle(tc, 0.9).fillRoundedRect(u.x - 30, u.y - 30, 60, 60, 10);
        g.fillStyle(0xffffff, 0.8).fillCircle(u.x, u.y, 10);
        if (prot) g.lineStyle(3, 0xffffff, 0.35).strokeCircle(u.x, u.y, 52);
        this.hpBar(u.x, u.y - 62, 90, 9, u.hp / u.stats.maxHp, tc);
      } else if (u.kind === 'nexus') {
        const pts = [
          new Phaser.Math.Vector2(u.x, u.y - 70), new Phaser.Math.Vector2(u.x + 50, u.y),
          new Phaser.Math.Vector2(u.x, u.y + 70), new Phaser.Math.Vector2(u.x - 50, u.y),
        ];
        g.fillStyle(0x263238).fillCircle(u.x, u.y, 66);
        g.fillStyle(tc, 0.95).fillPoints(pts, true);
        g.fillStyle(0xffffff, 0.5).fillCircle(u.x, u.y - 10, 12);
        if (w.isProtected(u)) g.lineStyle(3, 0xffffff, 0.35).strokeCircle(u.x, u.y, 80);
        this.hpBar(u.x, u.y - 95, 120, 10, u.hp / u.stats.maxHp, tc);
      } else {
        g.fillStyle(0x000000, 0.35).fillCircle(u.x + 3, u.y + 4, u.radius);
        g.fillStyle(tc, 0.95).fillCircle(u.x, u.y, u.radius);
        g.fillStyle(0xffffff, 0.25).fillCircle(u.x - 4, u.y - 4, u.radius * 0.45);
        if (u.creep?.ranged) g.lineStyle(2, 0xffffff, 0.6).strokeCircle(u.x, u.y, u.radius - 4);
        if (u.hp < u.stats.maxHp) this.hpBar(u.x, u.y - u.radius - 9, 34, 4, u.hp / u.stats.maxHp, u.team === me.team ? 0x81c784 : 0xe57373);
      }
    }

    for (const u of w.heroList) {
      const lab = this.labels.get(u.id)!;
      const hidden = u.dead || (u.team !== me.team && !w.isVisible(u, me.team));
      lab.icon.setVisible(!hidden);
      lab.name.setVisible(!hidden);
      if (hidden) continue;
      const h = u.hero!;
      const alpha = u.stealthUntil > t || u.invulnUntil > t ? 0.45 : 1;
      const tc = TEAM_COLOR[u.team];
      g.fillStyle(0x000000, 0.35).fillCircle(u.x + 4, u.y + 5, u.radius);
      g.fillStyle(tc, alpha).fillCircle(u.x, u.y, u.radius);
      g.fillStyle(hex(h.def.color), alpha).fillCircle(u.x, u.y, u.radius * 0.72);
      if (h.isPlayer) g.lineStyle(3, 0xffe082, 1).strokeCircle(u.x, u.y, u.radius + 4);
      if (u.invulnUntil > t) g.lineStyle(4, 0xffe082, 0.9).strokeCircle(u.x, u.y, u.radius + 10);
      if (u.shield > 0) g.lineStyle(3, 0xffffff, 0.8).strokeCircle(u.x, u.y, u.radius + 7);
      if (u.stunUntil > t) {
        for (let i = 0; i < 3; i++) {
          const a = t * 6 + (i * Math.PI * 2) / 3;
          g.fillStyle(0xffeb3b).fillCircle(u.x + Math.cos(a) * 18, u.y - u.radius - 6 + Math.sin(a) * 6, 4);
        }
      }
      if (u.slowUntil > t) g.lineStyle(2, 0x80deea, 0.8).strokeCircle(u.x, u.y, u.radius + 2);
      const barColor = h.isPlayer ? 0x66bb6a : u.team === me.team ? 0x42a5f5 : 0xef5350;
      this.hpBar(u.x, u.y - u.radius - 16, 64, 8, u.hp / u.stats.maxHp, barColor, u.shield / u.stats.maxHp);
      lab.icon.setPosition(u.x, u.y).setAlpha(alpha).setFontSize(Math.round(u.radius * 1.1));
      lab.name.setPosition(u.x, u.y - u.radius - 19).setText(`${h.level} ${h.name}`).setAlpha(alpha);
    }

    for (const p of w.projectiles) {
      const c = hex(p.color);
      g.fillStyle(c, 0.25).fillCircle(p.x, p.y, p.radius * 1.8);
      g.fillStyle(c, 1).fillCircle(p.x, p.y, p.radius);
    }

    for (const f of w.fxList) {
      const c = hex(f.color);
      const k = (t - f.start) / (f.until - f.start);
      if (f.kind === 'ring') g.lineStyle(3, c, 1 - k).strokeCircle(f.x, f.y, f.r * (0.6 + 0.4 * k));
      else if (f.kind === 'burst') g.fillStyle(c, 0.45 * (1 - k)).fillCircle(f.x, f.y, f.r * (0.7 + 0.3 * k));
      else g.lineStyle(f.width ?? 3, c, 1 - k * 0.7).lineBetween(f.x, f.y, f.x2 ?? f.x, f.y2 ?? f.y);
    }

    // Aim preview for the player's abilities while hovering.
    if (!me.dead && !this.input.activePointer.wasTouch) {
      g.lineStyle(1, 0xffffff, 0.12).lineBetween(me.x, me.y, this.mouse.x, this.mouse.y);
    }

    const now = this.time.now;
    this.floats = this.floats.filter((f) => {
      const age = (now - f.born) / 1000;
      if (age > 0.9) {
        f.text.destroy();
        return false;
      }
      f.text.setPosition(f.x, f.y - age * 60).setAlpha(1 - age / 0.9);
      return true;
    });
  }

  private spawnFloat(e: Extract<GameEvent, { type: 'damage' }>) {
    const me = this.player.id;
    if (e.srcId !== me && e.tgtId !== me) return;
    if (this.floats.length > 40) return;
    const amount = Math.round(e.amount);
    if (amount < 1) return;
    const color = e.heal ? '#69f0ae' : e.tgtId === me ? '#ff6e6e' : e.crit ? '#ffca28' : '#ffffff';
    const text = this.add
      .text(e.x + (Math.random() - 0.5) * 30, e.y, e.heal ? `+${amount}` : `${amount}${e.crit ? '!' : ''}`, {
        fontSize: e.crit ? '26px' : '20px', fontFamily: 'Inter, system-ui, sans-serif', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(20);
    this.floats.push({ text, x: text.x, y: text.y, born: this.time.now });
  }
}

