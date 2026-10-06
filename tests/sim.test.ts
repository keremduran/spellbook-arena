import { describe, expect, it } from 'vitest';
import { ABILITIES, BASIC_POOL, PASSIVE_POOL, ULT_POOL } from '../src/sim/abilities';
import { STEP } from '../src/sim/constants';
import { botPicks, buildBotRoster, buildRoster, rollDraft } from '../src/sim/draft';
import { BOONS, EFFECT_BOONS, upgradeBoon } from '../src/sim/boons';
import { HEROES } from '../src/sim/heroes';
import { Rng } from '../src/sim/rng';
import { SLOTS, type Rarity, type Unit } from '../src/sim/types';
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
    const target = w.heroList.find((h) => h.team === 'red')!;
    target.dead = false;
    for (const h of w.heroList) if (h.team === 'blue') h.hero!.focusId = target.id;
    w.rune.nextAt = 9999;
    w.rune.active = false;
    target.x = 1500;
    target.y = 550;
    target.stunUntil = w.time + 5;
    target.hp = target.stats.maxHp;
    w.shield(target, 1e6, 5); // keep it alive so we measure targeting, not burst damage
    for (const h of w.heroList) {
      if (h.team !== 'blue') continue;
      // Fresh, healthy bots so the check is about focus targeting.
      h.dead = false;
      h.hp = h.stats.maxHp;
      h.hero!.retreating = false;
      h.stunUntil = 0;
      h.x = 1300;
      h.y = 550;
    }
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

describe('map layout', () => {
  it('heroes attacking an outer tower are out of the inner tower range', () => {
    const w = new World({ boonEveryLevels: 3, seed: 5 });
    for (const team of ['blue', 'red'] as const) {
      const towers = w.units.filter((u) => u.kind === 'tower' && u.team === team);
      const outer = towers.find((t) => !t.structure!.protectedBy)!;
      const inner = towers.find((t) => t.structure!.protectedBy)!;
      // Closest a hero (even an enlarged one) can stand to the inner tower while touching the outer tower.
      const heroRadius = 32;
      const closest = Math.abs(outer.x - inner.x) - outer.radius - heroRadius;
      expect(closest).toBeGreaterThan(inner.stats.attackRange + heroRadius + 20);
    }
  });
});

describe('pathing', () => {
  it('minions walk around towers instead of getting stuck behind them', () => {
    const w = new World({ boonEveryLevels: 3, seed: 8 });
    w.rune.nextAt = 9999;
    // No heroes: the first blue wave has to walk past its own inner and outer towers.
    for (let i = 0; i < 30 * 16; i++) w.update(STEP);
    const blue = w.units.filter((u) => u.kind === 'creep' && u.team === 'blue' && !u.dead);
    const outer = w.units.find((u) => u.kind === 'tower' && u.team === 'blue' && !u.structure!.protectedBy)!;
    expect(blue.length).toBeGreaterThan(0);
    const firstWave = blue.slice(0, 6);
    for (const c of firstWave) expect({ id: c.id, x: Math.round(c.x), passed: c.x > outer.x + outer.radius }).toMatchObject({ passed: true });
  });
});

describe('takedown boons and max level', () => {
  const arena = () => {
    const w = new World({ boonEveryLevels: 0, seed: 31 });
    w.rune.nextAt = 9999;
    const me = w.addHero({ def: HEROES[0], team: 'blue', name: 'me', isPlayer: true, picks: {} });
    const ally = w.addHero({ def: HEROES[1], team: 'blue', name: 'ally', isPlayer: true, picks: {} });
    const foe = w.addHero({ def: HEROES[2], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    return { w, me, ally, foe };
  };
  const killFoe = (w: World, killer: Unit, foe: Unit, helper?: Unit) => {
    foe.dead = false;
    foe.hp = foe.stats.maxHp;
    if (helper) w.damage(helper, foe, 1, 'true');
    w.damage(killer, foe, 1e7, 'true');
  };

  it('every 5th kill earns a boon', () => {
    const { w, me, foe } = arena();
    for (let i = 0; i < 4; i++) killFoe(w, me, foe);
    expect(me.hero!.offers).toHaveLength(0);
    killFoe(w, me, foe);
    expect(me.hero!.offers).toHaveLength(1);
  });

  it('every 8th assist earns a boon', () => {
    const { w, me, ally, foe } = arena();
    for (let i = 0; i < 7; i++) killFoe(w, ally, foe, me);
    expect(me.hero!.assists).toBe(7);
    expect(me.hero!.offers).toHaveLength(0);
    killFoe(w, ally, foe, me);
    expect(me.hero!.offers).toHaveLength(1);
  });

  it('a shutdown earns a rare-or-better boon', () => {
    const { w, me, foe } = arena();
    foe.hero!.streak = 3;
    killFoe(w, me, foe);
    expect(me.hero!.offers).toHaveLength(1);
    expect(me.hero!.offers[0].every((b) => b.rarity !== 'common')).toBe(true);
  });

  it('heroes can reach level 21', () => {
    const { w, me } = arena();
    w.gainXp(me, 1e7);
    expect(me.hero!.level).toBe(21);
  });
});

describe('tank mechanics and stacking', () => {
  const solo = () => {
    const w = new World({ boonEveryLevels: 0, seed: 41 });
    w.rune.nextAt = 9999;
    const me = w.addHero({ def: HEROES[0], team: 'blue', name: 'me', isPlayer: true, picks: {} });
    const foe = w.addHero({ def: HEROES[1], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    return { w, me, foe };
  };
  const grant = (w: World, u: Unit, id: string, rarity: Rarity = 'common') => {
    u.hero!.offers.push([{ def: BOONS.find((b) => b.id === id)!, rarity }]);
    w.pickBoon(u, 0);
  };

  it('shields stack instead of replacing each other', () => {
    const { w, me } = solo();
    w.shield(me, 200, 3);
    w.shield(me, 150, 2);
    expect(me.shield).toBe(350);
  });

  it('a shorter invulnerability does not cut a longer one short', () => {
    const { w, me } = solo();
    w.invuln(me, 2.5);
    w.invuln(me, 1);
    expect(me.invulnUntil).toBeCloseTo(w.time + 2.5);
  });

  it('Grit heals back part of the damage taken', () => {
    const { w, me, foe } = solo();
    grant(w, me, 'grit', 'legendary');
    me.hp = me.stats.maxHp;
    w.damage(foe, me, 400, 'true');
    const hurt = me.hp;
    for (let i = 0; i < 30 * 3; i++) w.update(STEP);
    expect(me.hp).toBeGreaterThan(hurt + 400 * 0.25 * 0.9);
  });

  it('boon cards preview the stat change, and stacking effects say so', () => {
    const { w, me } = solo();
    const vit = { def: BOONS.find((b) => b.id === 'vitality')!, rarity: 'common' as Rarity };
    const lines = w.previewBoon(me, vit);
    expect(lines[0]).toMatch(/^Max health: \d+ → \d+$/);
    grant(w, me, 'burn');
    const burn = w.previewBoon(me, { def: BOONS.find((b) => b.id === 'burn')!, rarity: 'rare' });
    expect(burn[0]).toContain('Stacks with your copy');
  });

  it('bots attack the nexus once the enemy has no towers', () => {
    const rng = new Rng(77);
    const w = new World({ boonEveryLevels: 3, seed: 77 });
    for (const s of buildBotRoster(rng, 3, { blue: false, red: false })) w.addHero(s);
    w.rune.nextAt = 9999;
    for (const t of w.units) if (t.kind === 'tower' && t.team === 'red') t.dead = true;
    // Red heroes are away (dead for a long time), so blue's choice is only about the nexus.
    for (const h of w.heroList) if (h.team === 'red') { h.dead = true; h.hero!.respawnAt = 9999; }
    for (let i = 0; i < 30 * 30 && !w.winner; i++) w.update(STEP);
    const nexus = w.units.find((u) => u.kind === 'nexus' && u.team === 'red');
    expect(w.winner === 'blue' || (nexus && nexus.hp < nexus.stats.maxHp)).toBe(true);
  });
});

describe('damage meters', () => {
  it('counts damage dealt to enemy heroes and damage taken from anything', () => {
    const w = new World({ boonEveryLevels: 0, seed: 51 });
    const me = w.addHero({ def: HEROES[0], team: 'blue', name: 'me', isPlayer: true, picks: {} });
    // A ranged foe: melee heroes have built-in damage reduction.
    const foe = w.addHero({ def: HEROES[4], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    w.damage(me, foe, 100, 'true');
    w.shield(foe, 50, 5);
    w.damage(me, foe, 80, 'true'); // shield soaks 50, still counts as damage landed
    const tower = w.units.find((u) => u.kind === 'tower' && u.team === 'blue')!;
    w.damage(tower, foe, 40, 'true');
    expect(me.hero!.dmgDealt).toBe(180);
    expect(foe.hero!.dmgTaken).toBe(220);
  });
});

describe('wind-ups', () => {
  const duel = () => {
    const w = new World({ boonEveryLevels: 0, seed: 3 });
    const hook = ABILITIES.find((a) => a.id === 'hook')!;
    const me = w.addHero({ def: HEROES[0], team: 'blue', name: 'me', isPlayer: true, picks: { Q: { def: hook, rarity: 'common' } } });
    const foe = w.addHero({ def: HEROES[1], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    me.x = 1500; me.y = 600; foe.x = 1900; foe.y = 600;
    return { w, me, foe };
  };

  it('telegraphs before firing and roots the caster', () => {
    const { w, me, foe } = duel();
    expect(w.castAbility(me, 'Q', { x: foe.x, y: foe.y })).toBe(true);
    expect(w.telegraphs).toHaveLength(1);
    expect(w.projectiles).toHaveLength(0);
    expect(me.castUntil).toBeGreaterThan(w.time);
    for (let i = 0; i < 12; i++) w.update(1 / 30);
    expect(w.telegraphs).toHaveLength(0);
    expect(w.projectiles.length).toBeGreaterThan(0);
  });

  it('a stun during the wind-up cancels the cast and refunds half the cooldown', () => {
    const { w, me, foe } = duel();
    w.castAbility(me, 'Q', { x: foe.x, y: foe.y });
    const full = me.hero!.abilities.Q!.readyAt;
    w.stun(me, 0.5);
    for (let i = 0; i < 15; i++) w.update(1 / 30);
    expect(w.projectiles.filter((p) => p.owner === me)).toHaveLength(0);
    expect(me.hero!.abilities.Q!.readyAt).toBeLessThan(full);
  });
});

describe('blink', () => {
  const setup = (rarity: Rarity = 'common') => {
    const w = new World({ boonEveryLevels: 0, seed: 5 });
    const blink = ABILITIES.find((a) => a.id === 'blink')!;
    const hook = ABILITIES.find((a) => a.id === 'hook')!;
    const me = w.addHero({ def: HEROES[0], team: 'blue', name: 'me', isPlayer: true, picks: { Q: { def: blink, rarity }, W: { def: hook, rarity: 'common' } } });
    const foe = w.addHero({ def: HEROES[1], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    me.x = 1800; me.y = 600; foe.x = 2100; foe.y = 600;
    return { w, me, foe };
  };

  it('teleports up to 430 towards the aim, instantly', () => {
    const { w, me } = setup();
    expect(w.castAbility(me, 'Q', { x: 1000, y: 600 })).toBe(true);
    expect(me.x).toBeCloseTo(1370, 0);
    expect(me.y).toBe(600);
  });

  it('goes exactly to a closer aim point', () => {
    const { w, me } = setup();
    w.castAbility(me, 'Q', { x: 1600, y: 600 });
    expect(me.x).toBeCloseTo(1600, 0);
  });

  it('recast within 3s returns to the start, then the rarity cooldown runs and does not leak', () => {
    const { w, me, foe } = setup('legendary');
    w.castAbility(me, 'Q', { x: 1500, y: 600 });
    expect(me.x).toBeCloseTo(1500, 0);
    const q = me.hero!.abilities.Q!;
    expect(q.readyAt - w.time).toBeCloseTo(0.3, 2);
    for (let i = 0; i < 12; i++) w.update(1 / 30);
    w.castAbility(me, 'Q', { x: 0, y: 0 });
    expect(me.x).toBeCloseTo(1800, 0);
    expect(q.readyAt - w.time).toBeCloseTo(10 / Math.sqrt(2.5), 1);
    w.castAbility(me, 'W', { x: foe.x, y: foe.y });
    expect(me.hero!.abilities.W!.readyAt - w.time).toBeCloseTo(11 * (1 - me.stats.cdr), 1);
  });

  it('without a recast the full cooldown starts when the window closes', () => {
    const { w, me } = setup();
    w.castAbility(me, 'Q', { x: 1500, y: 600 });
    for (let i = 0; i < 100; i++) w.update(1 / 30);
    expect(me.hero!.blinkReturn).toBeUndefined();
    expect(me.hero!.abilities.Q!.readyAt).toBeGreaterThan(w.time + 5);
  });

  it('a quick tap with the joystick centred blinks in place (wasted)', async () => {
    const { autoAim } = await import('../src/game/aim');
    const { w, me } = setup();
    me.facing = { x: 1, y: 0 };
    w.castAbility(me, 'Q', autoAim(w, me, me.hero!.abilities.Q!.def));
    expect(me.x).toBeCloseTo(1800, 0);
    expect(me.hero!.abilities.Q!.readyAt).toBeGreaterThan(w.time);
  });

  it('follows the joystick direction, as far as it is pushed', async () => {
    const { autoAim } = await import('../src/game/aim');
    const { w, me } = setup();
    me.facing = { x: 1, y: 0 };
    me.hero!.moveDir = { x: -1, y: 0 };
    me.hero!.moveMag = 0.5;
    w.castAbility(me, 'Q', autoAim(w, me, me.hero!.abilities.Q!.def));
    expect(me.x).toBeCloseTo(1800 - 215, 0);
  });

  it('dash strike only travels as far as aimed', () => {
    const w = new World({ boonEveryLevels: 0, seed: 6 });
    const dash = ABILITIES.find((a) => a.id === 'dash_strike')!;
    const me = w.addHero({ def: HEROES[0], team: 'blue', name: 'me', isPlayer: true, picks: { Q: { def: dash, rarity: 'common' } } });
    me.x = 1800; me.y = 600;
    w.castAbility(me, 'Q', { x: 1900, y: 600 });
    for (let i = 0; i < 30; i++) w.update(1 / 30);
    expect(me.x).toBeGreaterThan(1880);
    expect(me.x).toBeLessThan(1920);
  });
});

describe('v5 mechanics', () => {
  const pick = (id: string, rarity: Rarity = 'common') => ({ def: ABILITIES.find((a) => a.id === id)!, rarity });

  it('spellveil blocks one spell of any size, then recharges', () => {
    const w = new World({ boonEveryLevels: 0, seed: 9 });
    const me = w.addHero({ def: HEROES[3], team: 'blue', name: 'me', isPlayer: true, picks: { P: pick('spellveil') } });
    const foe = w.addHero({ def: HEROES[5], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    const hp = me.hp;
    expect(w.damage(foe, me, 2000, 'spell')).toBe(0);
    expect(me.hp).toBe(hp);
    for (let i = 0; i < 30; i++) w.update(1 / 30);
    expect(w.damage(foe, me, 50, 'spell')).toBeGreaterThan(0);
    expect(w.damage(foe, me, 50, 'attack')).toBeGreaterThan(0);
  });

  it('a rank-up boon raises the rank: more damage, shorter cooldown', () => {
    const w = new World({ boonEveryLevels: 0, seed: 10 });
    const me = w.addHero({ def: HEROES[5], team: 'blue', name: 'me', isPlayer: true, picks: { Q: pick('firebolt') } });
    const q = me.hero!.abilities.Q!;
    const before = w.instPower(me, q);
    me.hero!.offers.push([{ def: upgradeBoon('Q', q), rarity: 'common' }]);
    w.pickBoon(me, 0);
    // At least one rank (a lucky bonus roll can add another).
    expect(q.rank).toBeGreaterThanOrEqual(2);
    expect(w.instPower(me, q)).toBeCloseTo(before * (1 + 0.3 * (q.rank - 1)), 5);
  });

  it('bulwark stance taunts nearby enemy heroes into attacking you', () => {
    const w = new World({ boonEveryLevels: 0, seed: 11 });
    const me = w.addHero({ def: HEROES[0], team: 'blue', name: 'me', isPlayer: true, picks: { Q: pick('bulwark_stance') } });
    const foe = w.addHero({ def: HEROES[4], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    me.x = 1800; me.y = 600; foe.x = 2000; foe.y = 600;
    w.castAbility(me, 'Q', me);
    expect(foe.tauntedBy).toBe(me.id);
    w.update(1 / 30);
    expect(foe.order).toEqual({ kind: 'attack', id: me.id });
  });

  it('towers answer a call for help: they switch to a hero hitting an ally under them', () => {
    const w = new World({ boonEveryLevels: 0, seed: 12 });
    const tower = w.units.find((u) => u.kind === 'tower' && u.team === 'blue')!;
    const ally = w.addHero({ def: HEROES[4], team: 'blue', name: 'ally', isPlayer: true, picks: {} });
    const foe = w.addHero({ def: HEROES[4], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    ally.x = tower.x + 100; ally.y = tower.y;
    foe.x = tower.x + 450; foe.y = tower.y;
    w.damage(foe, ally, 10, 'attack');
    tower.attackCd = 0;
    w.update(1 / 30);
    expect(tower.structure!.targetId).toBe(foe.id);
  });

  it('bots walk out of enemy damage zones', () => {
    const w = new World({ boonEveryLevels: 0, seed: 13 });
    const bot = w.addHero({ def: HEROES[4], team: 'blue', name: 'bot', picks: {} });
    const foe = w.addHero({ def: HEROES[5], team: 'red', name: 'foe', isPlayer: true, picks: {} });
    bot.x = 1800; bot.y = 560; foe.x = 2600; foe.y = 560;
    w.zone({ owner: foe, x: 1800, y: 560, radius: 190, duration: 6, dps: 30, color: '#66bb6a' });
    for (let i = 0; i < 60; i++) w.update(1 / 30);
    expect(Math.hypot(bot.x - 1800, bot.y - 560)).toBeGreaterThan(190);
  });
});
