import type { Rng } from './rng';
import { RARITIES, RARITY_ORDER, type BoonInst, type Mods, type Rarity } from './types';

export interface BoonDef {
  id: string;
  name: string;
  icon: string;
  desc: (m: number) => string;
  mods: (m: number) => Mods;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export const BOONS: BoonDef[] = [
  { id: 'swift', name: 'Swift Strikes', icon: '⚡', desc: (m) => `+${pct(0.12 * m)} attack speed`, mods: (m) => ({ mul: { attackSpeed: 0.12 * m } }) },
  { id: 'fleet', name: 'Fleet of Foot', icon: '👟', desc: (m) => `+${pct(0.07 * m)} move speed`, mods: (m) => ({ mul: { moveSpeed: 0.07 * m } }) },
  { id: 'vitality', name: 'Vitality', icon: '❤️', desc: (m) => `+${pct(0.1 * m)} max health`, mods: (m) => ({ mul: { maxHp: 0.1 * m } }) },
  { id: 'might', name: 'Might', icon: '💪', desc: (m) => `+${pct(0.1 * m)} attack damage`, mods: (m) => ({ mul: { ad: 0.1 * m } }) },
  { id: 'arcana', name: 'Arcana', icon: '🔮', desc: (m) => `+${pct(0.12 * m)} spell power`, mods: (m) => ({ mul: { spellPower: 0.12 * m } }) },
  { id: 'haste', name: 'Haste', icon: '⏱️', desc: (m) => `+${pct(0.06 * m)} cooldown reduction`, mods: (m) => ({ add: { cdr: 0.06 * m } }) },
  { id: 'vampirism', name: 'Vampirism', icon: '🩸', desc: (m) => `+${pct(0.05 * m)} lifesteal`, mods: (m) => ({ add: { lifesteal: 0.05 * m } }) },
  { id: 'spell_thirst', name: 'Spell Thirst', icon: '🍷', desc: (m) => `Abilities heal you for ${pct(0.08 * m)} of their damage`, mods: (m) => ({ add: { spellVamp: 0.08 * m } }) },
  { id: 'precision', name: 'Precision', icon: '🎯', desc: (m) => `+${pct(0.08 * m)} critical strike chance`, mods: (m) => ({ add: { critChance: 0.08 * m } }) },
  { id: 'bulwark', name: 'Bulwark', icon: '🛡️', desc: (m) => `Take ${pct(0.05 * m)} less damage`, mods: (m) => ({ add: { damageReduction: 0.05 * m } }) },
  { id: 'regrowth', name: 'Regrowth', icon: '🌱', desc: (m) => `+${Math.round(6 * m)} health regeneration per second`, mods: (m) => ({ add: { hpRegen: 6 * m } }) },
  { id: 'reach', name: 'Reach', icon: '🔭', desc: (m) => `+${Math.round(40 * m)} attack range`, mods: (m) => ({ add: { attackRange: 40 * m } }) },
  { id: 'spikes', name: 'Spikes', icon: '🌵', desc: (m) => `Reflect ${pct(0.1 * m)} of damage taken`, mods: (m) => ({ add: { thorns: 0.1 * m } }) },
  { id: 'reaper', name: 'Reaper', icon: '💀', desc: (m) => `+${pct(0.1 * m)} damage to enemies under 35% health`, mods: (m) => ({ add: { execute: 0.1 * m } }) },
  { id: 'enchanted', name: 'Enchanted Blade', icon: '✨', desc: (m) => `Attacks deal +${Math.round(12 * m)} bonus damage`, mods: (m) => ({ add: { onHitDamage: 12 * m } }) },
];

export const rollRarity = (rng: Rng): Rarity => rng.weighted(RARITY_ORDER, (r) => RARITIES[r].weight);

export const rollBoonOffer = (rng: Rng, count = 3): BoonInst[] =>
  rng.sample(BOONS, count).map((def) => ({ def, rarity: rollRarity(rng) }));

/** Bots take the highest rarity option. */
export const bestBoonIndex = (offer: BoonInst[]) => {
  let best = 0;
  offer.forEach((b, i) => {
    if (RARITY_ORDER.indexOf(b.rarity) > RARITY_ORDER.indexOf(offer[best].rarity)) best = i;
  });
  return best;
};
