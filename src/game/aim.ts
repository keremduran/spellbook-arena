import type { AbilityDef } from '../sim/abilities';
import type { Unit, Vec } from '../sim/types';
import type { World } from '../sim/world';

/** Aim for touch / button casts: nearest enemy hero, else nearest enemy, else ahead. */
export function autoAim(w: World, u: Unit, def: AbilityDef): Vec {
  const range = Math.max(def.range, 300);
  const dir = u.hero?.moveDir ?? u.facing;
  const ahead = { x: u.x + dir.x * range, y: u.y + dir.y * range };
  if (def.ai === 'escape' || (def.tags.includes('mobility') && def.ai !== 'engage')) {
    // Escapes go where the joystick points. With no joystick input, go away from the nearest
    // enemy hero rather than along `facing` (which points at whatever you last attacked).
    if (u.hero?.moveDir) return ahead;
    const threat = w.nearestEnemyTo(u.team, u, 900, u, true);
    if (threat) {
      const dx = u.x - threat.x;
      const dy = u.y - threat.y;
      const d = Math.hypot(dx, dy) || 1;
      return { x: u.x + (dx / d) * range, y: u.y + (dy / d) * range };
    }
    return ahead;
  }
  const hero = w.nearestEnemyTo(u.team, u, Math.min(range * 1.1, 1200), u, true);
  if (hero) return { x: hero.x, y: hero.y };
  const any = w.nearestEnemyTo(u.team, u, Math.min(range, 900), u);
  if (any) return { x: any.x, y: any.y };
  return ahead;
}
