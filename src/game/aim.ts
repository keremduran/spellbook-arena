import type { AbilityDef } from '../sim/abilities';
import type { Unit, Vec } from '../sim/types';
import type { World } from '../sim/world';

/** Abilities that move you to a chosen point (not lock-on ones like Shadow Strike). */
export const movesToPoint = (def: AbilityDef) => def.tags.includes('mobility') && def.range > 0 && def.tele?.shape !== 'target';

/** Abilities whose aim is a spot on the ground, so drag distance sets how far they land. */
export const aimsAtPoint = (def: AbilityDef) => movesToPoint(def) || (def.tags.includes('area') && def.range > 300);

/** Aim for touch / button casts: nearest enemy hero, else nearest enemy, else ahead. */
export function autoAim(w: World, u: Unit, def: AbilityDef): Vec {
  const range = Math.max(def.range, 300);
  const dir = u.hero?.moveDir ?? u.facing;
  const ahead = { x: u.x + dir.x * range, y: u.y + dir.y * range };
  // Dashes, blinks and leaps go where the joystick points, as far as it's pushed. With the
  // joystick centred they go nowhere (League-style: flashing onto yourself wastes it).
  if (movesToPoint(def)) {
    const h = u.hero;
    if (!h?.moveDir) return { x: u.x, y: u.y };
    const reach = def.range * (h.moveMag ?? 1);
    return { x: u.x + h.moveDir.x * reach, y: u.y + h.moveDir.y * reach };
  }
  if (def.ai === 'escape') return ahead;
  const hero = w.nearestEnemyTo(u.team, u, Math.min(range * 1.1, 1200), u, true);
  if (hero) return { x: hero.x, y: hero.y };
  const any = w.nearestEnemyTo(u.team, u, Math.min(range, 900), u);
  if (any) return { x: any.x, y: any.y };
  return ahead;
}
