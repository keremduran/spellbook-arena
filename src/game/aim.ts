import type { AbilityDef } from '../sim/abilities';
import type { Unit, Vec } from '../sim/types';
import type { World } from '../sim/world';

/** Aim for touch / button casts: nearest enemy hero, else nearest enemy, else ahead. */
export function autoAim(w: World, u: Unit, def: AbilityDef): Vec {
  const range = Math.max(def.range, 300);
  const dir = u.hero?.moveDir ?? u.facing;
  const ahead = { x: u.x + dir.x * range, y: u.y + dir.y * range };
  if (def.ai === 'escape' || (def.tags.includes('mobility') && def.ai !== 'engage')) return ahead;
  const hero = w.nearestEnemyTo(u.team, u, Math.min(range * 1.1, 1200), u, true);
  if (hero) return { x: hero.x, y: hero.y };
  const any = w.nearestEnemyTo(u.team, u, Math.min(range, 900), u);
  if (any) return { x: any.x, y: any.y };
  return ahead;
}
