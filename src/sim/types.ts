import type { AbilityDef } from './abilities';
import type { BoonDef, EffectId } from './boons';
import type { HeroDef } from './heroes';

export type Team = 'blue' | 'red';
export const otherTeam = (t: Team): Team => (t === 'blue' ? 'red' : 'blue');

export type Slot = 'P' | 'Q' | 'W' | 'E' | 'R';
export const SLOTS: Slot[] = ['P', 'Q', 'W', 'E', 'R'];
export const ACTIVE_SLOTS: Slot[] = ['Q', 'W', 'E', 'R'];

export interface Vec {
  x: number;
  y: number;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const RARITIES: Record<Rarity, { mult: number; weight: number; color: string; label: string }> = {
  common: { mult: 1, weight: 60, color: '#b0bec5', label: 'Common' },
  rare: { mult: 1.4, weight: 25, color: '#4fc3f7', label: 'Rare' },
  epic: { mult: 1.85, weight: 12, color: '#ce93d8', label: 'Epic' },
  legendary: { mult: 2.5, weight: 3, color: '#ffca28', label: 'Legendary' },
};

export interface Stats {
  maxHp: number;
  hpRegen: number;
  ad: number;
  attackRange: number;
  attackSpeed: number;
  moveSpeed: number;
  spellPower: number;
  cdr: number;
  lifesteal: number;
  spellVamp: number;
  critChance: number;
  damageReduction: number;
  onHitDamage: number;
  thorns: number;
  execute: number;
  size: number;
  /** Max health regenerated per second, as a fraction (0.01 = 1%/s). */
  regenPct: number;
  /** Fraction of damage taken that is healed back over the next ~2s. */
  recoup: number;
}

export const STAT_KEYS = [
  'maxHp', 'hpRegen', 'ad', 'attackRange', 'attackSpeed', 'moveSpeed', 'spellPower', 'cdr',
  'lifesteal', 'spellVamp', 'critChance', 'damageReduction', 'onHitDamage', 'thorns', 'execute', 'size', 'regenPct', 'recoup',
] as const satisfies readonly (keyof Stats)[];

export const emptyStats = (): Stats => ({
  maxHp: 0, hpRegen: 0, ad: 0, attackRange: 0, attackSpeed: 0, moveSpeed: 0, spellPower: 0, cdr: 0,
  lifesteal: 0, spellVamp: 0, critChance: 0, damageReduction: 0, onHitDamage: 0, thorns: 0, execute: 0, size: 0,
  regenPct: 0, recoup: 0,
});

/** Flat additions are applied first, then `mul` as summed percentages: (base + add) * (1 + mul). */
export interface Mods {
  add?: Partial<Stats>;
  mul?: Partial<Stats>;
}

export interface Buff extends Mods {
  id: string;
  until: number;
}

export interface AbilityInst {
  def: AbilityDef;
  rarity: Rarity;
  readyAt: number;
}

export interface BoonInst {
  def: BoonDef;
  rarity: Rarity;
}

/** Orders the bot manager can give a bot. */
export type Directive = 'auto' | 'push' | 'farm' | 'group' | 'retreat';
export const DIRECTIVES: Directive[] = ['auto', 'push', 'farm', 'group', 'retreat'];

export type Order = { kind: 'idle' } | { kind: 'move'; x: number; y: number } | { kind: 'attack'; id: number };

export interface HeroState {
  def: HeroDef;
  name: string;
  isPlayer: boolean;
  /** Boon choices wait for the user instead of being auto-picked. */
  managed: boolean;
  directive: Directive;
  /** Enemy hero this bot was told to focus. */
  focusId?: number;
  level: number;
  xp: number;
  kills: number;
  deaths: number;
  assists: number;
  respawnAt: number;
  abilities: Partial<Record<Slot, AbilityInst>>;
  boons: BoonInst[];
  /** Queue of pending boon choices (3 options each). */
  offers: BoonInst[][];
  attackCount: number;
  lastCombatAt: number;
  /** Summed rarity multiplier per effect boon owned. */
  effects: Partial<Record<EffectId, number>>;
  secondWindUsed: boolean;
  nextThunder: number;
  nextStatic: number;
  /** Kills since last death, and multi-kill tracking. */
  streak: number;
  multi: number;
  multiAt: number;
  /** Joystick direction for touch controls; overrides orders while set. */
  moveDir: Vec | null;
  retreating: boolean;
  nextThink: number;
  laneOffset: number;
}

export type UnitKind = 'hero' | 'creep' | 'tower' | 'nexus';

export interface Dash {
  vx: number;
  vy: number;
  until: number;
  hit: Set<number>;
  damage: number;
  radius: number;
  stun: number;
  onEnd?: () => void;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  team: Team;
  x: number;
  y: number;
  radius: number;
  hp: number;
  stats: Stats;
  baseStats: Stats;
  dead: boolean;
  attackCd: number;
  facing: Vec;
  order: Order;
  stunUntil: number;
  slowUntil: number;
  slowPct: number;
  stealthUntil: number;
  invulnUntil: number;
  shield: number;
  shieldUntil: number;
  buffs: Buff[];
  /** hero id -> last time that hero damaged this unit (kill credit / assists). */
  damagedBy: Map<number, number>;
  /** Last time this unit hit an enemy hero (tower aggro). */
  lastHitHeroAt: number;
  dash?: Dash;
  /** Pending recoup healing (from the recoup stat). */
  recoupPool: number;
  /** Damage over time (Burning Blade). */
  dots: { src: Unit; dps: number; until: number }[];
  nextDot: number;
  hero?: HeroState;
  creep?: { ranged: boolean; xp: number; nextThink: number; laneY: number };
  structure?: { protectedBy?: number; consecutive: number; targetId?: number };
}

export interface Projectile {
  id: number;
  owner: Unit;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  radius: number;
  range: number;
  traveled: number;
  color: string;
  pierce: boolean;
  hit: Set<number>;
  onHit: (t: Unit) => void;
  /** Homing projectile (auto attacks). */
  targetId?: number;
}

export interface Zone {
  owner: Unit;
  team: Team;
  x: number;
  y: number;
  radius: number;
  until: number;
  dps: number;
  slowPct: number;
  pull: number;
  color: string;
  follow: boolean;
  nextTick: number;
}

export interface Nova {
  owner: Unit;
  team: Team;
  x: number;
  y: number;
  radius: number;
  start: number;
  at: number;
  color: string;
  onHit: (t: Unit) => void;
}

export interface Fx {
  kind: 'ring' | 'line' | 'burst';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  r: number;
  color: string;
  start: number;
  until: number;
  width?: number;
}

export type GameEvent =
  | { type: 'damage'; x: number; y: number; amount: number; crit: boolean; srcId: number; tgtId: number; heal?: boolean }
  | { type: 'kill'; killer?: string; killerTeam?: Team; victim: string; victimTeam: Team; killerId?: number; victimId: number }
  | { type: 'levelup'; unitId: number; level: number }
  | { type: 'offer'; unitId: number }
  | { type: 'structure'; team: Team; kind: UnitKind }
  | { type: 'end'; winner: Team }
  /** Presentation-only events (sound and particles). */
  | { type: 'cast'; unitId: number; abilityId: string; kind: 'basic' | 'ult' | 'passive'; tags: string[]; color: string; x: number; y: number }
  | { type: 'attack'; unitId: number; x: number; y: number; tx: number; ty: number; ranged: boolean; tower: boolean }
  | { type: 'die'; unitId: number; kind: UnitKind; team: Team; x: number; y: number; r: number }
  | { type: 'boom'; x: number; y: number; r: number; color: string }
  | { type: 'rune'; unitId: number; x: number; y: number }
  | { type: 'runeSpawn'; x: number; y: number }
  | { type: 'announce'; text: string; sub: string; team: Team; unitId: number };
