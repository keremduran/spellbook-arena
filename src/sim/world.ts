import { thinkCreep, thinkHero } from './ai';
import type { AbilityDef } from './abilities';
import { bestBoonIndex, rollBoonOffer, type EffectId } from './boons';
import {
  DIFFICULTY, FIRST_WAVE, FOUNTAIN, FOUNTAIN_RADIUS, LANE_Y, MAP_W, MAX_LEVEL, RANGED_THRESHOLD, RUNE_FIRST, RUNE_INTERVAL, RUNE_RADIUS,
  STRUCTURE_X, WAVE_INTERVAL, Y_MAX, Y_MIN, laneDir, mirrorX, respawnTime, xpToNext, type Difficulty,
  ASSISTS_PER_BOON, KILLS_PER_BOON,
} from './constants';
import { heroBaseStats, levelScale, type HeroDef } from './heroes';
import { Rng } from './rng';
import {
  RARITIES, STAT_KEYS, emptyStats, otherTeam,
  type AbilityInst, type BoonInst, type Fx, type GameEvent, type Mods, type Nova, type Projectile, type Rarity, type Slot,
  type Stats, type Team, type Unit, type UnitKind, type Vec, type Zone,
} from './types';

export interface WorldOptions {
  /** Pick a boon every N levels (0 = never). */
  boonEveryLevels: number;
  seed?: number;
  /** Enemy bots of the player deal more or less damage and cast more or less often. */
  difficulty?: Difficulty;
}

export interface HeroSetup {
  def: HeroDef;
  team: Team;
  name: string;
  isPlayer?: boolean;
  managed?: boolean;
  picks: Partial<Record<Slot, { def: AbilityDef; rarity: Rarity }>>;
}

const len = (x: number, y: number) => Math.hypot(x, y);
const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
const intFmt = (v: number) => String(Math.round(v));
/** Effect boons with a ceiling: [value per 1.0 of power, maximum]. Matches the numbers in boons.ts / world. */
const EFFECT_CAPS: Partial<Record<EffectId, [number, number]>> = {
  frost: [0.22, 0.45], cleave: [0.4, 1], ricochet: [0.45, 0.9], echo: [0.3, 0.6], overcharge: [0.3, 0.6], detonate: [0.15, 0.5],
};
/** Stats shown on boon cards: [key, label, format, cap]. */
const STAT_PREVIEW: [keyof Stats, string, (v: number) => string, number?][] = [
  ['maxHp', 'Max health', intFmt], ['hpRegen', 'Health regen', (v) => `${v.toFixed(1)}/s`], ['regenPct', 'Regen', (v) => `${(v * 100).toFixed(1)}% hp/s`, 0.15],
  ['recoup', 'Heal back from damage', pctFmt, 0.8], ['damageReduction', 'Damage taken reduced by', pctFmt, 0.55], ['ad', 'Attack damage', intFmt],
  ['attackSpeed', 'Attack speed', (v) => v.toFixed(2)], ['attackRange', 'Attack range', intFmt], ['moveSpeed', 'Move speed', intFmt, 650],
  ['spellPower', 'Spell power', pctFmt], ['cdr', 'Cooldown reduction', pctFmt, 0.6], ['critChance', 'Crit chance', pctFmt, 1],
  ['lifesteal', 'Lifesteal', pctFmt], ['spellVamp', 'Spell vamp', pctFmt], ['onHitDamage', 'On-hit damage', intFmt],
  ['thorns', 'Thorns', pctFmt], ['execute', 'Execute bonus', pctFmt],
];
/** Extra damage taken by a hero on a kill streak: +5% per kill past 4, up to +40%. */
export const bountyBonus = (streak: number) => Math.min(0.4, Math.max(0, streak - 4) * 0.05);
const MINION_POWER = 1.15;
/** XP for taking down a hero of the given level (raised so winning fights snowballs into boons). */
const KILL_XP = (level: number) => 150 + 36 * level;
const ASSIST_XP = (level: number) => 75 + 19 * level;
/** Extra minion health on top of MINION_POWER (+10%, then +20%). */
const MINION_HP = 1.1 * 1.2;

export class World {
  time = 0;
  units: Unit[] = [];
  heroList: Unit[] = [];
  projectiles: Projectile[] = [];
  zones: Zone[] = [];
  novas: Nova[] = [];
  fxList: Fx[] = [];
  events: GameEvent[] = [];
  winner: Team | null = null;
  kills: Record<Team, number> = { blue: 0, red: 0 };
  rng: Rng;
  /** Set by an ability's cast to replace its cooldown for this cast only. */
  cooldownOverride: number | null = null;
  /** Damage multiplier while a projectile hit resolves. */
  dmgScale = 1;
  rune = { x: MAP_W / 2, y: LANE_Y, active: false, nextAt: RUNE_FIRST };
  playerTeam: Team | null = null;
  private firstBlood = false;

  private nextId = 1;
  private nextWave = FIRST_WAVE;
  private waveCount = 0;
  private scheduled: { at: number; fn: () => void }[] = [];
  private byId = new Map<number, Unit>();

  constructor(public opts: WorldOptions) {
    this.rng = new Rng(opts.seed ?? Math.floor(Math.random() * 2 ** 31));
    for (const team of ['blue', 'red'] as Team[]) this.buildBase(team);
  }

  // ------------------------------------------------------------------ setup

  private makeUnit(kind: UnitKind, team: Team, x: number, y: number, radius: number, base: Stats): Unit {
    const u: Unit = {
      id: this.nextId++, kind, team, x, y, radius, hp: base.maxHp, stats: { ...base }, baseStats: base, dead: false,
      attackCd: 0, facing: { x: laneDir(team), y: 0 }, order: { kind: 'idle' },
      stunUntil: 0, slowUntil: 0, slowPct: 0, stealthUntil: 0, invulnUntil: 0, shield: 0, shieldUntil: 0,
      buffs: [], damagedBy: new Map(), lastHitHeroAt: -99, dots: [], nextDot: 0, recoupPool: 0,
    };
    this.units.push(u);
    this.byId.set(u.id, u);
    return u;
  }

  private buildBase(team: Team) {
    const tower = (hp: number): Stats => ({ ...emptyStats(), maxHp: hp, ad: 130, attackRange: 560, attackSpeed: 0.85 });
    const outer = this.makeUnit('tower', team, mirrorX(team, STRUCTURE_X.outer), LANE_Y, 42, tower(5000));
    outer.structure = { consecutive: 0 };
    const inner = this.makeUnit('tower', team, mirrorX(team, STRUCTURE_X.inner), LANE_Y, 42, tower(5400));
    inner.structure = { consecutive: 0, protectedBy: outer.id };
    const nexus = this.makeUnit('nexus', team, mirrorX(team, STRUCTURE_X.nexus), LANE_Y, 62, { ...emptyStats(), maxHp: 5500 });
    nexus.structure = { consecutive: 0, protectedBy: inner.id };
  }

  addHero(setup: HeroSetup): Unit {
    const f = FOUNTAIN[setup.team];
    const base = heroBaseStats(setup.def, 1);
    const u = this.makeUnit('hero', setup.team, f.x + laneDir(setup.team) * 60, f.y + this.rng.range(-120, 120), 24, base);
    const abilities: Partial<Record<Slot, AbilityInst>> = {};
    for (const [slot, pick] of Object.entries(setup.picks)) {
      if (pick) abilities[slot as Slot] = { def: pick.def, rarity: pick.rarity, readyAt: 0 };
    }
    u.hero = {
      def: setup.def, name: setup.name, isPlayer: !!setup.isPlayer, managed: !!setup.managed, directive: 'auto', level: 1, xp: 0, kills: 0, deaths: 0, assists: 0,
      respawnAt: 0, abilities, boons: [], offers: [], attackCount: 0, lastCombatAt: -99, moveDir: null,
      retreating: false, nextThink: 0, laneOffset: this.rng.range(-170, 170),
      effects: {}, secondWindUsed: false, nextThunder: 0, nextStatic: 0, streak: 0, multi: 0, multiAt: -99, dmgDealt: 0, dmgTaken: 0, dmgBuildings: 0, dmgTotal: 0,
    };
    if (setup.isPlayer) this.playerTeam = setup.team;
    this.recompute(u);
    u.hp = u.stats.maxHp;
    this.heroList.push(u);
    return u;
  }

  unit(id: number | undefined) {
    return id === undefined ? undefined : this.byId.get(id);
  }

  // ------------------------------------------------------------------ queries

  isVisible(t: Unit, team: Team) {
    return t.team === team || t.stealthUntil <= this.time;
  }

  isProtected(t: Unit) {
    const p = this.unit(t.structure?.protectedBy);
    return !!p && !p.dead;
  }

  /** Can `u` attack `t` right now (alive, enemy, visible, not invulnerable/protected)? */
  attackable(u: Unit, t: Unit) {
    return !t.dead && t.team !== u.team && this.isVisible(t, u.team) && t.invulnUntil <= this.time && !this.isProtected(t);
  }

  enemiesNear(team: Team, x: number, y: number, r: number, opts: { heroesOnly?: boolean; structures?: boolean } = {}) {
    return this.units.filter((t) => {
      if (t.dead || t.team === team || t.invulnUntil > this.time) return false;
      if (opts.heroesOnly && t.kind !== 'hero') return false;
      if (!opts.structures && (t.kind === 'tower' || t.kind === 'nexus')) return false;
      return len(t.x - x, t.y - y) <= r + t.radius;
    });
  }

  alliesNear(team: Team, x: number, y: number, r: number, heroesOnly = false) {
    return this.units.filter((t) => !t.dead && t.team === team && (!heroesOnly || t.kind === 'hero') && len(t.x - x, t.y - y) <= r + t.radius);
  }

  /** Nearest visible enemy (hero or creep) to `point`, within `range` of the caster. */
  nearestEnemyTo(team: Team, point: Vec, range: number, caster: Unit, heroesOnly = false) {
    let best: Unit | undefined;
    let bestD = Infinity;
    for (const t of this.units) {
      if (t.dead || t.team === team || !this.isVisible(t, team) || t.invulnUntil > this.time) continue;
      if (t.kind === 'tower' || t.kind === 'nexus') continue;
      if (heroesOnly && t.kind !== 'hero') continue;
      if (len(t.x - caster.x, t.y - caster.y) > range + t.radius) continue;
      const d = len(t.x - point.x, t.y - point.y) - (t.kind === 'hero' ? 80 : 0);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  /** Backdoor protection: structures resist heroes unless the attackers' minions are close. */
  minionsNear(team: Team, at: Unit, r: number) {
    return this.units.some((c) => c.kind === 'creep' && !c.dead && c.team === team && len(c.x - at.x, c.y - at.y) < r);
  }

  /** Summed rarity of an effect boon (0 when not owned). */
  effect(u: Unit, id: EffectId) {
    return u.hero?.effects[id] ?? 0;
  }

  /** How strong bot-vs-player difficulty makes this unit. */
  difficulty() {
    return DIFFICULTY[this.opts.difficulty ?? 'normal'];
  }

  addDot(src: Unit, tgt: Unit, dps: number, dur: number) {
    if (tgt.kind === 'tower' || tgt.kind === 'nexus') return;
    const existing = tgt.dots.find((d) => d.src === src);
    if (existing) {
      existing.dps = Math.max(existing.dps, dps);
      existing.until = this.time + dur;
    } else tgt.dots.push({ src, dps, until: this.time + dur });
  }

  /** Comeback bonus for a team trailing on kills: +1.25% per kill behind past 8, up to 25%. */
  underdog(team: Team) {
    const behind = team === 'blue' ? this.kills.red - this.kills.blue : this.kills.blue - this.kills.red;
    return Math.min(0.25, Math.max(0, behind - 8) * 0.0125);
  }

  power(u: Unit, rarity: Rarity) {
    return RARITIES[rarity].mult * u.stats.spellPower * levelScale(u.hero?.level ?? 1);
  }

  // ------------------------------------------------------------------ effects API (used by abilities)

  projectile(o: { owner: Unit; dir: Vec; speed: number; range: number; radius: number; color: string; pierce?: boolean; onHit: (t: Unit) => void; noSplit?: boolean; scale?: number }) {
    const split = o.noSplit ? 0 : this.effect(o.owner, 'split');
    if (split > 0) {
      const angles = split >= 1.8 ? [-0.42, -0.21, 0.21, 0.42] : [-0.25, 0.25];
      for (const a of angles) {
        const dir = { x: o.dir.x * Math.cos(a) - o.dir.y * Math.sin(a), y: o.dir.x * Math.sin(a) + o.dir.y * Math.cos(a) };
        this.projectile({ ...o, dir, noSplit: true, scale: 0.5 });
      }
    }
    this.projectiles.push({
      id: this.nextId++, owner: o.owner, team: o.owner.team, x: o.owner.x, y: o.owner.y, vx: o.dir.x * o.speed, vy: o.dir.y * o.speed,
      speed: o.speed, radius: o.radius, range: o.range, traveled: 0, color: o.color, pierce: !!o.pierce, hit: new Set(), onHit: o.onHit, scale: o.scale,
    });
  }

  nova(o: { owner: Unit; x: number; y: number; radius: number; delay: number; color: string; onHit: (t: Unit) => void }) {
    this.novas.push({ owner: o.owner, team: o.owner.team, x: o.x, y: o.y, radius: o.radius, start: this.time, at: this.time + o.delay, color: o.color, onHit: o.onHit });
  }

  zone(o: { owner: Unit; x: number; y: number; radius: number; duration: number; dps: number; slowPct?: number; pull?: number; color: string; follow?: boolean }) {
    this.zones.push({
      owner: o.owner, team: o.owner.team, x: o.x, y: o.y, radius: o.radius, until: this.time + o.duration, dps: o.dps,
      slowPct: o.slowPct ?? 0, pull: o.pull ?? 0, color: o.color, follow: !!o.follow, nextTick: this.time,
    });
  }

  dash(u: Unit, dir: Vec, dist: number, speed: number, o: { damage?: number; radius?: number; stun?: number; onEnd?: () => void } = {}) {
    this.afterimage(u);
    u.dash = {
      vx: dir.x * speed, vy: dir.y * speed, until: this.time + dist / speed, hit: new Set(),
      damage: o.damage ?? 0, radius: o.radius ?? 0, stun: o.stun ?? 0, onEnd: o.onEnd,
    };
  }

  blinkTo(u: Unit, aim: Vec, maxRange: number) {
    this.afterimage(u);
    const dx = aim.x - u.x;
    const dy = aim.y - u.y;
    const d = len(dx, dy);
    const k = d > maxRange ? maxRange / d : 1;
    this.fx({ kind: 'burst', x: u.x, y: u.y, r: 50, color: '#b388ff', duration: 0.35 });
    this.moveUnit(u, u.x + dx * k, u.y + dy * k);
    this.fx({ kind: 'burst', x: u.x, y: u.y, r: 50, color: '#b388ff', duration: 0.35 });
  }

  private afterimage(u: Unit) {
    const m = this.effect(u, 'afterimage');
    if (!m) return;
    const dmg = 80 * m * levelScale(u.hero!.level);
    this.nova({ owner: u, x: u.x, y: u.y, radius: 150, delay: 0.15, color: '#b388ff', onHit: (t) => this.damage(u, t, dmg, 'spell') });
  }

  moveUnit(u: Unit, x: number, y: number) {
    u.x = Math.max(30, Math.min(MAP_W - 30, x));
    u.y = Math.max(Y_MIN, Math.min(Y_MAX, y));
  }

  addBuff(u: Unit, b: { id: string; duration: number } & Mods) {
    u.buffs = u.buffs.filter((x) => x.id !== b.id);
    u.buffs.push({ id: b.id, until: this.time + b.duration, add: b.add, mul: b.mul });
  }

  stun(t: Unit, dur: number) {
    if (t.kind === 'tower' || t.kind === 'nexus') return;
    t.stunUntil = Math.max(t.stunUntil, this.time + dur);
    t.dash = undefined;
  }

  slow(t: Unit, pct: number, dur: number) {
    if (t.slowUntil > this.time && t.slowPct > pct) return;
    t.slowPct = pct;
    t.slowUntil = this.time + dur;
  }

  knockback(t: Unit, fromX: number, fromY: number, dist: number) {
    if (t.kind !== 'hero' && t.kind !== 'creep') return;
    const dx = t.x - fromX;
    const dy = t.y - fromY;
    const d = len(dx, dy) || 1;
    this.moveUnit(t, t.x + (dx / d) * dist, t.y + (dy / d) * dist);
  }

  heal(u: Unit, amount: number, silent = false) {
    if (u.dead || amount <= 0) return;
    const before = u.hp;
    u.hp = Math.min(u.stats.maxHp, u.hp + amount);
    if (!silent && u.hp - before >= 1) {
      this.events.push({ type: 'damage', x: u.x, y: u.y, amount: u.hp - before, crit: false, srcId: u.id, tgtId: u.id, heal: true });
    }
  }

  /** Shields stack (up to 60% of the unit's max health); the longest remaining duration is kept. */
  shield(u: Unit, amount: number, dur: number) {
    u.shield = Math.min(u.stats.maxHp * 0.6, u.shield + amount);
    u.shieldUntil = Math.max(u.shieldUntil, this.time + dur);
  }

  /** Keeps the longer of the current and new invisibility. */
  stealth(u: Unit, dur: number) {
    u.stealthUntil = Math.max(u.stealthUntil, this.time + dur);
  }

  /** Keeps the longer of the current and new invulnerability (Second Wind can't cut Time Warp short). */
  invuln(u: Unit, dur: number) {
    u.invulnUntil = Math.max(u.invulnUntil, this.time + dur);
    u.dash = undefined;
  }

  fx(f: Omit<Fx, 'start' | 'until'> & { duration: number }) {
    const { duration, ...rest } = f;
    this.fxList.push({ ...rest, start: this.time, until: this.time + duration });
  }

  schedule(delay: number, fn: () => void) {
    this.scheduled.push({ at: this.time + delay, fn });
  }

  chain(u: Unit, first: Unit, bounces: number, hopRange: number, damage: number, color: string) {
    const hit = new Set<number>();
    let cur: Unit | undefined = first;
    let px = u.x;
    let py = u.y;
    for (let i = 0; i < bounces && cur; i++) {
      hit.add(cur.id);
      this.fx({ kind: 'line', x: px, y: py, x2: cur.x, y2: cur.y, r: 0, color, duration: 0.3, width: 3 });
      this.damage(u, cur, damage, 'spell');
      px = cur.x;
      py = cur.y;
      const from: Unit = cur;
      cur = this.enemiesNear(u.team, from.x, from.y, hopRange)
        .filter((t) => !hit.has(t.id) && this.isVisible(t, u.team))
        .sort((a, b) => len(a.x - from.x, a.y - from.y) - len(b.x - from.x, b.y - from.y))[0];
    }
  }

  lineHit(u: Unit, dir: Vec, length: number, halfWidth: number, fn: (t: Unit) => void) {
    for (const t of this.enemiesNear(u.team, u.x, u.y, length)) {
      const rx = t.x - u.x;
      const ry = t.y - u.y;
      const along = rx * dir.x + ry * dir.y;
      const perp = Math.abs(rx * dir.y - ry * dir.x);
      if (along >= -t.radius && along <= length && perp <= halfWidth + t.radius) fn(t);
    }
  }

  // ------------------------------------------------------------------ combat

  /** Deals damage and returns the amount actually dealt to health. */
  damage(src: Unit, tgt: Unit, amount: number, type: 'attack' | 'spell' | 'true', crit = false): number {
    if (tgt.dead || amount <= 0 || tgt.invulnUntil > this.time || this.isProtected(tgt)) return 0;
    amount *= this.dmgScale;
    if (src.stats.execute > 0 && tgt.hp / tgt.stats.maxHp < 0.35) amount *= 1 + src.stats.execute;
    if (tgt.structure && src.kind === 'hero' && !this.minionsNear(src.team, tgt, 700)) amount *= 0.4;
    // Structures harden against high-level heroes, so snowballing wins fights, not instant sieges.
    if (tgt.structure && src.hero) amount /= 1 + 0.06 * (src.hero.level - 1);
    // Minion waves are big and frequent now, so structures shrug off most minion damage.
    if (tgt.structure && src.kind === 'creep') amount *= 0.35;
    if (tgt.structure) {
      // Fortified early (no 4-minute stomps), crumbling in overtime (no 40-minute stalemates).
      const minutes = this.time / 60;
      if (minutes < 6) amount *= 0.4;
      else if (minutes > 10) amount *= 1 + (minutes - 10) * 0.35;
    }
    if (this.playerTeam && src.hero && !src.hero.isPlayer && src.team !== this.playerTeam) amount *= this.difficulty().damage;
    // Bounty: a hero on a long kill streak takes extra damage, so nobody stays unkillable.
    if (tgt.hero) amount *= 1 + bountyBonus(tgt.hero.streak);
    // Underdog: the team behind on kills hits enemy heroes harder.
    if (src.hero && tgt.hero) amount *= 1 + this.underdog(src.team);
    amount *= 1 - tgt.stats.damageReduction;
    // Damage meters count what landed, including what shields soaked up.
    const landed = Math.min(amount, tgt.hp + tgt.shield);
    if (tgt.hero) tgt.hero.dmgTaken += landed;
    if (src.hero && src.team !== tgt.team) {
      src.hero.dmgTotal += landed;
      if (tgt.hero) src.hero.dmgDealt += landed;
      else if (tgt.structure) src.hero.dmgBuildings += landed;
    }
    if (tgt.shield > 0) {
      const absorbed = Math.min(tgt.shield, amount);
      tgt.shield -= absorbed;
      amount -= absorbed;
    }
    const dealt = Math.min(tgt.hp, amount);
    tgt.hp -= amount;
    if (tgt.stats.recoup > 0 && amount > 0) tgt.recoupPool += amount * tgt.stats.recoup;

    if (src.hero) {
      src.hero.lastCombatAt = this.time;
      if (type === 'attack' && src.stats.lifesteal > 0) this.heal(src, dealt * src.stats.lifesteal, true);
      if (type === 'spell' && src.stats.spellVamp > 0) this.heal(src, dealt * src.stats.spellVamp, true);
      tgt.damagedBy.set(src.id, this.time);
      if (tgt.kind === 'hero') src.lastHitHeroAt = this.time;
    }
    if (tgt.hero) tgt.hero.lastCombatAt = this.time;
    if (type !== 'true' && tgt.stats.thorns > 0 && src !== tgt && !src.dead && src.kind !== 'tower') {
      this.damage(tgt, src, amount * tgt.stats.thorns, 'true');
    }
    if (src.kind === 'hero' || tgt.kind === 'hero') {
      this.events.push({ type: 'damage', x: tgt.x, y: tgt.y - tgt.radius, amount, crit, srcId: src.id, tgtId: tgt.id });
    }
    if (tgt.hp <= 0 && tgt.hero && !tgt.hero.secondWindUsed && this.effect(tgt, 'secondWind') > 0) {
      tgt.hero.secondWindUsed = true;
      tgt.hp = 1;
      this.invuln(tgt, 1 + 0.5 * this.effect(tgt, 'secondWind'));
      this.fx({ kind: 'ring', x: tgt.x, y: tgt.y, r: 120, color: '#fff59d', duration: 0.6 });
      this.events.push({ type: 'announce', text: 'Second Wind!', sub: tgt.hero.name, team: tgt.team, unitId: tgt.id });
      return dealt;
    }
    if (tgt.hp <= 0) this.kill(tgt, src);
    return dealt;
  }

  private attackHit(u: Unit, t: Unit) {
    if (t.dead || u.dead) return;
    let dmg = u.stats.ad;
    const crit = this.rng.next() < u.stats.critChance;
    if (crit) dmg *= 1.75;
    dmg += u.stats.onHitDamage;
    if (u.kind === 'tower') dmg = this.towerDamage(u, t);
    if (u.hero) u.hero.attackCount++;
    this.damage(u, t, dmg, 'attack', crit);
    if (u.hero) this.attackEffects(u, t, dmg);
    const passive = u.hero?.abilities.P;
    if (passive?.def.onAttack && !t.dead) passive.def.onAttack(this, u, t, RARITIES[passive.rarity].mult, this.power(u, passive.rarity));
  }

  /** On-hit effect boons. */
  private attackEffects(u: Unit, t: Unit, dmg: number) {
    const h = u.hero!;
    const ef = h.effects;
    const ls = levelScale(h.level);
    if (ef.burn && !t.dead) this.addDot(u, t, 18 * ef.burn * ls, 3);
    if (ef.frost && !t.dead) this.slow(t, Math.min(0.45, 0.22 * ef.frost), 1.2);
    if (ef.cleave) {
      const k = Math.min(1, 0.4 * ef.cleave);
      for (const e of this.enemiesNear(u.team, t.x, t.y, 150)) if (e !== t) this.damage(u, e, dmg * k, 'spell');
      this.fx({ kind: 'ring', x: t.x, y: t.y, r: 150, color: '#e0e0e0', duration: 0.25 });
    }
    if (ef.ricochet) {
      const k = Math.min(0.9, 0.45 * ef.ricochet);
      const extra = this.enemiesNear(u.team, t.x, t.y, 380)
        .filter((e) => e !== t && this.isVisible(e, u.team))
        .sort((a, b) => len(a.x - t.x, a.y - t.y) - len(b.x - t.x, b.y - t.y))
        .slice(0, Math.max(1, Math.round(ef.ricochet)));
      for (const e of extra) {
        this.fx({ kind: 'line', x: t.x, y: t.y, x2: e.x, y2: e.y, r: 0, color: '#ffcc80', duration: 0.2, width: 3 });
        this.damage(u, e, dmg * k, 'spell');
      }
    }
    if (ef.thunder && this.time >= h.nextThunder) {
      h.nextThunder = this.time + 4 / Math.sqrt(ef.thunder);
      const d = 70 * ef.thunder * ls;
      this.fx({ kind: 'line', x: t.x, y: t.y - 400, x2: t.x, y2: t.y, r: 0, color: '#b3e5fc', duration: 0.3, width: 6 });
      this.nova({ owner: u, x: t.x, y: t.y, radius: 140, delay: 0, color: '#b3e5fc', onHit: (e) => this.damage(u, e, d, 'spell') });
    }
  }

  private towerDamage(tower: Unit, t: Unit) {
    const minutes = this.time / 60;
    if (t.kind === 'creep') return t.stats.maxHp * 0.51;
    const s = tower.structure!;
    return (tower.stats.ad + minutes * 14) * (1 + 0.3 * s.consecutive);
  }

  private performAttack(u: Unit, t: Unit) {
    u.attackCd = 1 / Math.max(0.1, u.stats.attackSpeed);
    const dx = t.x - u.x;
    const dy = t.y - u.y;
    const d = len(dx, dy) || 1;
    u.facing = { x: dx / d, y: dy / d };
    if (u.hero) {
      u.stealthUntil = 0;
      u.hero.lastCombatAt = this.time;
    }
    if (u.kind === 'tower') {
      const s = u.structure!;
      s.consecutive = s.targetId === t.id && t.kind === 'hero' ? s.consecutive + 1 : 0;
      s.targetId = t.id;
    }
    const ranged = u.kind === 'tower' || u.stats.attackRange >= RANGED_THRESHOLD;
    if (u.kind !== 'creep') this.events.push({ type: 'attack', unitId: u.id, x: u.x, y: u.y, tx: t.x, ty: t.y, ranged, tower: u.kind === 'tower' });
    if (ranged) {
      this.projectiles.push({
        id: this.nextId++, owner: u, team: u.team, x: u.x, y: u.y, vx: 0, vy: 0, speed: u.kind === 'tower' ? 1300 : 1100,
        radius: u.kind === 'tower' ? 12 : 7, range: 99999, traveled: 0,
        color: u.kind === 'tower' ? (u.team === 'blue' ? '#90caf9' : '#ef9a9a') : u.hero ? '#fff8e1' : '#cfd8dc',
        pierce: false, hit: new Set(), targetId: t.id, onHit: (tt) => this.attackHit(u, tt),
      });
    } else {
      this.attackHit(u, t);
    }
  }

  inAttackRange(u: Unit, t: Unit) {
    return len(t.x - u.x, t.y - u.y) <= u.stats.attackRange + u.radius + t.radius;
  }

  castAbility(u: Unit, slot: Slot, aim: Vec): boolean {
    const h = u.hero;
    if (!h || u.dead || u.stunUntil > this.time || u.invulnUntil > this.time || this.winner) return false;
    const inst = h.abilities[slot];
    if (!inst || !inst.def.cast || inst.readyAt > this.time) return false;
    let dx = aim.x - u.x;
    let dy = aim.y - u.y;
    let d = len(dx, dy);
    if (d < 1) {
      dx = u.facing.x;
      dy = u.facing.y;
      d = 1;
    }
    const dir = { x: dx / d, y: dy / d };
    if (inst.def.id !== 'shadow_veil') u.stealthUntil = 0;
    this.cooldownOverride = null;
    const ok = inst.def.cast(this, u, { aim, dir, p: this.power(u, inst.rarity), m: RARITIES[inst.rarity].mult });
    if (ok === false) return false;
    this.events.push({ type: 'cast', unitId: u.id, abilityId: inst.def.id, kind: inst.def.kind, tags: inst.def.tags, color: inst.def.color, x: u.x, y: u.y });
    u.facing = dir;
    if (inst.def.ai !== 'escape' && inst.def.ai !== 'heal') h.lastCombatAt = this.time;
    let cd = this.cooldownOverride ?? inst.def.cooldown;
    const ef = h.effects;
    if (inst.def.kind === 'ult' && ef.overcharge) cd *= 1 - Math.min(0.6, 0.3 * ef.overcharge);
    inst.readyAt = this.time + cd * (1 - u.stats.cdr);
    if (ef.bulwarkCast && this.time >= (h.nextSpellshield ?? 0)) {
      h.nextSpellshield = this.time + 1.5;
      this.shield(u, 55 * ef.bulwarkCast * levelScale(h.level), 2.5);
    }
    if (ef.echo && inst.def.kind === 'basic' && this.rng.next() < Math.min(0.6, 0.3 * ef.echo)) {
      const ctx = { aim: { ...aim }, dir, p: this.power(u, inst.rarity), m: RARITIES[inst.rarity].mult };
      this.schedule(0.3, () => {
        if (u.dead || this.winner || !inst.def.cast) return;
        if (inst.def.cast(this, u, ctx) !== false) {
          this.events.push({ type: 'cast', unitId: u.id, abilityId: inst.def.id, kind: inst.def.kind, tags: inst.def.tags, color: inst.def.color, x: u.x, y: u.y });
        }
      });
    }
    return true;
  }

  // ------------------------------------------------------------------ deaths, xp, boons

  private kill(victim: Unit, src: Unit) {
    if (victim.dead) return;
    victim.dead = true;
    this.events.push({ type: 'die', unitId: victim.id, kind: victim.kind, team: victim.team, x: victim.x, y: victim.y, r: victim.radius });
    victim.hp = 0;
    victim.dash = undefined;
    const enemy = otherTeam(victim.team);

    let killer: Unit | undefined = src.kind === 'hero' && src.team !== victim.team ? src : undefined;
    if (!killer) {
      let latest = -1;
      for (const [id, at] of victim.damagedBy) {
        const h = this.unit(id);
        if (h && h.team !== victim.team && this.time - at < 10 && at > latest) {
          latest = at;
          killer = h;
        }
      }
    }

    const det = killer ? this.effect(killer, 'detonate') : 0;
    if (killer && det > 0) {
      const dmg = victim.stats.maxHp * Math.min(0.5, 0.15 * det);
      const k = killer;
      this.nova({ owner: k, x: victim.x, y: victim.y, radius: 200, delay: 0.05, color: '#ff7043', onHit: (e) => this.damage(k, e, dmg, 'spell') });
    }

    if (victim.kind === 'hero') {
      const vh = victim.hero!;
      vh.deaths++;
      vh.respawnAt = this.time + respawnTime(vh.level);
      victim.buffs = [];
      victim.shield = 0;
      victim.dots = [];
      victim.order = { kind: 'idle' };
      this.kills[enemy]++;
      if (killer?.hero) {
        killer.hero.kills++;
        this.gainXp(killer, KILL_XP(vh.level));
        if (killer.hero.kills % KILLS_PER_BOON === 0) this.offerBoon(killer);
      }
      for (const [id, at] of victim.damagedBy) {
        const a = this.unit(id);
        if (a?.hero && a !== killer && a.team !== victim.team && this.time - at < 10) {
          a.hero.assists++;
          this.gainXp(a, ASSIST_XP(vh.level));
          if (a.hero.assists % ASSISTS_PER_BOON === 0) this.offerBoon(a);
        }
      }
      const takedown = [killer, ...[...victim.damagedBy.keys()].map((id) => this.unit(id))].filter((a, i, arr): a is Unit => !!a?.hero && a.team !== victim.team && arr.indexOf(a) === i);
      for (const a of takedown) this.takedownEffects(a);
      // Shutting down a hero on a 3+ kill streak earns a Rare-or-better boon.
      if (this.announceKill(killer, victim) && killer) this.offerBoon(killer, 'rare');
      victim.damagedBy.clear();
      this.events.push({
        type: 'kill', killer: killer?.hero?.name ?? (src.kind === 'tower' ? 'Tower' : 'Minions'), killerTeam: enemy,
        victim: vh.name, victimTeam: victim.team, killerId: killer?.id, victimId: victim.id,
      });
    } else if (victim.kind === 'creep') {
      const near = this.heroList.filter((h) => !h.dead && h.team === enemy && len(h.x - victim.x, h.y - victim.y) < 1300);
      const share = near.length ? (victim.creep!.xp * (1 + 0.15 * (near.length - 1))) / near.length : 0;
      for (const h of near) this.gainXp(h, share);
    } else {
      this.events.push({ type: 'structure', team: victim.team, kind: victim.kind });
      for (const h of this.heroList) if (h.team === enemy) this.gainXp(h, 150);
      if (victim.kind === 'nexus') {
        this.winner = enemy;
        this.events.push({ type: 'end', winner: enemy });
      }
    }
  }

  private takedownEffects(a: Unit) {
    const ef = a.hero!.effects;
    if (ef.bloodrush) {
      for (const s of ['Q', 'W', 'E'] as Slot[]) {
        const inst = a.hero!.abilities[s];
        if (inst) inst.readyAt = Math.min(inst.readyAt, this.time);
      }
      const r = a.hero!.abilities.R;
      if (r && ef.bloodrush >= 1.8) r.readyAt = this.time + (r.readyAt - this.time) / 2;
    }
    if (ef.momentum) this.addBuff(a, { id: 'momentum', duration: 4, mul: { moveSpeed: 0.35 * ef.momentum, attackSpeed: 0.35 * ef.momentum } });
  }

  /** First blood, multi-kills, streaks and shutdowns. Returns true for a shutdown. */
  private announceKill(killer: Unit | undefined, victim: Unit): boolean {
    const vh = victim.hero!;
    const shutdown = vh.streak >= 3;
    vh.streak = 0;
    vh.multi = 0;
    if (!killer?.hero) return false;
    const kh = killer.hero;
    kh.streak++;
    kh.multi = this.time - kh.multiAt < 10 ? kh.multi + 1 : 1;
    kh.multiAt = this.time;
    const MULTI = ['', '', 'Double Kill', 'Triple Kill', 'Quadra Kill', 'Penta Kill'];
    const STREAK: Record<number, string> = { 3: 'Killing Spree', 5: 'Rampage', 7: 'Unstoppable', 9: 'Godlike' };
    let text = '';
    if (!this.firstBlood) {
      this.firstBlood = true;
      text = 'First Blood';
    } else if (kh.multi >= 2) text = MULTI[Math.min(5, kh.multi)];
    else if (shutdown) text = 'Shutdown';
    else if (STREAK[kh.streak]) text = STREAK[kh.streak];
    if (text) this.events.push({ type: 'announce', text, sub: kh.name, team: killer.team, unitId: killer.id });
    return shutdown;
  }

  gainXp(u: Unit, amount: number) {
    const h = u.hero!;
    if (h.level >= MAX_LEVEL) return;
    h.xp += amount;
    while (h.level < MAX_LEVEL && h.xp >= xpToNext(h.level)) {
      h.xp -= xpToNext(h.level);
      h.level++;
      const oldMax = u.stats.maxHp;
      this.recompute(u);
      if (!u.dead) u.hp += u.stats.maxHp - oldMax;
      this.events.push({ type: 'levelup', unitId: u.id, level: h.level });
      if (this.opts.boonEveryLevels > 0 && h.level % this.opts.boonEveryLevels === 0) this.offerBoon(u);
    }
    if (h.level >= MAX_LEVEL) h.xp = 0;
  }

  offerBoon(u: Unit, minRarity: Rarity = 'common') {
    const h = u.hero!;
    h.offers.push(rollBoonOffer(this.rng, 3, minRarity, h.boons));
    if (h.isPlayer || h.managed) this.events.push({ type: 'offer', unitId: u.id });
    else this.pickBoon(u, bestBoonIndex(h.offers[0]));
  }

  pickBoon(u: Unit, index: number) {
    const h = u.hero!;
    const offer = h.offers.shift();
    if (!offer) return;
    h.boons.push(offer[Math.max(0, Math.min(offer.length - 1, index))]);
    h.effects = {};
    for (const b of h.boons) if (b.def.effect) h.effects[b.def.effect] = (h.effects[b.def.effect] ?? 0) + RARITIES[b.rarity].mult;
    this.recompute(u);
  }

  // ------------------------------------------------------------------ stats

  recompute(u: Unit) {
    const s = this.computeStats(u);
    const h = u.hero;
    const oldMax = u.stats.maxHp;
    u.stats = s;
    if (s.maxHp > oldMax && !u.dead && oldMax > 0) u.hp += s.maxHp - oldMax;
    u.hp = Math.min(u.hp, s.maxHp);
    if (h) u.radius = 24 * (1 + s.size);
  }

  /** What a unit's stats would be with optional extra boons (used for boon card previews). */
  computeStats(u: Unit, extraBoons: BoonInst[] = []): Stats {
    const base = u.hero ? heroBaseStats(u.hero.def, u.hero.level) : u.baseStats;
    const add = emptyStats();
    const mul = emptyStats();
    const apply = (m: Mods | null | undefined) => {
      if (!m) return;
      if (m.add) for (const k in m.add) add[k as keyof Stats] += m.add[k as keyof Stats] ?? 0;
      if (m.mul) for (const k in m.mul) mul[k as keyof Stats] += m.mul[k as keyof Stats] ?? 0;
    };
    const h = u.hero;
    if (h) {
      const p = h.abilities.P;
      if (p) {
        const m = RARITIES[p.rarity].mult;
        apply(p.def.mods?.(m));
        apply(p.def.dynamicMods?.(u, m));
      }
      for (const b of [...h.boons, ...extraBoons]) apply(b.def.mods?.(RARITIES[b.rarity].mult));
    }
    for (const b of u.buffs) apply(b);
    const s = emptyStats();
    for (const k of STAT_KEYS) s[k] = (base[k] + add[k]) * (1 + mul[k]);
    s.cdr = Math.min(0.6, s.cdr);
    s.damageReduction = Math.min(0.55, s.damageReduction);
    s.critChance = Math.min(1, s.critChance);
    s.moveSpeed = Math.min(650, s.moveSpeed);
    s.recoup = Math.min(0.8, s.recoup);
    s.regenPct = Math.min(0.15, s.regenPct);
    return s;
  }

  /**
   * Plain-language "before → after" lines for a boon card. Stat boons list every stat that
   * changes (and flag caps); effect boons say how the copy stacks with what you already own.
   */
  previewBoon(u: Unit, b: BoonInst): string[] {
    const h = u.hero!;
    if (b.def.kind === 'effect' && b.def.effect) {
      const have = h.effects[b.def.effect] ?? 0;
      const total = have + RARITIES[b.rarity].mult;
      const lines = [have > 0 ? `Stacks with your copy: ×${have.toFixed(1)} → ×${total.toFixed(1)} power` : 'New effect'];
      if (have > 0) lines.push(`After: ${b.def.desc(total)}`);
      const cap = EFFECT_CAPS[b.def.effect];
      if (cap) {
        const [per, max] = cap;
        if (per * have >= max) lines.push('Already at its maximum: this copy adds nothing');
        else if (per * total >= max) lines.push('Reaches its maximum with this copy');
      }
      if (b.def.effect === 'secondWind' && have > 0) lines.push('Still once per life; only the untouchable time grows');
      if (b.def.effect === 'split' && have > 0 && have < 1.8 && total >= 1.8) lines.push('Upgrades to 4 extra projectiles');
      return lines;
    }
    const before = u.stats;
    const after = this.computeStats(u, [b]);
    return STAT_PREVIEW.flatMap(([k, label, fmt, cap]) => {
      if (Math.abs(after[k] - before[k]) < 1e-6) return [];
      const capped = cap !== undefined && after[k] >= cap - 1e-6;
      return [`${label}: ${fmt(before[k])} → ${fmt(after[k])}${capped ? ' (max)' : ''}`];
    });
  }

  // ------------------------------------------------------------------ main loop

  update(dt: number) {
    if (this.winner) return;
    this.time += dt;
    const t = this.time;

    const due = this.scheduled.filter((s) => s.at <= t);
    this.scheduled = this.scheduled.filter((s) => s.at > t);
    for (const s of due) s.fn();

    if (t >= this.nextWave) {
      this.spawnWave();
      this.nextWave += WAVE_INTERVAL;
    }

    for (const h of this.heroList) {
      if (h.dead && t >= h.hero!.respawnAt) this.respawn(h);
      if (h.hero!.level < MAX_LEVEL) this.gainXp(h, 2 * dt);
    }

    for (const u of this.units) {
      if (u.dead) continue;
      if (u.shieldUntil <= t) u.shield = 0;
      if (u.buffs.length) u.buffs = u.buffs.filter((b) => b.until > t);
      if (u.hero || u.buffs.length) this.recompute(u);
      if (u.hp < u.stats.maxHp && u.stats.hpRegen > 0) u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.hpRegen * dt);
      if (u.hp < u.stats.maxHp && u.stats.regenPct > 0) u.hp = Math.min(u.stats.maxHp, u.hp + u.stats.maxHp * u.stats.regenPct * dt);
      if (u.recoupPool > 0.5) {
        // Recoup pays back damage taken over roughly two seconds.
        const back = u.recoupPool * Math.min(1, dt * 1.5);
        u.recoupPool -= back;
        this.heal(u, back, true);
      }
      if (u.dots.length && t >= u.nextDot) {
        u.nextDot = t + 0.5;
        u.dots = u.dots.filter((d) => d.until > t);
        for (const d of u.dots) if (!u.dead) this.damage(d.src, u, d.dps * 0.5, 'spell');
        if (u.dead) continue;
      }
      if (u.hero?.effects.static && t >= u.hero.nextStatic) {
        u.hero.nextStatic = t + 2;
        const target = this.nearestEnemyTo(u.team, u, 450, u);
        if (target) {
          this.fx({ kind: 'line', x: u.x, y: u.y, x2: target.x, y2: target.y, r: 0, color: '#fff59d', duration: 0.2, width: 3 });
          this.damage(u, target, 30 * u.hero.effects.static * levelScale(u.hero.level), 'spell');
        }
      }
      if (u.hero) {
        const p = u.hero.abilities.P;
        p?.def.onTick?.(this, u, dt, RARITIES[p.rarity].mult);
        const own = FOUNTAIN[u.team];
        const foe = FOUNTAIN[otherTeam(u.team)];
        if (len(u.x - own.x, u.y - own.y) < FOUNTAIN_RADIUS) this.heal(u, u.stats.maxHp * 0.15 * dt, true);
        if (len(u.x - foe.x, u.y - foe.y) < FOUNTAIN_RADIUS) this.damage(this.fountainUnit(otherTeam(u.team)), u, 900 * dt, 'true');
      }
    }

    this.updateRune();

    for (const u of this.units) {
      if (u.dead) continue;
      if (u.hero && !u.hero.isPlayer) thinkHero(this, u);
      else if (u.creep) thinkCreep(this, u);
    }

    for (const u of this.units) if (!u.dead) this.act(u, dt);
    this.separate();
    this.updateProjectiles(dt);
    this.updateZones();
    this.updateNovas();

    if (this.units.some((u) => u.dead && !u.hero)) {
      this.units = this.units.filter((u) => !u.dead || u.hero);
      for (const [id, u] of this.byId) if (u.dead && !u.hero) this.byId.delete(id);
    }
    this.fxList = this.fxList.filter((f) => f.until > t);
  }

  private fountainUnits: Partial<Record<Team, Unit>> = {};
  /** The nexus of a team acts as the damage source for its fountain. */
  private fountainUnit(team: Team): Unit {
    const cached = this.fountainUnits[team];
    if (cached) return cached;
    const nexus = this.units.find((u) => u.kind === 'nexus' && u.team === team)!;
    this.fountainUnits[team] = nexus;
    return nexus;
  }

  private updateRune() {
    const r = this.rune;
    if (!r.active) {
      if (this.time >= r.nextAt) {
        r.active = true;
        this.events.push({ type: 'runeSpawn', x: r.x, y: r.y });
      }
      return;
    }
    const taker = this.heroList.find((h) => !h.dead && len(h.x - r.x, h.y - r.y) < RUNE_RADIUS + h.radius);
    if (!taker) return;
    r.active = false;
    r.nextAt = this.time + RUNE_INTERVAL;
    const h = taker.hero!;
    this.heal(taker, taker.stats.maxHp * 0.3);
    this.addBuff(taker, { id: 'rune', duration: 3, mul: { moveSpeed: 0.3 } });
    this.events.push({ type: 'rune', unitId: taker.id, x: r.x, y: r.y });
    h.offers.push(rollBoonOffer(this.rng, 3, 'rare', h.boons));
    if (h.isPlayer || h.managed) this.events.push({ type: 'offer', unitId: taker.id });
    else this.pickBoon(taker, bestBoonIndex(h.offers[0]));
  }

  private respawn(u: Unit) {
    const f = FOUNTAIN[u.team];
    u.dead = false;
    u.x = f.x + laneDir(u.team) * 60;
    u.y = f.y + this.rng.range(-100, 100);
    u.stunUntil = 0;
    u.slowUntil = 0;
    u.stealthUntil = 0;
    u.invulnUntil = 0;
    u.order = { kind: 'idle' };
    u.hero!.retreating = false;
    u.hero!.secondWindUsed = false;
    u.dots = [];
    u.recoupPool = 0;
    this.recompute(u);
    u.hp = u.stats.maxHp;
  }

  private spawnWave() {
    this.waveCount++;
    const minutes = this.time / 60;
    // Creeps scale up over time; past 18 minutes they ramp hard so games always end.
    // MINION_POWER: minions are 15% stronger (health and damage) than the v3 baseline.
    const scale = MINION_POWER * (1 + 0.07 * minutes + Math.max(0, minutes - 14) * 0.25);
    for (const team of ['blue', 'red'] as Team[]) {
      const x = mirrorX(team, STRUCTURE_X.nexus + 120);
      for (let i = 0; i < 6; i++) {
        const ranged = i >= 3;
        const hp = scale * MINION_HP;
        const base: Stats = ranged
          ? { ...emptyStats(), maxHp: 300 * hp, ad: 24 * scale, attackRange: 330, attackSpeed: 0.7, moveSpeed: 235 }
          : { ...emptyStats(), maxHp: 440 * hp, ad: 15 * scale, attackRange: 45, attackSpeed: 0.8, moveSpeed: 235 };
        const laneY = LANE_Y + (i % 3 - 1) * 70;
        const c = this.makeUnit('creep', team, x - laneDir(team) * (ranged ? 90 : 0), laneY, ranged ? 15 : 17, base);
        c.creep = { ranged, xp: ranged ? 45 : 55, nextThink: 0, laneY };
      }
    }
  }

  private moveToward(u: Unit, x: number, y: number, dt: number) {
    const dx = x - u.x;
    const dy = y - u.y;
    const d = len(dx, dy);
    if (d < 2) return true;
    const speed = u.stats.moveSpeed * (u.slowUntil > this.time ? 1 - u.slowPct : 1);
    const step = Math.min(d, speed * dt);
    const dir = this.steer(u, dx / d, dy / d, x, y);
    u.facing = dir;
    this.moveUnit(u, u.x + dir.x * step, u.y + dir.y * step);
    return step >= d;
  }

  /**
   * Obstacle avoidance: if a tower or nexus sits on the path ahead, bend the direction
   * sideways so units walk around it instead of pushing into it forever.
   */
  private steer(u: Unit, dirx: number, diry: number, goalX: number, goalY: number): Vec {
    for (const s of this.units) {
      if (s.dead || (s.kind !== 'tower' && s.kind !== 'nexus')) continue;
      // Walking up to attack this structure: no need to go around it.
      if (len(goalX - s.x, goalY - s.y) < s.radius + 10) continue;
      const rx = s.x - u.x;
      const ry = s.y - u.y;
      const ahead = rx * dirx + ry * diry;
      if (ahead <= 0 || ahead > s.radius + u.radius + 120) continue;
      // Sideways offset of the obstacle from our path (n is the left-hand normal).
      const nx = -diry;
      const ny = dirx;
      const offset = rx * nx + ry * ny;
      const clear = s.radius + u.radius + 10;
      if (Math.abs(offset) >= clear) continue;
      const side = offset >= 0 ? -1 : 1;
      const k = (1.4 * (clear - Math.abs(offset))) / clear;
      dirx += nx * side * k;
      diry += ny * side * k;
      const l = len(dirx, diry) || 1;
      dirx /= l;
      diry /= l;
    }
    return { x: dirx, y: diry };
  }

  private act(u: Unit, dt: number) {
    const t = this.time;
    u.attackCd -= dt;
    if (u.kind === 'nexus') return;
    if (u.kind === 'tower') return this.towerAct(u);
    if (u.stunUntil > t || u.invulnUntil > t) return;

    if (u.dash) {
      const d = u.dash;
      this.moveUnit(u, u.x + d.vx * dt, u.y + d.vy * dt);
      if (d.damage > 0 || d.stun > 0) {
        for (const e of this.enemiesNear(u.team, u.x, u.y, d.radius + u.radius)) {
          if (d.hit.has(e.id)) continue;
          d.hit.add(e.id);
          if (d.damage) this.damage(u, e, d.damage, 'spell');
          if (d.stun) this.stun(e, d.stun);
        }
      }
      if (t >= d.until) {
        u.dash = undefined;
        d.onEnd?.();
      }
      return;
    }

    const h = u.hero;
    if (h?.moveDir) {
      this.moveToward(u, u.x + h.moveDir.x * 100, u.y + h.moveDir.y * 100, dt);
      return;
    }

    const o = u.order;
    if (o.kind === 'move') {
      if (this.moveToward(u, o.x, o.y, dt)) u.order = { kind: 'idle' };
      return;
    }
    if (o.kind === 'attack') {
      const target = this.unit(o.id);
      if (!target || !this.attackable(u, target)) {
        u.order = { kind: 'idle' };
        return;
      }
      if (this.inAttackRange(u, target)) {
        if (u.attackCd <= 0) this.performAttack(u, target);
      } else {
        this.moveToward(u, target.x, target.y, dt);
      }
      return;
    }
    // Idle player heroes auto-attack whatever is in range, preferring heroes.
    if (h?.isPlayer && u.attackCd <= 0) {
      let best: Unit | undefined;
      let bestScore = Infinity;
      for (const e of this.units) {
        if (!this.attackable(u, e) || !this.inAttackRange(u, e)) continue;
        const score = len(e.x - u.x, e.y - u.y) - (e.kind === 'hero' ? 200 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = e;
        }
      }
      if (best) this.performAttack(u, best);
    }
  }

  private towerAct(u: Unit) {
    if (u.attackCd > 0) return;
    const range = u.stats.attackRange;
    const inRange = this.units.filter((e) => this.attackable(u, e) && e.kind !== 'tower' && e.kind !== 'nexus' && len(e.x - u.x, e.y - u.y) <= range + e.radius);
    if (!inRange.length) {
      u.structure!.consecutive = 0;
      return;
    }
    const aggressor = inRange.find((e) => e.kind === 'hero' && this.time - e.lastHitHeroAt < 2);
    const current = inRange.find((e) => e.id === u.structure!.targetId);
    const byDist = (a: Unit, b: Unit) => len(a.x - u.x, a.y - u.y) - len(b.x - u.x, b.y - u.y);
    const creep = inRange.filter((e) => e.kind === 'creep').sort(byDist)[0];
    const target = aggressor ?? current ?? creep ?? inRange.sort(byDist)[0];
    this.performAttack(u, target);
  }

  private separate() {
    const mobile = this.units.filter((u) => !u.dead && (u.kind === 'hero' || u.kind === 'creep') && !u.dash);
    const statics = this.units.filter((u) => !u.dead && (u.kind === 'tower' || u.kind === 'nexus'));
    for (let i = 0; i < mobile.length; i++) {
      const a = mobile[i];
      for (let j = i + 1; j < mobile.length; j++) {
        const b = mobile[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = (a.radius + b.radius) * 0.85;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) / 2;
        const nx = d2 ? dx / d : 1;
        const ny = d2 ? dy / d : 0;
        this.moveUnit(a, a.x - nx * push, a.y - ny * push);
        this.moveUnit(b, b.x + nx * push, b.y + ny * push);
      }
      for (const s of statics) {
        const dx = a.x - s.x;
        const dy = a.y - s.y;
        const min = a.radius + s.radius;
        const d = len(dx, dy);
        if (d >= min) continue;
        const nx = d ? dx / d : 0;
        const ny = d ? dy / d : 1;
        this.moveUnit(a, s.x + nx * min, s.y + ny * min);
      }
    }
  }

  private updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const p of this.projectiles) {
      if (p.targetId !== undefined) {
        const t = this.unit(p.targetId);
        if (!t || t.dead) continue;
        const dx = t.x - p.x;
        const dy = t.y - p.y;
        const d = len(dx, dy);
        const step = p.speed * dt;
        if (d <= step + t.radius) {
          this.dmgScale = p.scale ?? 1;
          p.onHit(t);
          this.dmgScale = 1;
          continue;
        }
        p.vx = (dx / d) * p.speed;
        p.vy = (dy / d) * p.speed;
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
        keep.push(p);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.traveled += p.speed * dt;
      let alive = true;
      for (const e of this.enemiesNear(p.team, p.x, p.y, p.radius)) {
        if (p.hit.has(e.id)) continue;
        p.hit.add(e.id);
        this.dmgScale = p.scale ?? 1;
        p.onHit(e);
        this.dmgScale = 1;
        if (!p.pierce) {
          alive = false;
          break;
        }
      }
      if (alive && p.traveled < p.range && p.y > 40 && p.y < 1060) keep.push(p);
    }
    this.projectiles = keep;
  }

  private updateZones() {
    const t = this.time;
    this.zones = this.zones.filter((z) => z.until > t && !(z.follow && z.owner.dead));
    for (const z of this.zones) {
      if (z.follow) {
        z.x = z.owner.x;
        z.y = z.owner.y;
      }
      if (t < z.nextTick) continue;
      z.nextTick = t + 0.25;
      for (const e of this.enemiesNear(z.team, z.x, z.y, z.radius)) {
        if (z.dps) this.damage(z.owner, e, z.dps * 0.25, 'spell');
        if (z.slowPct) this.slow(e, z.slowPct, 0.4);
        if (z.pull && !e.dead) {
          const dx = z.x - e.x;
          const dy = z.y - e.y;
          const d = len(dx, dy);
          if (d > 20) this.moveUnit(e, e.x + (dx / d) * Math.min(d, z.pull * 0.25), e.y + (dy / d) * Math.min(d, z.pull * 0.25));
        }
      }
    }
  }

  private updateNovas() {
    const t = this.time;
    const due = this.novas.filter((n) => n.at <= t);
    this.novas = this.novas.filter((n) => n.at > t);
    for (const n of due) {
      this.fx({ kind: 'burst', x: n.x, y: n.y, r: n.radius, color: n.color, duration: 0.35 });
      this.events.push({ type: 'boom', x: n.x, y: n.y, r: n.radius, color: n.color });
      for (const e of this.enemiesNear(n.team, n.x, n.y, n.radius)) n.onHit(e);
    }
  }
}
