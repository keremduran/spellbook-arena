import Phaser from 'phaser';
import { FOUNTAIN, FOUNTAIN_RADIUS, LANE_Y, MAP_H, MAP_W, RUNE_RADIUS, Y_MAX, Y_MIN } from '../sim/constants';
import { Rng } from '../sim/rng';
import type { GameEvent, Team, Unit } from '../sim/types';
import type { World } from '../sim/world';
import { castSound, sfx, type SfxName } from './audio';
import { paintMinion } from './heroArt';

export const hex = (s: string) => parseInt(s.slice(1, 7), 16);
export const TEAM_COLOR: Record<Team, number> = { blue: 0x4fa3ff, red: 0xff5a5a };
const darken = (c: number, k: number) => (Math.round(((c >> 16) & 255) * (1 - k)) << 16) | (Math.round(((c >> 8) & 255) * (1 - k)) << 8) | Math.round((c & 255) * (1 - k));

interface Swing {
  x: number;
  y: number;
  a: number;
  r: number;
  color: number;
  born: number;
}

interface Beam {
  x: number;
  y: number;
  x2: number;
  y2: number;
  color: number;
  born: number;
}

/**
 * Everything that makes the game look and sound alive but doesn't affect rules:
 * generated textures, the painted map, unit sprites, particles, screen shake and sound.
 */
export class Visuals {
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private embers!: Phaser.GameObjects.Particles.ParticleEmitter;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;
  private rise!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sprites = new Map<number, { glow: Phaser.GameObjects.Image; orb: Phaser.GameObjects.Image; icon?: Phaser.GameObjects.Image }>();
  private projGlows: Phaser.GameObjects.Image[] = [];
  private lastHit = new Map<number, number>();
  private swings: Swing[] = [];
  private beams: Beam[] = [];
  private wasMoving = new Map<number, { x: number; y: number; phase: number }>();
  private lunges = new Map<number, number>();
  private runeGlow!: Phaser.GameObjects.Image;

  constructor(private scene: Phaser.Scene, private world: World, private focus: () => Unit | null) {}

  create() {
    this.makeTextures();
    this.paintMap();
    const s = this.scene;
    const base = { emitting: false, blendMode: Phaser.BlendModes.ADD } as const;
    this.sparks = s.add.particles(0, 0, 'spark', { ...base, lifespan: { min: 250, max: 600 }, speed: { min: 80, max: 420 }, scale: { start: 1.1, end: 0 }, alpha: { start: 1, end: 0 } }).setDepth(12);
    this.embers = s.add.particles(0, 0, 'glow', { ...base, lifespan: { min: 300, max: 700 }, speed: { min: 20, max: 140 }, scale: { start: 0.35, end: 0 }, alpha: { start: 0.8, end: 0 } }).setDepth(11);
    this.smoke = s.add.particles(0, 0, 'smoke', { emitting: false, lifespan: { min: 600, max: 1200 }, speed: { min: 20, max: 110 }, scale: { start: 0.6, end: 1.6 }, alpha: { start: 0.45, end: 0 }, rotate: { min: 0, max: 360 } }).setDepth(10);
    this.trail = s.add.particles(0, 0, 'glow', { ...base, lifespan: 260, speed: { min: 0, max: 25 }, scale: { start: 0.28, end: 0 }, alpha: { start: 0.9, end: 0 } }).setDepth(8);
    this.rise = s.add.particles(0, 0, 'spark', { ...base, lifespan: { min: 600, max: 1100 }, speedY: { min: -160, max: -60 }, speedX: { min: -30, max: 30 }, scale: { start: 1, end: 0 }, alpha: { start: 1, end: 0 } }).setDepth(12);

    this.runeGlow = s.add.image(this.world.rune.x, this.world.rune.y, 'glow').setTint(0xffca28).setBlendMode(Phaser.BlendModes.ADD).setDepth(2).setVisible(false);

    // Subtle vignette for depth (WebGL only; phones skip it to save fill rate).
    const cam = s.cameras.main;
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (s.renderer.type === Phaser.WEBGL && !touch) cam.postFX?.addVignette(0.5, 0.5, 0.95, 0.28);
  }

  // ------------------------------------------------------------------ textures

  private canvasTexture(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
    if (this.scene.textures.exists(key)) return;
    const tex = this.scene.textures.createCanvas(key, w, h)!;
    draw(tex.getContext());
    tex.refresh();
  }

  private makeTextures() {
    this.canvasTexture('glow', 128, 128, (c) => {
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 128, 128);
    });
    this.canvasTexture('orb', 128, 128, (c) => {
      const g = c.createRadialGradient(46, 40, 6, 64, 64, 62);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#d8d8d8');
      g.addColorStop(0.85, '#7a7a7a');
      g.addColorStop(1, '#4a4a4a');
      c.fillStyle = g;
      c.beginPath();
      c.arc(64, 64, 62, 0, Math.PI * 2);
      c.fill();
    });
    this.canvasTexture('spark', 16, 16, (c) => {
      const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 16, 16);
    });
    this.canvasTexture('smoke', 64, 64, (c) => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(190,190,190,0.7)');
      g.addColorStop(1, 'rgba(120,120,120,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
    });
  }

  /** Paints the arena once into a half-resolution canvas: grass, dirt lane, plazas, forest walls. */
  private paintMap() {
    const S = 0.5;
    const W = MAP_W * S;
    const H = MAP_H * S;
    const rng = new Rng(7);
    this.canvasTexture('arena', W, H, (c) => {
      // Grass base with mottled noise.
      c.fillStyle = '#1b2b1f';
      c.fillRect(0, 0, W, H);
      for (let i = 0; i < 2600; i++) {
        const shade = rng.pick(['#1f3424', '#18281c', '#22392a', '#2a412d', '#1a2e20']);
        c.fillStyle = shade;
        c.globalAlpha = rng.range(0.25, 0.7);
        c.beginPath();
        c.arc(rng.range(0, W), rng.range(0, H), rng.range(2, 14), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;

      // Dirt lane with wobbly edges.
      const laneTop = (x: number) => (LANE_Y - 175) * S + Math.sin(x * 0.02) * 6 + Math.sin(x * 0.007) * 10;
      const laneBot = (x: number) => (LANE_Y + 175) * S + Math.sin(x * 0.017 + 2) * 6 + Math.sin(x * 0.006) * 10;
      const lane = c.createLinearGradient(0, (LANE_Y - 175) * S, 0, (LANE_Y + 175) * S);
      lane.addColorStop(0, '#2c3524');
      lane.addColorStop(0.5, '#3a3a2a');
      lane.addColorStop(1, '#2c3524');
      c.fillStyle = lane;
      c.beginPath();
      c.moveTo(0, laneTop(0));
      for (let x = 0; x <= W; x += 10) c.lineTo(x, laneTop(x));
      for (let x = W; x >= 0; x -= 10) c.lineTo(x, laneBot(x));
      c.closePath();
      c.fill();
      // Worn centre path, pebbles and cart ruts.
      c.fillStyle = 'rgba(80,72,52,0.35)';
      c.fillRect(0, (LANE_Y - 55) * S, W, 110 * S);
      for (let i = 0; i < 900; i++) {
        c.fillStyle = rng.pick(['#4a4636', '#57513f', '#3d3a2d', '#625a45']);
        c.globalAlpha = rng.range(0.3, 0.8);
        const x = rng.range(0, W);
        const y = rng.range(laneTop(x), laneBot(x));
        c.fillRect(x, y, rng.range(1, 3), rng.range(1, 3));
      }
      c.globalAlpha = 0.25;
      c.strokeStyle = '#1c1a12';
      c.lineWidth = 2;
      for (const off of [-24, 24]) {
        c.beginPath();
        for (let x = 0; x <= W; x += 20) c.lineTo(x, (LANE_Y + off) * S + Math.sin(x * 0.03) * 2);
        c.stroke();
      }
      c.globalAlpha = 1;

      // Team plazas around fountains, towers and nexus.
      const plaza = (x: number, y: number, r: number, team: Team) => {
        const col = team === 'blue' ? '79,163,255' : '255,90,90';
        const g = c.createRadialGradient(x * S, y * S, 0, x * S, y * S, r * S);
        g.addColorStop(0, 'rgba(70,74,80,0.9)');
        g.addColorStop(0.8, 'rgba(52,56,62,0.85)');
        g.addColorStop(1, 'rgba(40,44,48,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x * S, y * S, r * S, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = `rgba(${col},0.45)`;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x * S, y * S, r * S * 0.78, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([4, 6]);
        c.beginPath();
        c.arc(x * S, y * S, r * S * 0.62, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
      };
      for (const team of ['blue', 'red'] as Team[]) {
        const f = FOUNTAIN[team];
        plaza(f.x, f.y, FOUNTAIN_RADIUS + 40, team);
        for (const u of this.world.units) if (u.team === team && (u.kind === 'tower' || u.kind === 'nexus')) plaza(u.x, u.y, u.kind === 'nexus' ? 150 : 110, team);
      }

      // Flowers and mushrooms for detail.
      for (let i = 0; i < 220; i++) {
        const x = rng.range(0, W);
        const y = rng.range(Y_MIN * S, Y_MAX * S);
        if (y > laneTop(x) - 4 && y < laneBot(x) + 4) continue;
        c.fillStyle = rng.pick(['#e6d36a', '#d98cc6', '#e9e9e9', '#8fc1e8', '#e08a5a']);
        c.globalAlpha = 0.8;
        c.beginPath();
        c.arc(x, y, rng.range(0.8, 2), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;

      // Forest walls above and below the playable band.
      const tree = (x: number, y: number, r: number) => {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath();
        c.ellipse(x + r * 0.25, y + r * 0.35, r, r * 0.7, 0, 0, Math.PI * 2);
        c.fill();
        for (const [dx, dy, k, col] of [[0, 0, 1, '#123020'], [-0.2, -0.2, 0.75, '#18402a'], [-0.32, -0.34, 0.45, '#215235'], [-0.38, -0.42, 0.2, '#2d6644']] as const) {
          c.fillStyle = col;
          c.beginPath();
          c.arc(x + dx * r, y + dy * r, r * k, 0, Math.PI * 2);
          c.fill();
        }
      };
      const rock = (x: number, y: number, r: number) => {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath();
        c.ellipse(x + 3, y + 4, r, r * 0.6, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#3a3f45';
        c.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const rr = r * rng.range(0.75, 1.05);
          c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.75);
        }
        c.closePath();
        c.fill();
        c.fillStyle = '#545b63';
        c.beginPath();
        c.arc(x - r * 0.25, y - r * 0.25, r * 0.4, 0, Math.PI * 2);
        c.fill();
      };
      const edge = (top: boolean) => {
        const items: [number, number, number, boolean][] = [];
        for (let i = 0; i < 230; i++) {
          const x = rng.range(-30, W + 30);
          const y = top ? rng.range(-30, (Y_MIN - 25) * S) : rng.range((Y_MAX + 25) * S, H + 30);
          items.push([x, y, rng.range(14, 34), rng.next() < 0.16]);
        }
        items.sort((a, b) => a[1] - b[1]);
        for (const [x, y, r, isRock] of items) (isRock ? rock : tree)(x, y, isRock ? r * 0.6 : r);
      };
      // Darken the forest floor first.
      c.fillStyle = '#0d1a12';
      c.fillRect(0, 0, W, (Y_MIN - 30) * S);
      c.fillRect(0, (Y_MAX + 30) * S, W, H);
      edge(true);
      edge(false);
    });

    const s = this.scene;
    s.add.rectangle(MAP_W / 2, MAP_H / 2, MAP_W + 1600, MAP_H + 1600, 0x0a140e).setDepth(-2);
    s.add.image(0, 0, 'arena').setOrigin(0).setScale(1 / S).setDepth(-1);
    // Fountain glow pools.
    for (const team of ['blue', 'red'] as Team[]) {
      const f = FOUNTAIN[team];
      const img = s.add.image(f.x, f.y, 'glow').setTint(TEAM_COLOR[team]).setBlendMode(Phaser.BlendModes.ADD).setScale(4).setAlpha(0.35).setDepth(0);
      s.tweens.add({ targets: img, alpha: 0.2, duration: 1600, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    }
  }

  // ------------------------------------------------------------------ per-frame sprites

  /** Texture for a unit body: painted hero art, tintable minion art, or the plain orb. */
  private bodyTexture(u: Unit) {
    if (u.creep) {
      const key = u.creep.ranged ? 'minion_ranged' : 'minion_melee';
      this.canvasTexture(key, 64, 64, (c) => paintMinion(c, u.creep!.ranged));
      return key;
    }
    return 'orb';
  }

  private spriteFor(u: Unit) {
    let sp = this.sprites.get(u.id);
    if (!sp) {
      const glow = this.scene.add.image(u.x, u.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
      const orb = this.scene.add.image(u.x, u.y, this.bodyTexture(u)).setDepth(4);
      const iconKey = u.hero ? `icon_${u.hero.def.id}` : '';
      const icon = iconKey && this.scene.textures.exists(iconKey) ? this.scene.add.image(u.x, u.y, iconKey).setDepth(4.5) : undefined;
      sp = { glow, orb, icon };
      this.sprites.set(u.id, sp);
    }
    return sp;
  }

  /** Positions sprites and draws the extra vector bits (structures, rims, swings, beams). */
  frame(g: Phaser.GameObjects.Graphics, viewerTeam: Team | null) {
    const w = this.world;
    const t = w.time;
    const now = this.scene.time.now;

    for (const [id, sp] of this.sprites) {
      const u = w.unit(id);
      if (!u || u.dead) {
        sp.glow.destroy();
        sp.orb.destroy();
        sp.icon?.destroy();
        this.sprites.delete(id);
        this.wasMoving.delete(id);
      }
    }

    for (const u of w.units) {
      if (u.dead) continue;
      const hidden = !!viewerTeam && u.team !== viewerTeam && !w.isVisible(u, viewerTeam);
      const flash = now - (this.lastHit.get(u.id) ?? -1e9) < 90;
      const tc = TEAM_COLOR[u.team];
      if (u.kind === 'tower' || u.kind === 'nexus') {
        this.drawStructure(g, u, t, tc);
        continue;
      }
      const sp = this.spriteFor(u);
      sp.glow.setVisible(!hidden);
      sp.orb.setVisible(!hidden);
      sp.icon?.setVisible(!hidden);
      if (hidden) continue;
      // Walking bob.
      const prev = this.wasMoving.get(u.id) ?? { x: u.x, y: u.y, phase: 0 };
      const moved = Math.hypot(u.x - prev.x, u.y - prev.y);
      prev.phase += moved * 0.08;
      prev.x = u.x;
      prev.y = u.y;
      this.wasMoving.set(u.id, prev);
      const bob = moved > 0.3 ? Math.abs(Math.sin(prev.phase)) * 3 : 0;
      const alpha = u.stealthUntil > t || u.invulnUntil > t ? 0.45 : 1;
      const r = u.radius;
      // Art faces up; turn it toward the facing direction, with a little sway while walking
      // and a short lunge right after attacking.
      const angle = Math.atan2(u.facing.y, u.facing.x) + Math.PI / 2;
      const sway = moved > 0.3 ? Math.sin(prev.phase * 0.5) * 0.12 : 0;
      const lungeAge = now - (this.lunges.get(u.id) ?? -1e9);
      const lunge = lungeAge < 140 ? Math.sin((lungeAge / 140) * Math.PI) * r * 0.35 : 0;
      const bx = u.x + u.facing.x * lunge;
      const by = u.y - bob + u.facing.y * lunge;
      g.fillStyle(0x000000, 0.35).fillEllipse(u.x, u.y + r * 0.75, r * 2.1, r * 0.9);
      sp.glow.setPosition(u.x, u.y).setTint(tc).setScale((r * (u.kind === 'hero' ? 3.4 : 2.4)) / 128).setAlpha((u.kind === 'hero' ? 0.42 : 0.22) * alpha);
      if (u.kind === 'hero') {
        // Token: shaded disc in the hero's colour, game-icons.net emblem on top,
        // team ring around it and an arrow showing where the hero faces.
        sp.orb.setPosition(bx, by).setScale((r * 2) / 128).setRotation(0).setAlpha(alpha);
        if (flash) sp.orb.setTintFill(0xffffff);
        else sp.orb.setTint(darken(hex(u.hero!.def.color), 0.45));
        sp.icon?.setPosition(bx, by).setScale((r * 1.5) / 160).setAlpha(alpha);
        g.lineStyle(4, tc, alpha).strokeCircle(bx, by, r + 2);
        const fx = u.facing.x;
        const fy = u.facing.y;
        const tip = r + 13;
        g.fillStyle(tc, alpha).fillTriangle(bx + fx * tip, by + fy * tip, bx + fx * (r + 2) - fy * 7, by + fy * (r + 2) + fx * 7, bx + fx * (r + 2) + fy * 7, by + fy * (r + 2) - fx * 7);
      } else {
        sp.orb.setPosition(bx, by).setScale((r * 2.6) / 64).setRotation(angle + sway).setAlpha(alpha);
        if (flash) sp.orb.setTintFill(0xffffff);
        else sp.orb.setTint(tc);
      }
    }

    // Power rune: a spinning golden crystal.
    const rune = w.rune;
    this.runeGlow.setVisible(rune.active);
    if (rune.active) {
      const a = t * 2;
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      this.runeGlow.setScale(1.6 + pulse * 0.5).setAlpha(0.7);
      g.lineStyle(3, 0xffca28, 0.6).strokeCircle(rune.x, rune.y, RUNE_RADIUS + 18 + pulse * 6);
      const pts = [0, 1, 2, 3].map((i) => new Phaser.Math.Vector2(rune.x + Math.cos(a + (i * Math.PI) / 2) * (i % 2 ? 16 : 30), rune.y - 10 + Math.sin(a + (i * Math.PI) / 2) * (i % 2 ? 16 : 30) * 0.6));
      g.fillStyle(0xffe082, 1).fillPoints(pts, true);
      g.fillStyle(0xffffff, 0.8).fillCircle(rune.x - 4, rune.y - 14, 5);
      if (Math.random() < 0.5) {
        this.rise.setParticleTint(0xffd54f);
        this.rise.emitParticleAt(rune.x + (Math.random() - 0.5) * 50, rune.y + 10, 1);
      }
    }

    // Burning units smoulder.
    for (const u of w.units) {
      if (!u.dead && u.dots.length && Math.random() < 0.5) {
        this.embers.setParticleTint(0xff7043);
        this.embers.emitParticleAt(u.x + (Math.random() - 0.5) * u.radius, u.y - u.radius * 0.5, 1);
      }
    }

    // Melee swings: a bright arc in the facing direction.
    this.swings = this.swings.filter((s) => now - s.born < 160);
    for (const s of this.swings) {
      const k = (now - s.born) / 160;
      g.lineStyle(5 * (1 - k), s.color, 0.9 * (1 - k));
      g.beginPath();
      g.arc(s.x, s.y, s.r, s.a - 1.1 + k * 0.6, s.a + 0.6 + k * 0.6);
      g.strokePath();
    }
    // Tower beams.
    this.beams = this.beams.filter((b) => now - b.born < 140);
    for (const b of this.beams) {
      const k = (now - b.born) / 140;
      g.lineStyle(10 * (1 - k), b.color, 0.25 * (1 - k)).lineBetween(b.x, b.y, b.x2, b.y2);
      g.lineStyle(3 * (1 - k), 0xffffff, 0.9 * (1 - k)).lineBetween(b.x, b.y, b.x2, b.y2);
    }

    // Projectile glows and trails.
    let i = 0;
    for (const p of w.projectiles) {
      let img = this.projGlows[i];
      if (!img) {
        img = this.scene.add.image(0, 0, 'glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(9);
        this.projGlows.push(img);
      }
      const c = hex(p.color);
      img.setVisible(true).setPosition(p.x, p.y).setTint(c).setScale((p.radius * 3.4) / 128);
      if (p.targetId === undefined || p.owner.kind === 'tower') {
        this.trail.setParticleTint(c);
        this.trail.emitParticleAt(p.x, p.y, 1);
      }
      i++;
    }
    for (; i < this.projGlows.length; i++) this.projGlows[i].setVisible(false);

    // Zones bubble with rising motes.
    for (const z of w.zones) {
      if (Math.random() < 0.6) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * z.radius;
        this.embers.setParticleTint(hex(z.color));
        this.embers.emitParticleAt(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d, 1);
      }
    }
  }

  private drawStructure(g: Phaser.GameObjects.Graphics, u: Unit, t: number, tc: number) {
    const sp = this.spriteFor(u);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + u.id);
    const flash = this.scene.time.now - (this.lastHit.get(u.id) ?? -1e9) < 90;
    sp.orb.setVisible(false);
    if (u.kind === 'tower') {
      g.fillStyle(0x000000, 0.4).fillEllipse(u.x + 6, u.y + 34, 96, 34);
      g.fillStyle(0x2c3138).fillRoundedRect(u.x - 40, u.y - 22, 80, 56, 12);
      g.fillStyle(0x3d444d).fillRoundedRect(u.x - 32, u.y - 46, 64, 60, 10);
      g.fillStyle(0x4b535d).fillRoundedRect(u.x - 32, u.y - 46, 64, 12, 6);
      const cy = u.y - 64;
      g.fillStyle(flash ? 0xffffff : tc, 1).fillTriangle(u.x, cy - 30, u.x + 18, cy, u.x - 18, cy);
      g.fillStyle(flash ? 0xffffff : tc, 0.75).fillTriangle(u.x - 18, cy, u.x + 18, cy, u.x, cy + 16);
      g.fillStyle(0xffffff, 0.6).fillTriangle(u.x - 4, cy - 22, u.x + 4, cy - 6, u.x - 9, cy - 4);
      sp.glow.setPosition(u.x, cy).setTint(tc).setScale(1.1 + pulse * 0.25).setAlpha(0.55);
    } else {
      g.fillStyle(0x000000, 0.4).fillEllipse(u.x + 8, u.y + 52, 150, 50);
      g.fillStyle(0x2c3138).fillCircle(u.x, u.y + 10, 66);
      g.fillStyle(0x3d444d).fillCircle(u.x, u.y + 4, 56);
      const bobY = Math.sin(t * 1.6) * 6;
      const cy = u.y - 30 + bobY;
      const c = flash ? 0xffffff : tc;
      g.fillStyle(c, 1).fillTriangle(u.x, cy - 62, u.x + 34, cy, u.x - 34, cy);
      g.fillStyle(c, 0.7).fillTriangle(u.x - 34, cy, u.x + 34, cy, u.x, cy + 42);
      g.fillStyle(0xffffff, 0.55).fillTriangle(u.x - 6, cy - 48, u.x + 6, cy - 10, u.x - 16, cy - 6);
      g.lineStyle(2, tc, 0.6).strokeEllipse(u.x, u.y + 4, 120 + pulse * 20, 40 + pulse * 6);
      sp.glow.setPosition(u.x, cy).setTint(tc).setScale(2 + pulse * 0.4).setAlpha(0.5);
    }
  }

  // ------------------------------------------------------------------ events → particles, sound, shake

  private gainAt(x: number, y: number) {
    const cam = this.scene.cameras.main;
    const d = Math.hypot(x - cam.midPoint.x, y - cam.midPoint.y);
    return Math.max(0, Math.min(1, 1 - (d - 500) / 1100));
  }

  private sound(name: SfxName, x: number, y: number, mine = false) {
    sfx.play(name, mine ? 1 : this.gainAt(x, y) * 0.75);
  }

  private shake(x: number, y: number, ms: number, intensity: number) {
    if (this.gainAt(x, y) > 0.3) this.scene.cameras.main.shake(ms, intensity * this.gainAt(x, y));
  }

  onEvents(events: GameEvent[]) {
    const w = this.world;
    const me = this.focus();
    const now = this.scene.time.now;
    for (const e of events) {
      switch (e.type) {
        case 'cast': {
          const c = hex(e.color);
          const mine = e.unitId === me?.id;
          this.sparks.setParticleTint(c);
          this.sparks.explode(e.kind === 'ult' ? 34 : 12, e.x, e.y);
          if (e.kind === 'ult') {
            w.fx({ kind: 'ring', x: e.x, y: e.y, r: 160, color: e.color, duration: 0.45 });
            this.shake(e.x, e.y, 160, 0.004);
          }
          this.sound(castSound(e.abilityId, e.tags, e.kind), e.x, e.y, mine);
          break;
        }
        case 'attack': {
          const mine = e.unitId === me?.id;
          this.lunges.set(e.unitId, now);
          if (e.tower) {
            this.beams.push({ x: e.x, y: e.y - 64, x2: e.tx, y2: e.ty, color: TEAM_COLOR[w.unit(e.unitId)?.team ?? 'blue'], born: now });
            // Allied and enemy towers sound different; an enemy tower shooting you also beeps.
            const tower = w.unit(e.unitId);
            const pov = w.playerTeam ?? me?.team ?? 'blue';
            this.sound(tower?.team === pov ? 'towerShotAlly' : 'towerShot', e.x, e.y, false);
            if (me && e.tgtId === me.id) this.sound('towerHitMe', e.x, e.y, true);
          } else if (e.ranged) {
            this.sound('shoot', e.x, e.y, mine);
          } else {
            const u = w.unit(e.unitId);
            this.swings.push({ x: e.x, y: e.y, a: Math.atan2(e.ty - e.y, e.tx - e.x), r: (u?.radius ?? 24) + 22, color: 0xffffff, born: now });
            this.sound('swing', e.x, e.y, mine);
          }
          break;
        }
        case 'damage': {
          if (e.heal) {
            if (e.tgtId === me?.id || e.amount > 60) {
              this.rise.setParticleTint(0x69f0ae);
              this.rise.explode(e.tgtId === me?.id ? 8 : 4, e.x, e.y + 20);
            }
            break;
          }
          this.lastHit.set(e.tgtId, now);
          if (e.amount >= 8) {
            this.sparks.setParticleTint(e.crit ? 0xffca28 : 0xffffff);
            this.sparks.explode(e.crit ? 10 : 3, e.x, e.y + 10);
          }
          const involved = me && (e.srcId === me.id || e.tgtId === me.id);
          if (involved) this.sound(e.crit ? 'crit' : 'hit', e.x, e.y, true);
          if (me && e.tgtId === me.id && e.amount > me.stats.maxHp * 0.12) this.scene.cameras.main.shake(120, 0.005);
          break;
        }
        case 'boom': {
          const c = hex(e.color);
          this.sparks.setParticleTint(c);
          this.sparks.explode(Math.min(50, Math.round(e.r / 7)), e.x, e.y);
          this.embers.setParticleTint(c);
          this.embers.explode(Math.min(24, Math.round(e.r / 12)), e.x, e.y);
          this.smoke.explode(Math.min(10, Math.round(e.r / 40)), e.x, e.y);
          this.sound(e.r >= 300 ? 'bigBoom' : 'boom', e.x, e.y);
          if (e.r >= 250) this.shake(e.x, e.y, 220, 0.006);
          break;
        }
        case 'die': {
          const tc = TEAM_COLOR[e.team];
          if (e.kind === 'hero') {
            this.sparks.setParticleTint(tc);
            this.sparks.explode(40, e.x, e.y);
            this.embers.setParticleTint(0xffffff);
            this.embers.explode(14, e.x, e.y);
            this.smoke.explode(6, e.x, e.y);
            const viewTeam = me?.team ?? 'blue';
            // Hero deaths are always audible: major motif for enemies, minor for teammates.
            if (e.unitId === me?.id) sfx.play('death');
            else sfx.play(e.team === viewTeam ? 'allyDown' : 'kill', Math.max(0.5, this.gainAt(e.x, e.y)));
            // Music turns minor while your team trails by 5+ kills.
            const other = viewTeam === 'blue' ? 'red' : 'blue';
            sfx.setMood(w.kills[viewTeam] - w.kills[other] <= -5 ? 'minor' : 'major');
          } else if (e.kind === 'creep') {
            this.smoke.explode(3, e.x, e.y);
            this.sparks.setParticleTint(tc);
            this.sparks.explode(5, e.x, e.y);
          } else {
            this.sparks.setParticleTint(tc);
            this.sparks.explode(90, e.x, e.y - 40);
            this.embers.setParticleTint(0xffcc80);
            this.embers.explode(40, e.x, e.y - 30);
            this.smoke.explode(18, e.x, e.y);
            // Same fanfare either way: major when an enemy structure falls, minor when it's ours.
            sfx.play(e.team === (me?.team ?? 'blue') ? 'structureLoss' : 'structureWin', 0.9);
            this.scene.cameras.main.shake(500, 0.012);
          }
          break;
        }
        case 'levelup': {
          const u = w.unit(e.unitId);
          if (!u) break;
          this.rise.setParticleTint(0xffd54f);
          this.rise.explode(u === me ? 26 : 10, u.x, u.y + 20);
          if (u === me) sfx.play('levelUp');
          break;
        }
        case 'runeSpawn':
          sfx.play('rune', 0.8);
          this.rise.setParticleTint(0xffca28);
          this.rise.explode(30, e.x, e.y + 20);
          break;
        case 'rune':
          this.sparks.setParticleTint(0xffca28);
          this.sparks.explode(40, e.x, e.y);
          {
            const taker = w.unit(e.unitId);
            const ours = taker?.team === (me?.team ?? 'blue');
            this.sound(ours ? 'rune' : 'runeBad', e.x, e.y, e.unitId === me?.id);
          }
          break;
        case 'announce':
          sfx.play(!e.team || e.team === (me?.team ?? 'blue') ? 'announce' : 'announceBad', 0.8);
          break;
        case 'offer':
          if (e.unitId === me?.id || !me) sfx.play('boon', me ? 1 : 0.5);
          break;
      }
    }
  }

  /** A short golden burst for the boon pick moment. */
  boonPicked(u: Unit) {
    this.rise.setParticleTint(0xffca28);
    this.rise.explode(30, u.x, u.y + 20);
    this.sparks.setParticleTint(0xffca28);
    this.sparks.explode(16, u.x, u.y);
    sfx.play('boon');
  }
}
