import Phaser from 'phaser';
import { FOUNTAIN, LANE_Y, MAP_H, MAP_W, STEP, laneDir } from '../sim/constants';
import type { GameEvent, Slot, Unit, Vec } from '../sim/types';
import type { World } from '../sim/world';
import { heroIconBase64 } from './heroIcons';
import { hex, TEAM_COLOR, Visuals } from './visuals';
const KEY_SLOTS: Record<string, Slot> = { q: 'Q', w: 'W', e: 'E', r: 'R' };

export interface SceneHooks {
  onEvents: (events: GameEvent[]) => void;
  onFrame: (dt: number) => void;
  onBoonKey: (index: number) => void;
  onToggleScoreboard: (show: boolean) => void;
  onPause: () => void;
  isPaused: () => boolean;
  /** Spectator mode: simulation speed multiplier. */
  speed?: () => number;
  /** Spectator mode: currently selected hero (camera follows it). */
  selected?: () => Unit | null;
  onSelect?: (u: Unit | null) => void;
  /** Spectator mode: show the next bot waiting on a boon. */
  onNextBoon?: () => void;
}

interface FloatText {
  text: Phaser.GameObjects.Text;
  x: number;
  y: number;
  born: number;
}

const PAN_KEYS: Record<string, [number, number]> = {
  arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1], a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
};

/** Renders the world. With a player it handles move/attack/cast input; without one it's a spectator camera. */
export class ArenaScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private labels = new Map<number, { icon: Phaser.GameObjects.Text; name: Phaser.GameObjects.Text }>();
  private floats: FloatText[] = [];
  private acc = 0;
  private mouse = { x: 0, y: 0 };
  private rightDown = false;
  private baseZoom = 1;
  private zoomMul = 1;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private camPos = { x: MAP_W / 2, y: LANE_Y };
  private held = new Set<string>();
  private aim: { slot: Slot; dir: Vec } | null = null;
  vis!: Visuals;

  constructor(private world: World, private player: Unit | null, private hooks: SceneHooks) {
    super('arena');
  }

  preload() {
    for (const h of this.world.heroList) {
      const key = `icon_${h.hero!.def.id}`;
      if (!this.textures.exists(key)) this.load.svg(key, heroIconBase64(h.hero!.def.id), { width: 160, height: 160 });
    }
  }

  create() {
    this.vis = new Visuals(this, this.world, () => this.player ?? this.hooks.selected?.() ?? null);
    this.vis.create();
    this.g = this.add.graphics().setDepth(5);
    for (const h of this.world.heroList) {
      const icon = this.add.text(0, 0, h.hero!.def.icon, { fontSize: '26px', fontFamily: 'sans-serif' }).setOrigin(0.5).setDepth(6).setShadow(0, 2, '#000', 4, false, true);
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
      if (!this.player) {
        this.drag = { x: p.x, y: p.y, moved: false };
        return;
      }
      if (this.hooks.isPaused()) return;
      // On touch screens you move only with the joystick; stray taps on the map do nothing.
      if (p.wasTouch) return;
      this.rightDown = true;
      this.command(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const wp = this.cameras.main.getWorldPoint(p.x, p.y);
      this.mouse = { x: wp.x, y: wp.y };
      if (!this.player) {
        if (this.drag && p.isDown) {
          const dx = p.x - this.drag.x;
          const dy = p.y - this.drag.y;
          if (this.drag.moved || Math.hypot(dx, dy) > 8) {
            if (!this.drag.moved) this.hooks.onSelect?.(null);
            this.drag.moved = true;
            const z = this.cameras.main.zoom;
            this.camPos.x -= dx / z;
            this.camPos.y -= dy / z;
            this.drag.x = p.x;
            this.drag.y = p.y;
          }
        }
        return;
      }
      if (this.rightDown && p.isDown && !p.wasTouch) this.command(p, true);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.rightDown = false;
      if (!this.player && this.drag && !this.drag.moved) {
        const wp = this.cameras.main.getWorldPoint(p.x, p.y);
        const hit = this.world.heroList.find((h) => !h.dead && Math.hypot(h.x - wp.x, h.y - wp.y) < h.radius + 22);
        this.hooks.onSelect?.(hit ?? null);
      }
      this.drag = null;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.zoomMul = Math.max(0.45, Math.min(2.2, this.zoomMul * (dy > 0 ? 0.9 : 1.1)));
      this.cameras.main.setZoom(this.baseZoom * this.zoomMul);
    });

    const kb = this.input.keyboard!;
    kb.addCapture('TAB');
    kb.on('keydown', (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') return this.hooks.onPause();
      if (k === 'tab') return this.hooks.onToggleScoreboard(true);
      if (!this.player) {
        if (PAN_KEYS[k]) {
          this.held.add(k);
          this.hooks.onSelect?.(null);
        }
        if (k === ' ') this.hooks.onPause();
        if (k === 'n') this.hooks.onNextBoon?.();
        if (k === '1' || k === '2' || k === '3') this.hooks.onBoonKey(Number(k) - 1);
        return;
      }
      if (this.hooks.isPaused()) return;
      if (KEY_SLOTS[k]) this.world.castAbility(this.player, KEY_SLOTS[k], this.mouse);
      if (k === '1' || k === '2' || k === '3') this.hooks.onBoonKey(Number(k) - 1);
      if (k === 's') this.player.order = { kind: 'idle' };
    });
    kb.on('keyup', (e: KeyboardEvent) => {
      if (e.key === 'Tab') this.hooks.onToggleScoreboard(false);
      this.held.delete(e.key.toLowerCase());
    });
  }

  /** Click on an enemy to attack it, anywhere else to move. */
  private command(p: Phaser.Input.Pointer, dragging = false) {
    const wp = this.cameras.main.getWorldPoint(p.x, p.y);
    this.mouse = { x: wp.x, y: wp.y };
    const u = this.player;
    if (!u || u.dead) return;
    const target = this.world.units.find((t) => t.team !== u.team && !t.dead && this.world.isVisible(t, u.team) && Math.hypot(t.x - wp.x, t.y - wp.y) < t.radius + 18);
    if (target) {
      u.order = { kind: 'attack', id: target.id };
    } else {
      u.order = { kind: 'move', x: wp.x, y: wp.y };
      if (!dragging) this.world.fx({ kind: 'ring', x: wp.x, y: wp.y, r: 22, color: '#a5d6a7', duration: 0.3 });
    }
  }

  /** Touch drag-to-aim preview (null clears it). */
  setAim(slot: Slot | null, dir: Vec | null) {
    this.aim = slot && dir ? { slot, dir } : null;
  }

  /** While the player is dead: the ally being watched. */
  private watchId?: number;

  /**
   * Where the camera goes while you're dead: the most advanced living ally (kept until they
   * die, then the next most advanced), or, with the whole team dead, your most advanced
   * standing tower or nexus.
   */
  private deathCam(me: Unit): { x: number; y: number } {
    const w = this.world;
    const dir = laneDir(me.team);
    const current = this.watchId !== undefined ? w.unit(this.watchId) : undefined;
    if (current && !current.dead) return current;
    const allies = w.heroList.filter((u) => u.team === me.team && u !== me && !u.dead);
    if (allies.length) {
      const front = allies.reduce((a, b) => (b.x * dir > a.x * dir ? b : a));
      this.watchId = front.id;
      return front;
    }
    this.watchId = undefined;
    const structures = w.units.filter((u) => u.team === me.team && !u.dead && (u.kind === 'tower' || u.kind === 'nexus'));
    if (structures.length) return structures.reduce((a, b) => (b.x * dir > a.x * dir ? b : a));
    return FOUNTAIN[me.team];
  }

  /** Spectator camera jump (minimap clicks). */
  lookAt(x: number, y: number) {
    this.camPos = { x, y };
  }

  private layoutCamera() {
    const cam = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    const span = this.player ? (touch ? 1250 : 1600) : 2000;
    this.baseZoom = Math.min(width / span, height / (span * 0.5625));
    cam.setZoom(this.baseZoom * this.zoomMul);
    cam.setBounds(0, 0, MAP_W, MAP_H);
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.1);
    if (!this.hooks.isPaused() && !this.world.winner) {
      this.acc += dt * (this.hooks.speed?.() ?? 1);
      let steps = 0;
      while (this.acc >= STEP && steps < 16) {
        this.world.update(STEP);
        this.acc -= STEP;
        steps++;
      }
      if (steps >= 16) this.acc = 0;
    }
    if (this.world.events.length) {
      const events = this.world.events.splice(0);
      for (const e of events) if (e.type === 'damage') this.spawnFloat(e);
      this.vis.onEvents(events);
      this.hooks.onEvents(events);
    }
    const cam = this.cameras.main;
    let focus: { x: number; y: number };
    if (this.player) {
      focus = this.player.dead ? this.deathCam(this.player) : this.player;
      if (!this.player.dead) this.watchId = undefined;
    } else {
      const sel = this.hooks.selected?.();
      if (sel) this.camPos = sel.dead ? { ...FOUNTAIN[sel.team] } : { x: sel.x, y: sel.y };
      for (const k of this.held) {
        const [px, py] = PAN_KEYS[k];
        this.camPos.x += (px * 900 * dt) / cam.zoom;
        this.camPos.y += (py * 900 * dt) / cam.zoom;
      }
      this.camPos.x = Math.max(0, Math.min(MAP_W, this.camPos.x));
      this.camPos.y = Math.max(0, Math.min(MAP_H, this.camPos.y));
      focus = this.camPos;
    }
    const cx = cam.midPoint.x + (focus.x - cam.midPoint.x) * Math.min(1, dt * 8);
    const cy = cam.midPoint.y + (focus.y - cam.midPoint.y) * Math.min(1, dt * 8);
    cam.centerOn(cx, cy);
    this.render();
    this.hooks.onFrame(dt);
  }

  // ------------------------------------------------------------------ drawing

  private hpBar(x: number, y: number, w: number, h: number, pct: number, color: number, shield = 0) {
    const g = this.g;
    g.fillStyle(0x000000, 0.75).fillRoundedRect(x - w / 2 - 2, y - 2, w + 4, h + 4, 3);
    g.fillStyle(color, 1).fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, pct)), h);
    g.fillStyle(0xffffff, 0.18).fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, pct)), h / 2);
    if (shield > 0) g.fillStyle(0xffffff, 0.85).fillRect(x - w / 2 + w * Math.min(1, pct), y, Math.min(w * (1 - pct), w * shield), h);
  }

  private render() {
    const w = this.world;
    const g = this.g;
    const t = w.time;
    const me = this.player;
    const view = me?.team ?? 'blue';
    const sel = this.hooks.selected?.() ?? null;
    g.clear();

    // Ground warnings for wind-ups: enemy ones in danger red with the spell's color filling in.
    for (const tg of w.telegraphs) {
      const enemy = tg.team !== view;
      const c = hex(tg.color);
      const edge = enemy ? 0xff5252 : 0xffffff;
      const prog = Math.max(0, Math.min(1, (t - tg.start) / Math.max(0.01, tg.at - tg.start)));
      if (tg.shape === 'circle') {
        g.fillStyle(enemy ? 0xff1744 : c, enemy ? 0.14 : 0.08).fillCircle(tg.x, tg.y, tg.size);
        g.fillStyle(c, 0.3).fillCircle(tg.x, tg.y, tg.size * prog);
        g.lineStyle(3, edge, enemy ? 0.85 : 0.4).strokeCircle(tg.x, tg.y, tg.size);
      } else {
        const dx = tg.x2 - tg.x;
        const dy = tg.y2 - tg.y;
        const l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l) * tg.size;
        const ny = (dx / l) * tg.size;
        const quad = (k: number) => [
          { x: tg.x + nx, y: tg.y + ny }, { x: tg.x + dx * k + nx, y: tg.y + dy * k + ny },
          { x: tg.x + dx * k - nx, y: tg.y + dy * k - ny }, { x: tg.x - nx, y: tg.y - ny },
        ];
        g.fillStyle(enemy ? 0xff1744 : c, enemy ? 0.16 : 0.08).fillPoints(quad(1), true);
        g.fillStyle(c, 0.35).fillPoints(quad(prog), true);
        g.lineStyle(2, edge, enemy ? 0.85 : 0.4).strokePoints(quad(1), true);
      }
      // The caster glows while charging up.
      const caster = w.unit(tg.ownerId);
      if (caster && !caster.dead) {
        g.lineStyle(4, c, 0.9).beginPath();
        g.arc(caster.x, caster.y, caster.radius + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
        g.strokePath();
      }
    }
    for (const z of w.zones) {
      const c = hex(z.color);
      g.fillStyle(c, 0.13).fillCircle(z.x, z.y, z.radius);
      g.lineStyle(3, c, 0.55).strokeCircle(z.x, z.y, z.radius);
      g.lineStyle(2, c, 0.35).strokeCircle(z.x, z.y, z.radius * (z.pull ? 1 - ((t * 1.5) % 1) : 0.6 + 0.4 * ((t * 0.8) % 1)));
    }
    for (const n of w.novas) {
      const c = hex(n.color);
      const prog = n.at > n.start ? (t - n.start) / (n.at - n.start) : 1;
      g.lineStyle(3, c, 0.9).strokeCircle(n.x, n.y, n.radius);
      g.fillStyle(c, 0.1 + 0.22 * prog).fillCircle(n.x, n.y, n.radius * prog);
    }
    // Enemy tower range warning when close.
    if (me) {
      for (const u of w.units) {
        if (u.dead || u.kind !== 'tower' || u.team === me.team) continue;
        const d = Math.hypot(me.x - u.x, me.y - u.y);
        if (d < u.stats.attackRange + 250) g.lineStyle(3, 0xff5252, d < u.stats.attackRange ? 0.55 : 0.22).strokeCircle(u.x, u.y, u.stats.attackRange);
      }
    }

    this.vis.frame(g, me ? me.team : null);

    for (const u of w.units) {
      if (u.dead || u.kind === 'hero') continue;
      const tc = TEAM_COLOR[u.team];
      if (u.kind === 'tower' || u.kind === 'nexus') {
        const top = u.kind === 'tower' ? u.y - 112 : u.y - 132;
        if (w.isProtected(u)) g.lineStyle(3, 0xffffff, 0.3).strokeCircle(u.x, u.y - 20, u.kind === 'tower' ? 62 : 90);
        this.hpBar(u.x, top, u.kind === 'tower' ? 96 : 130, 10, u.hp / u.stats.maxHp, tc);
      } else if (u.hp < u.stats.maxHp) {
        this.hpBar(u.x, u.y - u.radius - 10, 34, 4, u.hp / u.stats.maxHp, u.team === view ? 0x81c784 : 0xe57373);
      }
    }

    for (const u of w.heroList) {
      const lab = this.labels.get(u.id)!;
      const hidden = u.dead || (!!me && u.team !== me.team && !w.isVisible(u, me.team));
      lab.icon.setVisible(!hidden);
      lab.name.setVisible(!hidden);
      if (hidden) continue;
      const h = u.hero!;
      const alpha = u.stealthUntil > t || u.invulnUntil > t ? 0.45 : 1;
      if (h.isPlayer || u === sel) {
        g.lineStyle(3, 0xffe082, 0.9).strokeCircle(u.x, u.y, u.radius + 6 + Math.sin(t * 5) * 1.5);
      }
      if (!me && h.offers.length && h.managed) g.fillStyle(0xffca28, 0.9 + 0.1 * Math.sin(t * 6)).fillCircle(u.x + u.radius, u.y - u.radius, 7);
      if (u.invulnUntil > t) g.lineStyle(4, 0xffe082, 0.9).strokeCircle(u.x, u.y, u.radius + 12);
      if (u.shield > 0) {
        g.fillStyle(0xe3f2fd, 0.12).fillCircle(u.x, u.y, u.radius + 9);
        g.lineStyle(3, 0xffffff, 0.75).strokeCircle(u.x, u.y, u.radius + 9);
      }
      if (u.stunUntil > t) {
        for (let i = 0; i < 3; i++) {
          const a = t * 6 + (i * Math.PI * 2) / 3;
          g.fillStyle(0xffeb3b).fillCircle(u.x + Math.cos(a) * 18, u.y - u.radius - 6 + Math.sin(a) * 6, 4);
        }
      }
      if (u.slowUntil > t) g.lineStyle(2, 0x80deea, 0.8).strokeCircle(u.x, u.y, u.radius + 3);
      const barColor = h.isPlayer ? 0x66bb6a : u.team === view ? 0x42a5f5 : 0xef5350;
      this.hpBar(u.x, u.y - u.radius - 18, 66, 8, u.hp / u.stats.maxHp, barColor, u.shield / u.stats.maxHp);
      lab.icon.setVisible(false);
      lab.name.setPosition(u.x, u.y - u.radius - 22).setText(`${h.level} ${h.name}`).setAlpha(alpha);
    }

    for (const p of w.projectiles) g.fillStyle(0xffffff, 0.9).fillCircle(p.x, p.y, Math.max(3, p.radius * 0.45));

    for (const f of w.fxList) {
      const c = hex(f.color);
      const k = (t - f.start) / (f.until - f.start);
      if (f.kind === 'ring') g.lineStyle(4 * (1 - k) + 1, c, 1 - k).strokeCircle(f.x, f.y, f.r * (0.5 + 0.5 * k));
      else if (f.kind === 'burst') g.fillStyle(c, 0.4 * (1 - k)).fillCircle(f.x, f.y, f.r * (0.6 + 0.4 * k));
      else {
        g.lineStyle((f.width ?? 3) * 3, c, 0.25 * (1 - k)).lineBetween(f.x, f.y, f.x2 ?? f.x, f.y2 ?? f.y);
        g.lineStyle(f.width ?? 3, 0xffffff, 0.9 * (1 - k * 0.7)).lineBetween(f.x, f.y, f.x2 ?? f.x, f.y2 ?? f.y);
      }
    }

    if (me && !me.dead) {
      if (this.aim) {
        // Drag-to-aim preview from the touch buttons.
        const def = me.hero!.abilities[this.aim.slot]?.def;
        const range = Math.max(def?.range ?? 300, 250);
        const ex = me.x + this.aim.dir.x * range;
        const ey = me.y + this.aim.dir.y * range;
        g.lineStyle(14, 0x81d4fa, 0.18).lineBetween(me.x, me.y, ex, ey);
        g.lineStyle(3, 0xe1f5fe, 0.8).lineBetween(me.x, me.y, ex, ey);
        g.lineStyle(2, 0xe1f5fe, 0.5).strokeCircle(me.x, me.y, range);
        g.fillStyle(0x81d4fa, 0.35).fillCircle(ex, ey, 26);
      } else if (!this.input.activePointer.wasTouch) {
        g.lineStyle(1, 0xffffff, 0.12).lineBetween(me.x, me.y, this.mouse.x, this.mouse.y);
      }
    }

    const now = this.time.now;
    this.floats = this.floats.filter((f) => {
      const age = (now - f.born) / 1000;
      if (age > 0.9) {
        f.text.destroy();
        return false;
      }
      const pop = age < 0.12 ? 1 + (0.12 - age) * 4 : 1;
      f.text.setPosition(f.x, f.y - age * 70).setAlpha(1 - Math.max(0, age - 0.5) / 0.4).setScale(pop);
      return true;
    });
  }

  private spawnFloat(e: Extract<GameEvent, { type: 'damage' }>) {
    const me = this.player?.id ?? this.hooks.selected?.()?.id;
    if (me === undefined || (e.srcId !== me && e.tgtId !== me)) return;
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

