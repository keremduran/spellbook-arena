import type { Rng } from './rng';
import { RARITIES, RARITY_ORDER, type BoonInst, type Mods, type Rarity } from './types';

/**
 * Effect boons change how a hero fights (Hades style). Their strength is the summed rarity
 * multiplier of every copy the hero owns, read by the world through `effectPower`.
 */
export type EffectId =
  | 'burn' | 'frost' | 'ricochet' | 'cleave' | 'thunder'
  | 'echo' | 'split' | 'overcharge' | 'afterimage' | 'static'
  | 'bloodrush' | 'detonate' | 'momentum' | 'secondWind' | 'bulwarkCast';

export interface BoonDef {
  id: string;
  name: string;
  icon: string;
  /** 'effect' boons change behaviour; 'stat' boons are plain numbers. */
  kind: 'stat' | 'effect';
  /** A few words for the card. */
  short: (m: number) => string;
  desc: (m: number) => string;
  mods?: (m: number) => Mods;
  effect?: EffectId;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => Math.round(x);

export const STAT_BOONS: BoonDef[] = [
  { id: 'swift', name: 'Swift Strikes', icon: '⚡', kind: 'stat', short: (m) => `+${pct(0.12 * m)} atk speed`, desc: (m) => `+${pct(0.12 * m)} attack speed`, mods: (m) => ({ mul: { attackSpeed: 0.12 * m } }) },
  { id: 'fleet', name: 'Fleet of Foot', icon: '👟', kind: 'stat', short: (m) => `+${pct(0.07 * m)} speed`, desc: (m) => `+${pct(0.07 * m)} move speed`, mods: (m) => ({ mul: { moveSpeed: 0.07 * m } }) },
  { id: 'vitality', name: 'Vitality', icon: '❤️', kind: 'stat', short: (m) => `+${pct(0.11 * m)} health`, desc: (m) => `+${pct(0.11 * m)} max health`, mods: (m) => ({ mul: { maxHp: 0.11 * m } }) },
  { id: 'might', name: 'Might', icon: '💪', kind: 'stat', short: (m) => `+${pct(0.1 * m)} attack`, desc: (m) => `+${pct(0.1 * m)} attack damage`, mods: (m) => ({ mul: { ad: 0.1 * m } }) },
  { id: 'arcana', name: 'Arcana', icon: '🔮', kind: 'stat', short: (m) => `+${pct(0.12 * m)} spell power`, desc: (m) => `+${pct(0.12 * m)} spell power`, mods: (m) => ({ mul: { spellPower: 0.12 * m } }) },
  { id: 'haste', name: 'Haste', icon: '⏱️', kind: 'stat', short: (m) => `−${pct(0.06 * m)} cooldowns`, desc: (m) => `+${pct(0.06 * m)} cooldown reduction`, mods: (m) => ({ add: { cdr: 0.06 * m } }) },
  { id: 'vampirism', name: 'Vampirism', icon: '🩸', kind: 'stat', short: (m) => `+${pct(0.05 * m)} lifesteal`, desc: (m) => `+${pct(0.05 * m)} lifesteal`, mods: (m) => ({ add: { lifesteal: 0.05 * m } }) },
  { id: 'spell_thirst', name: 'Spell Thirst', icon: '🍷', kind: 'stat', short: (m) => `spells heal ${pct(0.08 * m)}`, desc: (m) => `Abilities heal you for ${pct(0.08 * m)} of their damage`, mods: (m) => ({ add: { spellVamp: 0.08 * m } }) },
  { id: 'precision', name: 'Precision', icon: '🎯', kind: 'stat', short: (m) => `+${pct(0.08 * m)} crit`, desc: (m) => `+${pct(0.08 * m)} critical strike chance`, mods: (m) => ({ add: { critChance: 0.08 * m } }) },
  { id: 'stoneheart', name: 'Stoneheart', icon: '💎', kind: 'stat', short: (m) => `${(0.45 * m).toFixed(2)}% hp/s`, desc: (m) => `Regenerate ${(0.45 * m).toFixed(2)}% of max health per second`, mods: (m) => ({ add: { regenPct: 0.0045 * m } }) },
  { id: 'grit', name: 'Grit', icon: '🪨', kind: 'stat', short: (m) => `heal back ${pct(0.075 * m)}`, desc: (m) => `Heal back ${pct(0.075 * m)} of damage taken`, mods: (m) => ({ add: { recoup: 0.075 * m } }) },
  { id: 'bulwark', name: 'Bulwark', icon: '🛡️', kind: 'stat', short: (m) => `−${pct(0.055 * m)} dmg taken`, desc: (m) => `Take ${pct(0.055 * m)} less damage`, mods: (m) => ({ add: { damageReduction: 0.055 * m } }) },
];

export const EFFECT_BOONS: BoonDef[] = [
  { id: 'burn', effect: 'burn', name: 'Burning Blade', icon: '🔥', kind: 'effect', short: (m) => `hits burn ${n(18 * m)}/s`, desc: (m) => `Attacks burn enemies for ${n(18 * m)} damage per second over 3s.` },
  { id: 'frost', effect: 'frost', name: 'Frostbite', icon: '🧊', kind: 'effect', short: (m) => `hits slow ${pct(Math.min(0.45, 0.22 * m))}`, desc: (m) => `Attacks chill, slowing by ${pct(Math.min(0.45, 0.22 * m))} for 1.2s.` },
  { id: 'ricochet', effect: 'ricochet', name: 'Ricochet', icon: '🪃', kind: 'effect', short: (m) => `hits bounce`, desc: (m) => `Attacks bounce to ${Math.max(1, Math.round(m))} more enemy for ${pct(Math.min(0.9, 0.45 * m))} damage.` },
  { id: 'cleave', effect: 'cleave', name: 'Cleave', icon: '🌙', kind: 'effect', short: (m) => `hits splash ${pct(Math.min(1, 0.4 * m))}`, desc: (m) => `Attacks also hit enemies around the target for ${pct(Math.min(1, 0.4 * m))} damage.` },
  { id: 'thunder', effect: 'thunder', name: 'Thunderstep', icon: '🌩️', kind: 'effect', short: (m) => `lightning every ${(4 / Math.sqrt(m)).toFixed(1)}s`, desc: (m) => `Every ${(4 / Math.sqrt(m)).toFixed(1)}s your next attack calls down lightning on the target area for ${n(70 * m)} damage.` },
  { id: 'echo', effect: 'echo', name: 'Echo', icon: '🔁', kind: 'effect', short: (m) => `${pct(Math.min(0.6, 0.3 * m))} double cast`, desc: (m) => `Basic abilities have a ${pct(Math.min(1, 0.3 * m))} chance to cast a second time (max 60%).` },
  { id: 'split', effect: 'split', name: 'Split Shot', icon: '🎆', kind: 'effect', short: (m) => `+${m >= 1.8 ? 4 : 2} projectiles`, desc: (m) => `Ability projectiles fire ${m >= 1.8 ? 4 : 2} extra copies at 50% damage in a spread.` },
  { id: 'overcharge', effect: 'overcharge', name: 'Overcharge', icon: '🔋', kind: 'effect', short: (m) => `ult −${pct(Math.min(0.6, 0.3 * m))} cooldown`, desc: (m) => `Your ultimate's cooldown is ${pct(Math.min(0.6, 0.3 * m))} shorter.` },
  { id: 'afterimage', effect: 'afterimage', name: 'Afterimage', icon: '👥', kind: 'effect', short: (m) => `dashes explode`, desc: (m) => `Dashes and blinks leave an explosion behind for ${n(80 * m)} damage.` },
  { id: 'static', effect: 'static', name: 'Static Field', icon: '⚡', kind: 'effect', short: (m) => `zap ${n(30 * m)} every 2s`, desc: (m) => `Every 2s, zap the nearest enemy for ${n(30 * m)} damage.` },
  { id: 'bloodrush', effect: 'bloodrush', name: 'Bloodrush', icon: '🩸', kind: 'effect', short: (m) => `takedowns reset spells`, desc: (m) => `Hero kills and assists refresh your basic abilities${m >= 1.8 ? ' and half your ultimate' : ''}.` },
  { id: 'detonate', effect: 'detonate', name: 'Detonate', icon: '💣', kind: 'effect', short: (m) => `kills explode`, desc: (m) => `Enemies you kill explode for ${pct(Math.min(0.5, 0.15 * m))} of their max health to nearby enemies.` },
  { id: 'momentum', effect: 'momentum', name: 'Momentum', icon: '🌪️', kind: 'effect', short: (m) => `takedowns: rush`, desc: (m) => `Takedowns give ${pct(0.35 * m)} move speed and attack speed for 4s.` },
  { id: 'secondWind', effect: 'secondWind', name: 'Second Wind', icon: '🪽', kind: 'effect', short: (m) => `cheat death once`, desc: (m) => `Once per life, survive a killing blow and become untouchable for ${(1 + 0.5 * m).toFixed(1)}s.` },
  { id: 'bulwarkCast', effect: 'bulwarkCast', name: 'Spellshield', icon: '🔰', kind: 'effect', short: (m) => `casts shield ${n(55 * m)}`, desc: (m) => `Casting an ability shields you for ${n(55 * m)} for 2.5s (once every 1.5s).` },
];

export const BOONS: BoonDef[] = [...STAT_BOONS, ...EFFECT_BOONS];

/** Defensive stat boons, offered more often so tank builds come together. */
const TANK_BOONS = new Set(['vitality', 'bulwark', 'stoneheart', 'grit']);

export const rollRarity = (rng: Rng, minRarity: Rarity = 'common'): Rarity => {
  const allowed = RARITY_ORDER.slice(RARITY_ORDER.indexOf(minRarity));
  return rng.weighted(allowed, (r) => RARITIES[r].weight);
};

/**
 * Three options. At least one is an effect boon so every choice can change how you play,
 * and effects you already own are more likely to show up again (they stack).
 */
export const rollBoonOffer = (rng: Rng, count = 3, minRarity: Rarity = 'common', owned: BoonInst[] = []): BoonInst[] => {
  const ownedEffects = new Set(owned.filter((b) => b.def.kind === 'effect').map((b) => b.def.id));
  const pickEffect = () => rng.weighted(EFFECT_BOONS, (b) => (ownedEffects.has(b.id) ? 2.5 : 1));
  const chosen: BoonDef[] = [pickEffect()];
  while (chosen.length < count) {
    const pool = rng.next() < 0.55 ? EFFECT_BOONS : STAT_BOONS;
    const b = pool === EFFECT_BOONS ? pickEffect() : rng.weighted(STAT_BOONS, (x) => (TANK_BOONS.has(x.id) ? 1.3 : 1));
    if (!chosen.includes(b)) chosen.push(b);
  }
  return rng.sample(chosen, chosen.length).map((def) => ({ def, rarity: rollRarity(rng, minRarity) }));
};

/** Bots take the highest rarity option, preferring effect boons on ties. */
export const bestBoonIndex = (offer: BoonInst[]) => {
  let best = 0;
  const score = (b: BoonInst) => RARITY_ORDER.indexOf(b.rarity) * 2 + (b.def.kind === 'effect' ? 1 : 0);
  offer.forEach((b, i) => {
    if (score(b) > score(offer[best])) best = i;
  });
  return best;
};
