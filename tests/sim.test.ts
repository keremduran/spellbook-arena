import { describe, expect, it } from 'vitest';
import { ABILITIES, BASIC_POOL, PASSIVE_POOL, ULT_POOL } from '../src/sim/abilities';
import { STEP } from '../src/sim/constants';
import { botPicks, buildBotRoster, buildRoster, rollDraft } from '../src/sim/draft';
import { EFFECT_BOONS } from '../src/sim/boons';
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
        me.x = 1500; me.y = 550;
        foe.x = 1700; foe.y = 550;
        world.rune.nextAt = 9999;
        foe.hero!.isPlayer = true; // no bot brain, so it stands still and delayed spells land
        expect(def.desc(1, 1)).toBeTruthy();
        if (def.cast) expect(world.castAbility(me, slot, { x: foe.x, y: foe.y })).toBe(true);
        let hit = false;
        for (let i = 0; i < 150; i++) {
          if (def.onAttack && i % 10 === 0) me.order = { kind: 'attack', id: foe.id };
          world.update(STEP);
          if (world.events.some((e) => e.type === 'damage' && e.srcId === me.id && e.tgtId === foe.id && !e.heal)) hit = true;
          world.events.length = 0;
        }
        for (const u of world.heroList) {
          expect(Number.isFinite(u.x) && Number.isFinite(u.y) && Number.isFinite(u.hp)).toBe(true);
        }
        if (def.cast && def.ai === 'damage') expect({ id: def.id, hit }).toEqual({ id: def.id, hit: true });
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

describe('bot manager', () => {
  const setup = (seed: number) => {
    const rng = new Rng(seed);
    const world = new World({ boonEveryLevels: 2, seed });
    for (const s of buildBotRoster(rng, 5, { blue: true, red: false })) world.addHero(s);
    return world;
  };
  const run = (w: World, seconds: number) => {
    for (let i = 0; i < seconds * 30 && !w.winner; i++) {
      w.update(STEP);
      w.events.length = 0;
    }
  };

  it('managed bots wait for the user to pick their boons', () => {
    const w = setup(11);
    run(w, 300);
    const blue = w.heroList.filter((h) => h.team === 'blue');
    const red = w.heroList.filter((h) => h.team === 'red');
    expect(blue.every((h) => h.hero!.boons.length === 0)).toBe(true);
    expect(blue.some((h) => h.hero!.offers.length > 0)).toBe(true);
    expect(red.some((h) => h.hero!.boons.length > 0)).toBe(true);
    const first = blue.find((h) => h.hero!.offers.length)!;
    w.pickBoon(first, 2);
    expect(first.hero!.boons).toHaveLength(1);
  });

  it('a team told to push beats a team told to retreat', () => {
    const w = setup(12);
    for (const h of w.heroList) h.hero!.directive = h.team === 'blue' ? 'push' : 'retreat';
    run(w, 20 * 60);
    expect(w.winner).toBe('blue');
  });

  it('focused enemy gets attacked', () => {
    const w = setup(13);
    run(w, 60);
    const target = w.heroList.find((h) => h.team === 'red' && !h.dead)!;
    for (const h of w.heroList) if (h.team === 'blue') h.hero!.focusId = target.id;
    w.rune.nextAt = 9999;
    w.rune.active = false;
    target.x = 1500;
    target.y = 550;
    target.stunUntil = w.time + 5;
    target.hp = target.stats.maxHp;
    w.shield(target, 1e6, 5); // keep it alive so we measure targeting, not burst damage
    for (const h of w.heroList) if (h.team === 'blue') { h.x = 1300; h.y = 550; }
    let most = 0;
    for (let i = 0; i < 30 && !target.dead; i++) {
      w.update(STEP);
      const chasing = w.heroList.filter((h) => h.team === 'blue' && h.order.kind === 'attack' && h.order.id === target.id);
      most = Math.max(most, chasing.length);
    }
    expect(most).toBeGreaterThanOrEqual(3);
  });
});

describe('v3 mechanics', () => {
  const duel = () => {
    const w = new World({ boonEveryLevels: 3, seed: 21 });
    const me = w.addHero({ def: HEROES[2], team: 'blue', name: 'me', isPlayer: true, picks: { Q: { def: BASIC_POOL.find((a) => a.id === 'firebolt')!, rarity: 'common' }, E: { def: BASIC_POOL.find((a) => a.id === 'dash_strike')!, rarity: 'common' } } });
    const foe = w.addHero({ def: HEROES[0], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    const foe2 = w.addHero({ def: HEROES[1], team: 'red', name: 'foe2', isPlayer: true, picks: {} });
    me.x = 1700; me.y = 550;
    foe.x = 1760; foe.y = 550;
    foe2.x = 1800; foe2.y = 600;
    w.rune.nextAt = 9999;
    return { w, me, foe, foe2 };
  };

  for (const boon of EFFECT_BOONS) {
    it(`effect boon ${boon.name} works without errors`, () => {
      const { w, me, foe } = duel();
      me.hero!.offers.push([{ def: boon, rarity: 'legendary' }]);
      w.pickBoon(me, 0);
      expect(me.hero!.effects[boon.effect!]).toBe(2.5);
      me.order = { kind: 'attack', id: foe.id };
      w.castAbility(me, 'Q', { x: foe.x, y: foe.y });
      w.castAbility(me, 'E', { x: foe.x, y: foe.y });
      for (let i = 0; i < 30 * 6; i++) {
        if (foe.dead) foe.dead = false, foe.hp = foe.stats.maxHp;
        w.update(STEP);
      }
      for (const u of w.heroList) expect(Number.isFinite(u.hp) && Number.isFinite(u.x)).toBe(true);
    });
  }

  it('burning blade deals damage over time', () => {
    const { w, me, foe } = duel();
    me.hero!.offers.push([{ def: EFFECT_BOONS.find((b) => b.id === 'burn')!, rarity: 'legendary' }]);
    w.pickBoon(me, 0);
    me.order = { kind: 'attack', id: foe.id };
    for (let i = 0; i < 10; i++) w.update(STEP);
    expect(foe.dots.length).toBe(1);
  });

  it('second wind saves a hero once per life', () => {
    const { w, me, foe } = duel();
    foe.hero!.offers.push([{ def: EFFECT_BOONS.find((b) => b.id === 'secondWind')!, rarity: 'common' }]);
    w.pickBoon(foe, 0);
    w.damage(me, foe, 99999, 'true');
    expect(foe.dead).toBe(false);
    expect(foe.hp).toBe(1);
    for (let i = 0; i < 30 * 2; i++) w.update(STEP);
    w.damage(me, foe, 99999, 'true');
    expect(foe.dead).toBe(true);
  });

  it('the rune grants a rare-or-better boon choice', () => {
    const { w, me } = duel();
    w.rune.nextAt = 0;
    w.update(STEP);
    expect(w.rune.active).toBe(true);
    me.x = w.rune.x;
    me.y = w.rune.y;
    w.update(STEP);
    expect(w.rune.active).toBe(false);
    expect(me.hero!.offers).toHaveLength(1);
    expect(me.hero!.offers[0].every((b) => b.rarity !== 'common')).toBe(true);
  });

  it('first blood is announced', () => {
    const { w, me, foe } = duel();
    w.damage(me, foe, 99999, 'true');
    expect(w.events.some((e) => e.type === 'announce' && e.text === 'First Blood')).toBe(true);
  });
});
