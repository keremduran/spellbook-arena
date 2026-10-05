import { describe, expect, it } from 'vitest';
import { ABILITIES, BASIC_POOL, PASSIVE_POOL, ULT_POOL } from '../src/sim/abilities';
import { STEP } from '../src/sim/constants';
import { botPicks, buildRoster, rollDraft } from '../src/sim/draft';
import { HEROES } from '../src/sim/heroes';
import { Rng } from '../src/sim/rng';
import { SLOTS, type Rarity } from '../src/sim/types';
import { World } from '../src/sim/world';

function botMatch(seed: number, teamSize = 5) {
  const rng = new Rng(seed);
  const world = new World({ boonEveryLevels: 2, seed });
  const roster = buildRoster(rng, teamSize, { def: rng.pick(HEROES), picks: botPicks(rollDraft(rng), rng), name: 'Bot P' });
  for (const s of roster) world.addHero({ ...s, isPlayer: false });
  const maxTime = 45 * 60;
  while (!world.winner && world.time < maxTime) {
    world.update(STEP);
    world.events.length = 0;
  }
  return world;
}

describe('draft', () => {
  it('offers 4 options for each of the 5 keys with no repeated basics', () => {
    const d = rollDraft(new Rng(1));
    for (const s of SLOTS) expect(d[s]).toHaveLength(4);
    const basics = [...d.Q, ...d.W, ...d.E].map((o) => o.def.id);
    expect(new Set(basics).size).toBe(12);
    expect(d.R.every((o) => o.def.kind === 'ult')).toBe(true);
    expect(d.P.every((o) => o.def.kind === 'passive')).toBe(true);
  });

  it('has enough abilities in each pool', () => {
    expect(BASIC_POOL.length).toBeGreaterThanOrEqual(12);
    expect(ULT_POOL.length).toBeGreaterThanOrEqual(4);
    expect(PASSIVE_POOL.length).toBeGreaterThanOrEqual(4);
  });
});

describe('abilities', () => {
  it('every ability casts without errors at every rarity and produces finite numbers', () => {
    const rarities: Rarity[] = ['common', 'legendary'];
    for (const def of ABILITIES) {
      for (const rarity of rarities) {
        const world = new World({ boonEveryLevels: 2, seed: 3 });
        const slot = def.kind === 'passive' ? 'P' : def.kind === 'ult' ? 'R' : 'Q';
        const me = world.addHero({ def: HEROES[0], team: 'blue', name: 'me', picks: { [slot]: { def, rarity } } });
        const foe = world.addHero({ def: HEROES[1], team: 'red', name: 'foe', picks: {} });
        me.x = 2000; me.y = 550;
        foe.x = 2200; foe.y = 550;
        foe.hero!.isPlayer = true; // no bot brain, so it stands still and delayed spells land
        expect(def.desc(1, 1)).toBeTruthy();
        if (def.cast) expect(world.castAbility(me, slot, { x: foe.x, y: foe.y })).toBe(true);
        for (let i = 0; i < 150; i++) {
          if (def.onAttack && i % 10 === 0) me.order = { kind: 'attack', id: foe.id };
          world.update(STEP);
        }
        for (const u of world.heroList) {
          expect(Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.hp)).toBe(true);
        }
        if (def.cast && def.ai === 'damage') expect({ id: def.id, hit: foe.hp < foe.stats.maxHp || foe.dead }).toEqual({ id: def.id, hit: true });
      }
    }
  });
});

describe('full bot matches', () => {
  for (const seed of [1, 2, 3]) {
    it(`5v5 match with seed ${seed} ends with a winner`, () => {
      const w = botMatch(seed);
      const levels = w.heroList.map((h) => h.hero!.level);
      console.log(`seed ${seed}: ${w.winner} won at ${(w.time / 60).toFixed(1)} min, kills blue ${w.kills.blue} red ${w.kills.red}, levels ${Math.min(...levels)}-${Math.max(...levels)}, boons ${w.heroList[0].hero!.boons.length}`);
      expect(w.winner).not.toBeNull();
      expect(w.kills.blue + w.kills.red).toBeGreaterThan(0);
    });
  }

  it('1v1 match ends', () => {
    const w = botMatch(7, 1);
    expect(w.winner).not.toBeNull();
  });
});
