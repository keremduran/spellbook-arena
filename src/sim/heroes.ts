import { emptyStats, type Stats } from './types';

export interface HeroDef {
  id: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  hp: number;
  regen: number;
  ad: number;
  attackSpeed: number;
  range: number;
  moveSpeed: number;
  spellPower: number;
}

/** Hero "chassis": base stats only. All abilities come from the draft. */
export const HEROES: HeroDef[] = [
  { id: 'knight', name: 'Knight', role: 'Tank', icon: '🛡️', color: '#90a4ae', hp: 900, regen: 6, ad: 46, attackSpeed: 0.7, range: 75, moveSpeed: 300, spellPower: 0.85 },
  { id: 'berserker', name: 'Berserker', role: 'Fighter', icon: '🪓', color: '#e57373', hp: 830, regen: 5.5, ad: 64, attackSpeed: 0.82, range: 75, moveSpeed: 310, spellPower: 0.9 },
  { id: 'duelist', name: 'Duelist', role: 'Skirmisher', icon: '⚔️', color: '#ffb74d', hp: 690, regen: 4.5, ad: 58, attackSpeed: 0.95, range: 80, moveSpeed: 320, spellPower: 0.9 },
  { id: 'shade', name: 'Shade', role: 'Assassin', icon: '🗡️', color: '#9575cd', hp: 620, regen: 4, ad: 64, attackSpeed: 0.85, range: 75, moveSpeed: 335, spellPower: 1.05 },
  { id: 'ranger', name: 'Ranger', role: 'Marksman', icon: '🏹', color: '#81c784', hp: 570, regen: 3.5, ad: 56, attackSpeed: 0.85, range: 520, moveSpeed: 300, spellPower: 0.85 },
  { id: 'sorcerer', name: 'Sorcerer', role: 'Mage', icon: '🔮', color: '#64b5f6', hp: 540, regen: 3.5, ad: 44, attackSpeed: 0.65, range: 480, moveSpeed: 300, spellPower: 1.35 },
  { id: 'oracle', name: 'Oracle', role: 'Support', icon: '✨', color: '#fff176', hp: 580, regen: 5, ad: 42, attackSpeed: 0.65, range: 480, moveSpeed: 305, spellPower: 1.15 },
  { id: 'sharpshooter', name: 'Sharpshooter', role: 'Sniper', icon: '🎯', color: '#4db6ac', hp: 550, regen: 3.5, ad: 62, attackSpeed: 0.75, range: 600, moveSpeed: 295, spellPower: 0.9 },
  { id: 'warlock', name: 'Warlock', role: 'Battlemage', icon: '🔥', color: '#ff8a65', hp: 680, regen: 4.5, ad: 48, attackSpeed: 0.7, range: 430, moveSpeed: 305, spellPower: 1.2 },
  { id: 'monk', name: 'Monk', role: 'Brawler', icon: '🥋', color: '#a1887f', hp: 740, regen: 6, ad: 52, attackSpeed: 1.0, range: 75, moveSpeed: 325, spellPower: 1.0 },
];

/** All heroes have 10% more health than their listed base. */
const HERO_TANKINESS = 1.1;

export const heroBaseStats = (def: HeroDef, level: number): Stats => {
  const l = level - 1;
  return {
    ...emptyStats(),
    maxHp: def.hp * HERO_TANKINESS * (1 + 0.11 * l),
    hpRegen: def.regen * (1 + 0.1 * l),
    ad: def.ad * (1 + 0.065 * l),
    attackRange: def.range,
    attackSpeed: def.attackSpeed * (1 + 0.02 * l),
    moveSpeed: def.moveSpeed,
    spellPower: def.spellPower,
  };
};

/** Ability damage scaling with hero level. */
export const levelScale = (level: number) => 1 + 0.085 * (level - 1);
