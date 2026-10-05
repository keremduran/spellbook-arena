import { BASIC_POOL, PASSIVE_POOL, ULT_POOL, type AbilityDef } from './abilities';
import { rollRarity } from './boons';
import { HEROES, type HeroDef } from './heroes';
import type { Rng } from './rng';
import { RARITY_ORDER, SLOTS, type Rarity, type Slot, type Team } from './types';
import type { HeroSetup } from './world';

export interface DraftOption {
  def: AbilityDef;
  rarity: Rarity;
}

export type Draft = Record<Slot, DraftOption[]>;
export type Picks = Record<Slot, DraftOption>;

export const OPTIONS_PER_SLOT = 4;
const TANK_WEIGHT = 1.4;

/**
 * Four truly random options per key. Q/W/E draw from the basic pool (no repeats across keys),
 * R from ultimates, P from passives. Each option rolls its own rarity.
 */
export function rollDraft(rng: Rng): Draft {
  // Tank skills are weighted up so a tanky build is a real option most drafts.
  const w = (d: AbilityDef) => (d.tags.includes('tank') ? TANK_WEIGHT : 1);
  const basics = rng.weightedSample(BASIC_POOL, OPTIONS_PER_SLOT * 3, w);
  const opt = (def: AbilityDef): DraftOption => ({ def, rarity: rollRarity(rng) });
  return {
    P: rng.weightedSample(PASSIVE_POOL, OPTIONS_PER_SLOT, w).map(opt),
    Q: basics.slice(0, 4).map(opt),
    W: basics.slice(4, 8).map(opt),
    E: basics.slice(8, 12).map(opt),
    R: rng.weightedSample(ULT_POOL, OPTIONS_PER_SLOT, w).map(opt),
  };
}

/** Bots pick the highest rarity option for each key, breaking ties randomly. */
export function botPicks(draft: Draft, rng: Rng): Picks {
  const picks = {} as Picks;
  for (const slot of SLOTS) {
    const options = rng.sample(draft[slot], draft[slot].length);
    picks[slot] = options.reduce((a, b) => (RARITY_ORDER.indexOf(b.rarity) > RARITY_ORDER.indexOf(a.rarity) ? b : a));
  }
  return picks;
}

export function randomPicks(draft: Draft, rng: Rng): Picks {
  const picks = {} as Picks;
  for (const slot of SLOTS) picks[slot] = rng.pick(draft[slot]);
  return picks;
}

const BOT_NAMES = [
  'Grumble', 'Pixel', 'Nova', 'Bramble', 'Zed-ish', 'Mochi', 'Tank Engine', 'Lagspike', 'Feedbot', 'Glimmer',
  'Rook', 'Bishop', 'Pawnstar', 'Kitey', 'Jinxed', 'Boop', 'Sir Clicks', 'Wombat', 'Quasar', 'Toast',
];

/** Random hero for every slot (distinct within a team when possible) and bot drafts. */
export function buildRoster(rng: Rng, teamSize: number, player: { def: HeroDef; picks: Picks; name: string }): HeroSetup[] {
  const setups: HeroSetup[] = [];
  const names = rng.sample(BOT_NAMES, BOT_NAMES.length);
  for (const team of ['blue', 'red'] as Team[]) {
    const pool = rng.sample(HEROES.filter((h) => team === 'red' || h.id !== player.def.id), HEROES.length);
    for (let i = 0; i < teamSize; i++) {
      if (team === 'blue' && i === 0) {
        setups.push({ def: player.def, team, name: player.name, isPlayer: true, picks: player.picks });
        continue;
      }
      const def = pool[i % pool.length];
      setups.push({ def, team, name: names.pop() ?? `Bot ${i}`, picks: botPicks(rollDraft(rng), rng) });
    }
  }
  return setups;
}

/** All-bot roster for spectator mode. Managed teams leave boon choices to the user. */
export function buildBotRoster(rng: Rng, teamSize: number, managed: Record<Team, boolean>): HeroSetup[] {
  const setups: HeroSetup[] = [];
  const names = rng.sample(BOT_NAMES, BOT_NAMES.length);
  for (const team of ['blue', 'red'] as Team[]) {
    const pool = rng.sample(HEROES, HEROES.length);
    for (let i = 0; i < teamSize; i++) {
      setups.push({ def: pool[i % pool.length], team, name: names.pop() ?? `Bot ${i}`, managed: managed[team], picks: botPicks(rollDraft(rng), rng) });
    }
  }
  return setups;
}
