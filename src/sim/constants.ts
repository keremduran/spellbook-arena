import type { Team } from './types';

export const MAP_W = 4200;
export const MAP_H = 1100;
export const LANE_Y = 550;
/** Walkable vertical band; outside it are the lane walls. */
export const Y_MIN = 170;
export const Y_MAX = 930;

export const STEP = 1 / 30;
export const MAX_LEVEL = 18;

export const FOUNTAIN: Record<Team, { x: number; y: number }> = {
  blue: { x: 130, y: LANE_Y },
  red: { x: MAP_W - 130, y: LANE_Y },
};
export const FOUNTAIN_RADIUS = 300;

/** x positions of the blue side; red mirrors them. */
export const STRUCTURE_X = { nexus: 420, inner: 860, outer: 1420 };
export const mirrorX = (team: Team, x: number) => (team === 'blue' ? x : MAP_W - x);
export const laneDir = (team: Team) => (team === 'blue' ? 1 : -1);

export const FIRST_WAVE = 12;
export const WAVE_INTERVAL = 28;
export const RANGED_THRESHOLD = 200;

export const xpToNext = (level: number) => 140 + 62 * level;
export const respawnTime = (level: number) => 4 + 1.5 * level;
