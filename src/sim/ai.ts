import { FOUNTAIN, LANE_Y, MAP_W, laneDir } from './constants';
import { ACTIVE_SLOTS, type Unit, type Vec } from './types';
import type { World } from './world';

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/** Is this point inside an enemy tower's range without allied minions there to tank it? */
export function towerDanger(w: World, u: Unit, p: Vec): boolean {
  for (const t of w.units) {
    if (t.dead || t.kind !== 'tower' || t.team === u.team) continue;
    const reach = t.stats.attackRange + 80;
    if (dist(t, p) > reach) continue;
    const tank = w.units.some((c) => !c.dead && c.kind === 'creep' && c.team === u.team && dist(c, t) < t.stats.attackRange);
    if (!tank) return true;
  }
  return false;
}

function abilityPlan(w: World, u: Unit, mode: 'fight' | 'retreat', target?: Unit) {
  const h = u.hero!;
  const hpPct = u.hp / u.stats.maxHp;
  let casts = 0;
  const slots = w.rng.sample(ACTIVE_SLOTS, ACTIVE_SLOTS.length);
  // Difficulty: enemy bots of the player hesitate more on Easy.
  const hesitant = w.playerTeam !== null && u.team !== w.playerTeam;
  for (const slot of slots) {
    if (casts >= 2) break;
    if (hesitant && mode === 'fight' && w.rng.next() > w.difficulty().castChance) continue;
    const inst = h.abilities[slot];
    if (!inst || inst.readyAt > w.time || !inst.def.cast) continue;
    const def = inst.def;
    const fountain = FOUNTAIN[u.team];
    let aim: Vec | null = null;

    if (mode === 'retreat') {
      if (def.ai === 'escape' || (def.ai === 'engage' && def.tags.includes('mobility'))) aim = fountain;
      else if (def.ai === 'heal') aim = { x: u.x, y: u.y };
    } else if (target) {
      const d = dist(u, target);
      const tPct = target.hp / target.stats.maxHp;
      // Lead the target a little in the direction it's facing.
      const lead = { x: target.x + target.facing.x * 40, y: target.y + target.facing.y * 40 };
      switch (def.ai) {
        case 'damage':
          if (d <= def.range + target.radius) aim = lead;
          break;
        case 'engage':
          if (d <= def.range + 60 && d > 120 && (tPct < 0.6 || hpPct > 0.55) && !w.isProtected(target)) aim = lead;
          break;
        case 'self':
          if (d <= Math.max(def.range, 450)) aim = { x: target.x, y: target.y };
          break;
        case 'heal':
          if (hpPct < 0.6) aim = { x: u.x, y: u.y };
          break;
        case 'global':
          if (w.heroList.some((e) => e.team !== u.team && !e.dead && w.isVisible(e, u.team) && e.hp / e.stats.maxHp < 0.45)) aim = target;
          break;
        case 'escape':
          if (def.id === 'blink' && tPct < 0.3 && d > u.stats.attackRange + 60 && d < 600) aim = target;
          else if (def.id === 'sprint' && d > u.stats.attackRange + 80) aim = target;
          break;
      }
    }
    if (aim && w.castAbility(u, slot, aim)) casts++;
  }
}

/** Chance per think (~4 per second) that a bot reacts to a ground warning it stands in. */
const DODGE_CHANCE = 0.35;

const FIGHT_RANGE = { auto: 750, push: 380, farm: 450, group: 900, retreat: 0 };

export function thinkHero(w: World, u: Unit) {
  const h = u.hero!;
  if (w.time < h.nextThink) return;
  h.nextThink = w.time + 0.18 + w.rng.next() * 0.12;
  const hpPct = u.hp / u.stats.maxHp;
  const fountain = FOUNTAIN[u.team];
  const dir = laneDir(u.team);
  const d = h.directive;

  if (hpPct < 0.25) h.retreating = true;
  if (h.retreating && hpPct > 0.9) h.retreating = false;

  const enemies = w.heroList.filter((e) => w.attackable(u, e) && dist(e, u) < 900);

  if (h.retreating || d === 'retreat') {
    if (enemies.length) abilityPlan(w, u, 'retreat');
    u.order = { kind: 'move', x: fountain.x + dir * 40, y: fountain.y };
    return;
  }

  // Step out of enemy ground warnings (bots don't always notice).
  const threat = w.threatFor(u);
  if (threat && w.rng.next() < DODGE_CHANCE) {
    u.order = { kind: 'move', x: u.x + threat.away.x * 220, y: u.y + threat.away.y * 220 };
    return;
  }

  // A focus order overrides target choice (unless it means diving a tower without pushing).
  if (h.focusId !== undefined) {
    const f = w.unit(h.focusId);
    if (!f || f.kind !== 'hero') h.focusId = undefined;
    else if (!f.dead && w.attackable(u, f) && dist(f, u) < 1400 && (d === 'push' || !towerDanger(w, u, f) || f.hp / f.stats.maxHp < 0.3)) {
      abilityPlan(w, u, 'fight', f);
      u.order = { kind: 'attack', id: f.id };
      return;
    }
  }

  // Back off if a tower is shooting at us with no minions to tank.
  const shotBy = w.units.find((t) => t.kind === 'tower' && !t.dead && t.team !== u.team && t.structure?.targetId === u.id && dist(t, u) < t.stats.attackRange + 40);
  if (shotBy && hpPct < (d === 'push' ? 0.5 : 0.85) && !enemies.some((e) => e.hp / e.stats.maxHp < 0.15)) {
    u.order = { kind: 'move', x: u.x - dir * 350, y: u.y };
    return;
  }

  // Fight a nearby hero, preferring low health targets, but don't dive towers.
  let target: Unit | undefined;
  let best = Infinity;
  for (const e of enemies) {
    const de = dist(e, u);
    if (de > FIGHT_RANGE[d]) continue;
    const score = de + (e.hp / e.stats.maxHp) * 450;
    if (score < best) {
      best = score;
      target = e;
    }
  }
  if (target) {
    const dive = towerDanger(w, u, target) && target.hp / target.stats.maxHp > 0.2;
    if (!dive) {
      abilityPlan(w, u, 'fight', target);
      u.order = { kind: 'attack', id: target.id };
      return;
    }
  }

  // No enemy towers left: go end the game on their nexus.
  const towersLeft = w.units.some((t) => t.kind === 'tower' && !t.dead && t.team !== u.team);
  const nexus = w.units.find((t) => t.kind === 'nexus' && !t.dead && t.team !== u.team);
  if (!towersLeft && nexus && hpPct > 0.4 && d !== 'farm') {
    u.order = { kind: 'attack', id: nexus.id };
    return;
  }

  // Contest the power rune when it's up and we're healthy enough.
  const rune = w.rune;
  if (rune.active && d !== 'farm' && hpPct > 0.4 && dist(u, rune) < 1300) {
    u.order = { kind: 'move', x: rune.x, y: rune.y };
    return;
  }

  // Group: stick with the rest of the team.
  if (d === 'group') {
    const mates = w.heroList.filter((a) => a !== u && a.team === u.team && !a.dead);
    if (mates.length) {
      const cx = mates.reduce((s, a) => s + a.x, 0) / mates.length;
      const cy = mates.reduce((s, a) => s + a.y, 0) / mates.length;
      if (Math.hypot(cx - u.x, cy - u.y) > 260) {
        u.order = { kind: 'move', x: cx, y: cy };
        return;
      }
    }
  }

  // Farm minions.
  let creep: Unit | undefined;
  best = Infinity;
  for (const c of w.units) {
    if (c.kind !== 'creep' || !w.attackable(u, c)) continue;
    const dc = dist(c, u);
    if (dc > (d === 'group' ? 500 : 700) || towerDanger(w, u, c)) continue;
    const score = dc + (c.hp / c.stats.maxHp) * 200;
    if (score < best) {
      best = score;
      creep = c;
    }
  }

  // Pushing bots hit structures before minions; others only when minions are tanking.
  const alliesNear = (p: Vec) => w.heroList.filter((a) => a.team === u.team && !a.dead && dist(a, p) < 650).length;
  const structure = w.units.find((s) => (s.kind === 'tower' || s.kind === 'nexus') && w.attackable(u, s) && dist(s, u) < 750
    && (!towerDanger(w, u, s) || (d === 'push' && hpPct > 0.55 && alliesNear(s) >= 2)));
  if (structure && (d === 'push' || !creep)) {
    u.order = { kind: 'attack', id: structure.id };
    return;
  }
  if (creep) {
    if (hpPct > 0.6 && w.rng.next() < 0.08) abilityPlan(w, u, 'fight', creep);
    u.order = { kind: 'attack', id: creep.id };
    return;
  }

  // Walk to the front line: just behind the leading allied minion, or in front of our outermost tower.
  let frontX = dir === 1 ? -Infinity : Infinity;
  for (const c of w.units) {
    if (c.kind !== 'creep' || c.dead || c.team !== u.team) continue;
    frontX = dir === 1 ? Math.max(frontX, c.x) : Math.min(frontX, c.x);
  }
  if (!isFinite(frontX)) {
    const towers = w.units.filter((t) => t.kind === 'tower' && !t.dead && t.team === u.team);
    frontX = towers.length ? (dir === 1 ? Math.max(...towers.map((t) => t.x)) : Math.min(...towers.map((t) => t.x))) + dir * 120 : fountain.x + dir * 400;
  }
  const back = d === 'push' ? -60 : d === 'farm' ? 380 : u.stats.attackRange > 200 ? 260 : 120;
  let x = frontX - dir * back;
  const y = LANE_Y + h.laneOffset;
  if (d !== 'push') while (towerDanger(w, u, { x, y }) && Math.abs(x - fountain.x) > 200) x -= dir * 100;
  x = Math.max(60, Math.min(MAP_W - 60, x));
  u.order = { kind: 'move', x, y };
}

export function thinkCreep(w: World, u: Unit) {
  const c = u.creep!;
  if (w.time < c.nextThink) return;
  c.nextThink = w.time + 0.3;
  const current = w.unit(u.order.kind === 'attack' ? u.order.id : undefined);
  if (current && w.attackable(u, current) && dist(current, u) < 500) return;

  let target: Unit | undefined;
  let best = Infinity;
  for (const e of w.units) {
    if (!w.attackable(u, e)) continue;
    const d = dist(e, u) - e.radius;
    if (d > 420) continue;
    const score = d + (e.kind === 'hero' ? 150 : 0) + (e.kind === 'tower' || e.kind === 'nexus' ? 60 : 0);
    if (score < best) {
      best = score;
      target = e;
    }
  }
  if (target) {
    u.order = { kind: 'attack', id: target.id };
    return;
  }
  const dir = laneDir(u.team);
  u.order = { kind: 'move', x: dir === 1 ? MAP_W - 300 : 300, y: c.laneY };
}
