import type { Team } from './types';

export const MAP_W = 3400;
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
export const STRUCTURE_X = { nexus: 380, inner: 760, outer: 1200 };
export const mirrorX = (team: Team, x: number) => (team === 'blue' ? x : MAP_W - x);
export const laneDir = (team: Team) => (team === 'blue' ? 1 : -1);

export const FIRST_WAVE = 8;
export const WAVE_INTERVAL = 24;
export const RANGED_THRESHOLD = 200;

export const xpToNext = (level: number) => 130 + 55 * level;
export const respawnTime = (level: number) => 3 + 1.1 * level;

/** Mid-lane power rune: grabbing it grants a Rare-or-better boon choice. */
export const RUNE_FIRST = 45;
export const RUNE_INTERVAL = 50;
export const RUNE_RADIUS = 34;

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { castChance: number; damage: number }> = {
  easy: { castChance: 0.45, damage: 0.8 },
  normal: { castChance: 0.8, damage: 1 },
  hard: { castChance: 1, damage: 1.15 },
};
