import type { World } from './world';
import type { Mods, Unit, Vec } from './types';

export interface CastCtx {
  aim: Vec;
  /** Unit direction from caster towards aim. */
  dir: Vec;
  /** Damage power: rarity × spell power × level scaling. */
  p: number;
  /** Rarity multiplier only (used for buffs and percentages). */
  m: number;
}

/**
 * How bots use an ability:
 * damage   cast at an enemy within range
 * engage   gap closer towards a target
 * self     self/area buff, cast when fighting
 * heal     cast when hurt
 * escape   cast when retreating
 * global   cast when any enemy hero is low
 */
export type AiUse = 'damage' | 'engage' | 'self' | 'heal' | 'escape' | 'global';

export interface AbilityDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: 'basic' | 'ult' | 'passive';
  tags: string[];
  cooldown: number;
  range: number;
  ai?: AiUse;
  desc: (p: number, m: number) => string;
  /** Return false when nothing happened (no cooldown is spent). */
  cast?: (w: World, u: Unit, c: CastCtx) => boolean | void;
  mods?: (m: number) => Mods;
  dynamicMods?: (u: Unit, m: number) => Mods | null;
  onAttack?: (w: World, u: Unit, target: Unit, m: number, p: number) => void;
  onTick?: (w: World, u: Unit, dt: number, m: number) => void;
}

const n = (x: number) => Math.round(x);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const clampAim = (u: Unit, aim: Vec, range: number): Vec => {
  const dx = aim.x - u.x;
  const dy = aim.y - u.y;
  const d = Math.hypot(dx, dy);
  if (d <= range) return { x: aim.x, y: aim.y };
  return { x: u.x + (dx / d) * range, y: u.y + (dy / d) * range };
};

const rotate = (v: Vec, a: number): Vec => ({
  x: v.x * Math.cos(a) - v.y * Math.sin(a),
  y: v.x * Math.sin(a) + v.y * Math.cos(a),
});

// ---------------------------------------------------------------- basics (Q/W/E)

const BASICS: AbilityDef[] = [
  {
    id: 'firebolt', name: 'Firebolt', icon: '🔥', color: '#ff7043', kind: 'basic', tags: ['damage', 'skillshot'],
    cooldown: 5, range: 800, ai: 'damage',
    desc: (p) => `Hurl a bolt of fire that deals ${n(90 * p)} damage to the first enemy hit.`,
    cast: (w, u, c) => {
      w.projectile({ owner: u, dir: c.dir, speed: 950, range: 800, radius: 16, color: '#ff7043',
        onHit: (t) => w.damage(u, t, 90 * c.p, 'spell') });
    },
  },
  {
    id: 'frost_lance', name: 'Frost Lance', icon: '❄️', color: '#80deea', kind: 'basic', tags: ['damage', 'slow'],
    cooldown: 6, range: 800, ai: 'damage',
    desc: (p, m) => `Fire an icy lance dealing ${n(65 * p)} damage and slowing by ${pct(Math.min(0.7, 0.4 * m))} for 1.5s.`,
    cast: (w, u, c) => {
      w.projectile({ owner: u, dir: c.dir, speed: 900, range: 800, radius: 18, color: '#80deea',
        onHit: (t) => { w.damage(u, t, 65 * c.p, 'spell'); w.slow(t, Math.min(0.7, 0.4 * c.m), 1.5); } });
    },
  },
  {
    id: 'piercing_arrow', name: 'Piercing Arrow', icon: '➶', color: '#c5e1a5', kind: 'basic', tags: ['damage', 'long range'],
    cooldown: 7, range: 1100, ai: 'damage',
    desc: (p) => `Loose an arrow that passes through every enemy in a long line for ${n(80 * p)} damage.`,
    cast: (w, u, c) => {
      w.projectile({ owner: u, dir: c.dir, speed: 1400, range: 1100, radius: 14, color: '#c5e1a5', pierce: true,
        onHit: (t) => w.damage(u, t, 80 * c.p, 'spell') });
    },
  },
  {
    id: 'shock_nova', name: 'Shock Nova', icon: '💥', color: '#ffee58', kind: 'basic', tags: ['area', 'damage'],
    cooldown: 7, range: 230, ai: 'self',
    desc: (p) => `Release a shockwave around you dealing ${n(80 * p)} damage.`,
    cast: (w, u, c) => {
      w.nova({ owner: u, x: u.x, y: u.y, radius: 230, delay: 0, color: '#ffee58', onHit: (t) => w.damage(u, t, 80 * c.p, 'spell') });
    },
  },
  {
    id: 'meteor', name: 'Meteor', icon: '☄️', color: '#ff8a65', kind: 'basic', tags: ['area', 'damage'],
    cooldown: 8, range: 750, ai: 'damage',
    desc: (p) => `Call down a meteor that lands after 0.8s, dealing ${n(130 * p)} damage in an area.`,
    cast: (w, u, c) => {
      const t = clampAim(u, c.aim, 750);
      w.nova({ owner: u, x: t.x, y: t.y, radius: 170, delay: 0.8, color: '#ff8a65', onHit: (e) => w.damage(u, e, 130 * c.p, 'spell') });
    },
  },
  {
    id: 'bramble', name: 'Bramble Field', icon: '🌿', color: '#66bb6a', kind: 'basic', tags: ['area', 'slow'],
    cooldown: 9, range: 700, ai: 'damage',
    desc: (p) => `Grow thorns for 4s that deal ${n(30 * p)} damage per second and slow enemies by 30%.`,
    cast: (w, u, c) => {
      const t = clampAim(u, c.aim, 700);
      w.zone({ owner: u, x: t.x, y: t.y, radius: 190, duration: 4, dps: 30 * c.p, slowPct: 0.3, color: '#66bb6a' });
    },
  },
  {
    id: 'dash_strike', name: 'Dash Strike', icon: '💨', color: '#e0e0e0', kind: 'basic', tags: ['mobility', 'damage'],
    cooldown: 8, range: 340, ai: 'engage',
    desc: (p) => `Dash forward, dealing ${n(70 * p)} damage to enemies you pass through.`,
    cast: (w, u, c) => {
      w.dash(u, c.dir, 340, 1300, { damage: 70 * c.p, radius: 45 });
    },
  },
  {
    id: 'blink', name: 'Blink', icon: '✴️', color: '#b388ff', kind: 'basic', tags: ['mobility'],
    cooldown: 10, range: 430, ai: 'escape',
    desc: (_p, m) => `Teleport up to 430 units. Cooldown shortened to ${n(10 / Math.sqrt(m))}s by rarity.`,
    cast: (w, u, c) => {
      w.blinkTo(u, c.aim, 430);
      w.cooldownOverride = 10 / Math.sqrt(c.m);
    },
  },
  {
    id: 'shadow_veil', name: 'Shadow Veil', icon: '👤', color: '#7e57c2', kind: 'basic', tags: ['invisibility', 'mobility'],
    cooldown: 14, range: 0, ai: 'escape',
    desc: (_p, m) => `Turn invisible for ${(2.5 * m).toFixed(1)}s and gain 25% move speed. Attacking or casting reveals you.`,
    cast: (w, u, c) => {
      w.stealth(u, 2.5 * c.m);
      w.addBuff(u, { id: 'veil', duration: 2.5 * c.m, mul: { moveSpeed: 0.25 } });
    },
  },
  {
    id: 'frenzy', name: 'Frenzy', icon: '😤', color: '#ef5350', kind: 'basic', tags: ['attack speed'],
    cooldown: 11, range: 0, ai: 'self',
    desc: (_p, m) => `Gain ${pct(0.5 * m)} attack speed for 4s.`,
    cast: (w, u, c) => {
      w.addBuff(u, { id: 'frenzy', duration: 4, mul: { attackSpeed: 0.5 * c.m } });
    },
  },
  {
    id: 'sprint', name: 'Sprint', icon: '👟', color: '#4dd0e1', kind: 'basic', tags: ['movement speed'],
    cooldown: 10, range: 0, ai: 'escape',
    desc: (_p, m) => `Gain ${pct(0.4 * m)} move speed for 3s.`,
    cast: (w, u, c) => {
      w.addBuff(u, { id: 'sprint', duration: 3, mul: { moveSpeed: 0.4 * c.m } });
    },
  },
  {
    id: 'iron_skin', name: 'Iron Skin', icon: '🪨', color: '#bdbdbd', kind: 'basic', tags: ['shield'],
    cooldown: 10, range: 0, ai: 'heal',
    desc: (p) => `Gain a ${n(140 * p)} damage shield for 3s.`,
    cast: (w, u, c) => {
      w.shield(u, 140 * c.p, 3);
    },
  },
  {
    id: 'rejuvenate', name: 'Rejuvenate', icon: '💚', color: '#69f0ae', kind: 'basic', tags: ['heal', 'support'],
    cooldown: 12, range: 450, ai: 'heal',
    desc: (p) => `Heal yourself for ${n(120 * p)} and nearby allied heroes for ${n(70 * p)}.`,
    cast: (w, u, c) => {
      w.heal(u, 120 * c.p);
      for (const a of w.alliesNear(u.team, u.x, u.y, 450, true)) if (a !== u) w.heal(a, 70 * c.p);
      w.fx({ kind: 'ring', x: u.x, y: u.y, r: 450, color: '#69f0ae', duration: 0.5 });
    },
  },
  {
    id: 'chain_lightning', name: 'Chain Lightning', icon: '⚡', color: '#fff59d', kind: 'basic', tags: ['damage', 'bounce'],
    cooldown: 7, range: 600, ai: 'damage',
    desc: (p, m) => `Lightning strikes the enemy nearest your aim and bounces to ${n(3 + m)} more targets, dealing ${n(60 * p)} each.`,
    cast: (w, u, c) => {
      const first = w.nearestEnemyTo(u.team, c.aim, 600, u);
      if (!first) return false;
      w.chain(u, first, Math.round(4 + c.m), 320, 60 * c.p, '#fff59d');
    },
  },
  {
    id: 'hook', name: 'Grappling Hook', icon: '🪝', color: '#a1887f', kind: 'basic', tags: ['pull', 'damage'],
    cooldown: 11, range: 850, ai: 'damage',
    desc: (p) => `Throw a hook that pulls the first enemy hit to you and deals ${n(60 * p)} damage.`,
    cast: (w, u, c) => {
      w.projectile({ owner: u, dir: c.dir, speed: 1150, range: 850, radius: 18, color: '#a1887f',
        onHit: (t) => {
          w.fx({ kind: 'line', x: u.x, y: u.y, x2: t.x, y2: t.y, r: 0, color: '#a1887f', duration: 0.3, width: 4 });
          const d = u.radius + t.radius + 10;
          w.moveUnit(t, u.x + c.dir.x * d, u.y + c.dir.y * d);
          w.damage(u, t, 60 * c.p, 'spell');
          w.stun(t, 0.3);
        } });
    },
  },
  {
    id: 'ground_slam', name: 'Ground Slam', icon: '🔨', color: '#d7ccc8', kind: 'basic', tags: ['area', 'stun'],
    cooldown: 11, range: 220, ai: 'self',
    desc: (p, m) => `Slam the ground, dealing ${n(55 * p)} damage and stunning nearby enemies for ${(0.8 + 0.2 * m).toFixed(1)}s.`,
    cast: (w, u, c) => {
      w.nova({ owner: u, x: u.x, y: u.y, radius: 220, delay: 0, color: '#d7ccc8',
        onHit: (t) => { w.damage(u, t, 55 * c.p, 'spell'); w.stun(t, 0.8 + 0.2 * c.m); } });
    },
  },
  {
    id: 'whirlwind', name: 'Whirlwind', icon: '🌀', color: '#90caf9', kind: 'basic', tags: ['area', 'damage'],
    cooldown: 9, range: 180, ai: 'self',
    desc: (p) => `Spin for 2s, dealing ${n(60 * p)} damage per second to enemies around you.`,
    cast: (w, u, c) => {
      w.zone({ owner: u, x: u.x, y: u.y, radius: 180, duration: 2, dps: 60 * c.p, color: '#90caf9', follow: true });
    },
  },
  {
    id: 'fan_of_knives', name: 'Fan of Knives', icon: '🔪', color: '#cfd8dc', kind: 'basic', tags: ['damage', 'multi-shot'],
    cooldown: 7, range: 600, ai: 'damage',
    desc: (p) => `Throw 5 knives in a cone, each dealing ${n(42 * p)} damage.`,
    cast: (w, u, c) => {
      for (let i = -2; i <= 2; i++) {
        w.projectile({ owner: u, dir: rotate(c.dir, i * 0.22), speed: 1000, range: 600, radius: 12, color: '#cfd8dc',
          onHit: (t) => w.damage(u, t, 42 * c.p, 'spell') });
      }
    },
  },
  {
    id: 'gust', name: 'Gust', icon: '🌬️', color: '#b2ebf2', kind: 'basic', tags: ['knockback', 'damage'],
    cooldown: 7, range: 700, ai: 'damage',
    desc: (p) => `Send a wide gust that deals ${n(70 * p)} damage and knocks enemies back.`,
    cast: (w, u, c) => {
      w.projectile({ owner: u, dir: c.dir, speed: 950, range: 700, radius: 45, color: '#b2ebf2', pierce: true,
        onHit: (t) => { w.damage(u, t, 70 * c.p, 'spell'); w.knockback(t, u.x, u.y, 260); } });
    },
  },
  {
    id: 'empower', name: 'Empower', icon: '🗡️', color: '#ffab40', kind: 'basic', tags: ['on-hit', 'attack'],
    cooldown: 10, range: 0, ai: 'self',
    desc: (p) => `For 5s your attacks deal ${n(35 * p)} bonus damage.`,
    cast: (w, u, c) => {
      w.addBuff(u, { id: 'empower', duration: 5, add: { onHitDamage: 35 * c.p } });
    },
  },
  {
    id: 'vampiric_touch', name: 'Vampiric Touch', icon: '🩸', color: '#e53935', kind: 'basic', tags: ['damage', 'heal'],
    cooldown: 8, range: 520, ai: 'damage',
    desc: (p) => `Drain the enemy nearest your aim for ${n(75 * p)} damage, healing you for the same amount.`,
    cast: (w, u, c) => {
      const t = w.nearestEnemyTo(u.team, c.aim, 520, u);
      if (!t) return false;
      w.fx({ kind: 'line', x: u.x, y: u.y, x2: t.x, y2: t.y, r: 0, color: '#e53935', duration: 0.35, width: 5 });
      const dealt = w.damage(u, t, 75 * c.p, 'spell');
      w.heal(u, dealt);
    },
  },
  {
    id: 'poison_cloud', name: 'Poison Cloud', icon: '☠️', color: '#9ccc65', kind: 'basic', tags: ['area', 'damage'],
    cooldown: 8, range: 700, ai: 'damage',
    desc: (p) => `Release a toxic cloud dealing ${n(50 * p)} damage per second for 3s.`,
    cast: (w, u, c) => {
      const t = clampAim(u, c.aim, 700);
      w.zone({ owner: u, x: t.x, y: t.y, radius: 200, duration: 3, dps: 50 * c.p, color: '#9ccc65' });
    },
  },
  {
    id: 'leap', name: 'Leap', icon: '🐸', color: '#aed581', kind: 'basic', tags: ['mobility', 'area', 'slow'],
    cooldown: 10, range: 480, ai: 'engage',
    desc: (p) => `Leap to a location, dealing ${n(70 * p)} damage and slowing enemies where you land.`,
    cast: (w, u, c) => {
      const t = clampAim(u, c.aim, 480);
      const dist = Math.hypot(t.x - u.x, t.y - u.y);
      w.dash(u, c.dir, dist, 1100, {
        onEnd: () => w.nova({ owner: u, x: u.x, y: u.y, radius: 170, delay: 0, color: '#aed581',
          onHit: (e) => { w.damage(u, e, 70 * c.p, 'spell'); w.slow(e, 0.35, 1.5); } }),
      });
    },
  },
  {
    id: 'battle_cry', name: 'Battle Cry', icon: '📯', color: '#ffd54f', kind: 'basic', tags: ['support', 'attack speed', 'movement speed'],
    cooldown: 14, range: 500, ai: 'self',
    desc: (_p, m) => `You and nearby allied heroes gain ${pct(0.25 * m)} attack speed and ${pct(0.15 * m)} move speed for 4s.`,
    cast: (w, u, c) => {
      for (const a of w.alliesNear(u.team, u.x, u.y, 500, true)) {
        w.addBuff(a, { id: 'battle_cry', duration: 4, mul: { attackSpeed: 0.25 * c.m, moveSpeed: 0.15 * c.m } });
      }
      w.fx({ kind: 'ring', x: u.x, y: u.y, r: 500, color: '#ffd54f', duration: 0.5 });
    },
  },
];

// ---------------------------------------------------------------- ultimates (R)

const ULTS: AbilityDef[] = [
  {
    id: 'inferno', name: 'Inferno', icon: '🌋', color: '#ff5722', kind: 'ult', tags: ['area', 'damage'],
    cooldown: 45, range: 850, ai: 'damage',
    desc: (p) => `After 1s, engulf a huge area in flames for ${n(280 * p)} damage.`,
    cast: (w, u, c) => {
      const t = clampAim(u, c.aim, 850);
      w.nova({ owner: u, x: t.x, y: t.y, radius: 320, delay: 1, color: '#ff5722', onHit: (e) => w.damage(u, e, 280 * c.p, 'spell') });
    },
  },
  {
    id: 'death_mark', name: 'Requiem', icon: '💀', color: '#b0bec5', kind: 'ult', tags: ['global', 'damage'],
    cooldown: 70, range: 99999, ai: 'global',
    desc: (p) => `After 2.5s, strike every visible enemy hero anywhere on the map for ${n(190 * p)} damage.`,
    cast: (w, u, c) => {
      const team = u.team;
      w.schedule(2.5, () => {
        for (const e of w.heroList) {
          if (e.team === team || e.dead || !w.isVisible(e, team)) continue;
          w.fx({ kind: 'burst', x: e.x, y: e.y, r: 90, color: '#b0bec5', duration: 0.6 });
          w.damage(u, e, 190 * c.p, 'spell');
        }
      });
      for (const e of w.heroList) if (e.team !== team && !e.dead) w.fx({ kind: 'ring', x: e.x, y: e.y, r: 70, color: '#b0bec5', duration: 2.5 });
    },
  },
  {
    id: 'avatar', name: 'Avatar', icon: '🗿', color: '#ffcc80', kind: 'ult', tags: ['buff', 'attack speed', 'size'],
    cooldown: 60, range: 0, ai: 'self',
    desc: (p, m) => `Grow huge for 10s: +${pct(0.45 * m)} attack damage and attack speed, +30% max health, 15% lifesteal, and heal ${n(250 * p)}.`,
    cast: (w, u, c) => {
      w.addBuff(u, { id: 'avatar', duration: 10, mul: { ad: 0.45 * c.m, attackSpeed: 0.45 * c.m, maxHp: 0.3 }, add: { size: 0.35, lifesteal: 0.15 } });
      w.heal(u, 250 * c.p);
    },
  },
  {
    id: 'black_hole', name: 'Black Hole', icon: '🕳️', color: '#7c4dff', kind: 'ult', tags: ['area', 'pull', 'damage'],
    cooldown: 55, range: 750, ai: 'damage',
    desc: (p) => `Open a black hole for 3s that pulls enemies in and deals ${n(60 * p)} damage per second.`,
    cast: (w, u, c) => {
      const t = clampAim(u, c.aim, 750);
      w.zone({ owner: u, x: t.x, y: t.y, radius: 280, duration: 3, dps: 60 * c.p, pull: 230, slowPct: 0.2, color: '#7c4dff' });
    },
  },
  {
    id: 'laser', name: 'Solar Beam', icon: '🔆', color: '#ffeb3b', kind: 'ult', tags: ['long range', 'damage'],
    cooldown: 50, range: 1400, ai: 'damage',
    desc: (p) => `After 0.4s, fire a beam across a huge line dealing ${n(340 * p)} damage.`,
    cast: (w, u, c) => {
      const dir = { ...c.dir };
      w.fx({ kind: 'line', x: u.x, y: u.y, x2: u.x + dir.x * 1400, y2: u.y + dir.y * 1400, r: 0, color: '#fff9c4', duration: 0.4, width: 3 });
      w.schedule(0.4, () => {
        if (u.dead) return;
        w.fx({ kind: 'line', x: u.x, y: u.y, x2: u.x + dir.x * 1400, y2: u.y + dir.y * 1400, r: 0, color: '#ffeb3b', duration: 0.35, width: 40 });
        w.lineHit(u, dir, 1400, 55, (e) => w.damage(u, e, 340 * c.p, 'spell'));
      });
    },
  },
  {
    id: 'earthquake', name: 'Earthquake', icon: '🌎', color: '#8d6e63', kind: 'ult', tags: ['area', 'stun'],
    cooldown: 55, range: 360, ai: 'self',
    desc: (p, m) => `Shatter the ground around you, dealing ${n(160 * p)} damage and stunning for ${(1.2 + 0.3 * m).toFixed(1)}s.`,
    cast: (w, u, c) => {
      w.nova({ owner: u, x: u.x, y: u.y, radius: 360, delay: 0.3, color: '#8d6e63',
        onHit: (e) => { w.damage(u, e, 160 * c.p, 'spell'); w.stun(e, 1.2 + 0.3 * c.m); } });
    },
  },
  {
    id: 'arrow_storm', name: 'Arrow Storm', icon: '🌧️', color: '#aed581', kind: 'ult', tags: ['area', 'slow'],
    cooldown: 50, range: 950, ai: 'damage',
    desc: (p) => `Rain arrows on a large area for 4s: ${n(85 * p)} damage per second and a 30% slow.`,
    cast: (w, u, c) => {
      const t = clampAim(u, c.aim, 950);
      w.zone({ owner: u, x: t.x, y: t.y, radius: 300, duration: 4, dps: 85 * c.p, slowPct: 0.3, color: '#aed581' });
    },
  },
  {
    id: 'charge', name: 'Unstoppable Charge', icon: '🐂', color: '#ff7043', kind: 'ult', tags: ['mobility', 'stun'],
    cooldown: 45, range: 700, ai: 'engage',
    desc: (p) => `Charge 700 units, dealing ${n(180 * p)} damage and stunning everything you hit for 1s.`,
    cast: (w, u, c) => {
      w.dash(u, c.dir, 700, 1500, { damage: 180 * c.p, radius: 65, stun: 1 });
    },
  },
  {
    id: 'resurgence', name: 'Resurgence', icon: '🌅', color: '#f48fb1', kind: 'ult', tags: ['heal', 'support', 'cleanse'],
    cooldown: 60, range: 600, ai: 'heal',
    desc: (_p, m) => `Cleanse yourself, heal ${pct(Math.min(0.9, 0.4 * m))} of your max health and heal nearby allied heroes for 25%.`,
    cast: (w, u, c) => {
      u.stunUntil = 0;
      u.slowUntil = 0;
      w.heal(u, u.stats.maxHp * Math.min(0.9, 0.4 * c.m));
      for (const a of w.alliesNear(u.team, u.x, u.y, 600, true)) if (a !== u) w.heal(a, a.stats.maxHp * 0.25);
      w.fx({ kind: 'ring', x: u.x, y: u.y, r: 600, color: '#f48fb1', duration: 0.6 });
    },
  },
  {
    id: 'shadow_strike', name: 'Shadow Strike', icon: '🌑', color: '#9575cd', kind: 'ult', tags: ['mobility', 'execute', 'damage'],
    cooldown: 40, range: 750, ai: 'engage',
    desc: (p) => `Teleport behind the enemy hero nearest your aim and strike for ${n(220 * p)} damage. Double damage to targets under 30% health.`,
    cast: (w, u, c) => {
      const t = w.nearestEnemyTo(u.team, c.aim, 750, u, true);
      if (!t) return false;
      const dx = t.x - u.x;
      const dy = t.y - u.y;
      const d = Math.hypot(dx, dy) || 1;
      w.fx({ kind: 'line', x: u.x, y: u.y, x2: t.x, y2: t.y, r: 0, color: '#9575cd', duration: 0.3, width: 6 });
      w.moveUnit(u, t.x + (dx / d) * (t.radius + u.radius + 5), t.y + (dy / d) * (t.radius + u.radius + 5));
      const execute = t.hp / t.stats.maxHp < 0.3 ? 2 : 1;
      w.damage(u, t, 220 * c.p * execute, 'spell');
    },
  },
  {
    id: 'time_warp', name: 'Time Warp', icon: '⏳', color: '#ffe082', kind: 'ult', tags: ['invulnerable', 'heal'],
    cooldown: 50, range: 0, ai: 'heal',
    desc: (_p, m) => `Freeze yourself in time for 2.5s: untargetable and immune to damage. Then heal ${pct(0.15 * m)} max health.`,
    cast: (w, u, c) => {
      w.invuln(u, 2.5);
      w.schedule(2.5, () => { if (!u.dead) w.heal(u, u.stats.maxHp * 0.15 * c.m); });
    },
  },
  {
    id: 'meteor_shower', name: 'Meteor Shower', icon: '🌠', color: '#ffab91', kind: 'ult', tags: ['area', 'damage'],
    cooldown: 55, range: 800, ai: 'damage',
    desc: (p) => `Call 6 meteors around the target area over 2s, each dealing ${n(110 * p)} damage.`,
    cast: (w, u, c) => {
      const t = clampAim(u, c.aim, 800);
      for (let i = 0; i < 6; i++) {
        const x = t.x + w.rng.range(-170, 170);
        const y = t.y + w.rng.range(-170, 170);
        w.nova({ owner: u, x, y, radius: 120, delay: 0.5 + i * 0.3, color: '#ffab91', onHit: (e) => w.damage(u, e, 110 * c.p, 'spell') });
      }
    },
  },
];

// ---------------------------------------------------------------- passives (P)

const PASSIVES: AbilityDef[] = [
  {
    id: 'bloodthirst', name: 'Bloodthirst', icon: '🧛', color: '#c62828', kind: 'passive', tags: ['lifesteal'], cooldown: 0, range: 0,
    desc: (_p, m) => `Attacks heal you for ${pct(0.12 * m)} of the damage dealt.`,
    mods: (m) => ({ add: { lifesteal: 0.12 * m } }),
  },
  {
    id: 'berserk', name: 'Berserk', icon: '😡', color: '#e53935', kind: 'passive', tags: ['attack speed'], cooldown: 0, range: 0,
    desc: (_p, m) => `+${pct(0.35 * m)} attack speed.`,
    mods: (m) => ({ mul: { attackSpeed: 0.35 * m } }),
  },
  {
    id: 'fleetfoot', name: 'Fleetfoot', icon: '🦌', color: '#4dd0e1', kind: 'passive', tags: ['movement speed'], cooldown: 0, range: 0,
    desc: (_p, m) => `+${pct(0.14 * m)} move speed.`,
    mods: (m) => ({ mul: { moveSpeed: 0.14 * m } }),
  },
  {
    id: 'giant', name: 'Giant Blood', icon: '🦣', color: '#8d6e63', kind: 'passive', tags: ['health', 'size'], cooldown: 0, range: 0,
    desc: (_p, m) => `+${pct(0.2 * m)} max health. You are bigger.`,
    mods: (m) => ({ mul: { maxHp: 0.2 * m }, add: { size: 0.25 } }),
  },
  {
    id: 'spellweaver', name: 'Spellweaver', icon: '📖', color: '#7986cb', kind: 'passive', tags: ['spell power', 'cooldowns'], cooldown: 0, range: 0,
    desc: (_p, m) => `+${pct(0.22 * m)} spell power and ${pct(0.1 * m)} cooldown reduction.`,
    mods: (m) => ({ mul: { spellPower: 0.22 * m }, add: { cdr: 0.1 * m } }),
  },
  {
    id: 'static_charge', name: 'Static Charge', icon: '🔋', color: '#fff176', kind: 'passive', tags: ['on-hit', 'bounce'], cooldown: 0, range: 0,
    desc: (p) => `Every 3rd attack releases lightning that bounces between 3 enemies for ${n(55 * p)} damage.`,
    onAttack: (w, u, t, _m, p) => {
      if (u.hero && u.hero.attackCount % 3 === 0) w.chain(u, t, 3, 300, 55 * p, '#fff176');
    },
  },
  {
    id: 'concussive', name: 'Concussive Blows', icon: '🥊', color: '#ffb74d', kind: 'passive', tags: ['stun', 'on-hit'], cooldown: 0, range: 0,
    desc: (p) => `Every 4th attack deals ${n(40 * p)} bonus damage and stuns for 0.7s.`,
    onAttack: (w, u, t, _m, p) => {
      if (u.hero && u.hero.attackCount % 4 === 0) {
        w.damage(u, t, 40 * p, 'spell');
        w.stun(t, 0.7);
      }
    },
  },
  {
    id: 'thornmail', name: 'Thorns', icon: '🌵', color: '#7cb342', kind: 'passive', tags: ['thorns', 'health'], cooldown: 0, range: 0,
    desc: (_p, m) => `Reflect ${pct(0.25 * m)} of damage taken back to the attacker. +10% max health.`,
    mods: (m) => ({ add: { thorns: 0.25 * m }, mul: { maxHp: 0.1 } }),
  },
  {
    id: 'executioner', name: 'Executioner', icon: '🪓', color: '#b71c1c', kind: 'passive', tags: ['execute'], cooldown: 0, range: 0,
    desc: (_p, m) => `Deal ${pct(0.3 * m)} more damage to enemies under 35% health.`,
    mods: (m) => ({ add: { execute: 0.3 * m } }),
  },
  {
    id: 'shroud', name: "Assassin's Shroud", icon: '🌫️', color: '#9e9e9e', kind: 'passive', tags: ['invisibility'], cooldown: 0, range: 0,
    desc: (_p, m) => `After ${(4.5 / m).toFixed(1)}s out of combat you become invisible until you attack or cast.`,
    onTick: (w, u, _dt, m) => {
      if (u.hero && w.time - u.hero.lastCombatAt > 4.5 / m) u.stealthUntil = Math.max(u.stealthUntil, w.time + 0.2);
    },
  },
  {
    id: 'troll_blood', name: 'Troll Blood', icon: '🧌', color: '#66bb6a', kind: 'passive', tags: ['regeneration'], cooldown: 0, range: 0,
    desc: (_p, m) => `Regenerate ${(1.5 * m).toFixed(1)}% of your max health per second.`,
    onTick: (w, u, dt, m) => {
      if (u.hp < u.stats.maxHp) w.heal(u, u.stats.maxHp * 0.015 * m * dt, true);
    },
  },
  {
    id: 'critical_eye', name: 'Critical Eye', icon: '👁️', color: '#ffca28', kind: 'passive', tags: ['critical'], cooldown: 0, range: 0,
    desc: (_p, m) => `${pct(Math.min(1, 0.28 * m))} chance for attacks to critically strike for 175% damage.`,
    mods: (m) => ({ add: { critChance: 0.28 * m } }),
  },
  {
    id: 'long_reach', name: 'Long Reach', icon: '🔭', color: '#4db6ac', kind: 'passive', tags: ['attack range'], cooldown: 0, range: 0,
    desc: (_p, m) => `+${n(130 * m)} attack range. Melee heroes become ranged if it's enough.`,
    mods: (m) => ({ add: { attackRange: 130 * m } }),
  },
  {
    id: 'last_stand', name: 'Last Stand', icon: '🩹', color: '#ef9a9a', kind: 'passive', tags: ['damage reduction', 'attack speed'], cooldown: 0, range: 0,
    desc: (_p, m) => `Below 35% health, take 30% less damage and gain ${pct(0.35 * m)} attack speed.`,
    dynamicMods: (u, m) => (u.hp / u.stats.maxHp < 0.35 ? { add: { damageReduction: 0.3 }, mul: { attackSpeed: 0.35 * m } } : null),
  },
  {
    id: 'arcane_echo', name: 'Arcane Echo', icon: '🔁', color: '#b39ddb', kind: 'passive', tags: ['cooldowns'], cooldown: 0, range: 0,
    desc: (_p, m) => `${pct(0.25 * m)} cooldown reduction.`,
    mods: (m) => ({ add: { cdr: 0.25 * m } }),
  },
];

export const ABILITIES: AbilityDef[] = [...BASICS, ...ULTS, ...PASSIVES];
export const BASIC_POOL = BASICS;
export const ULT_POOL = ULTS;
export const PASSIVE_POOL = PASSIVES;
export const abilityById = (id: string) => ABILITIES.find((a) => a.id === id);
