import type { Team } from './types';

export const MAP_W = 3800;
export const MAP_H = 1100;
export const LANE_Y = 550;
/** Walkable vertical band; outside it are the lane walls. */
export const Y_MIN = 170;
export const Y_MAX = 930;

export const STEP = 1 / 30;
export const MAX_LEVEL = 21;

export const FOUNTAIN: Record<Team, { x: number; y: number }> = {
  blue: { x: 130, y: LANE_Y },
  red: { x: MAP_W - 130, y: LANE_Y },
};
export const FOUNTAIN_RADIUS = 300;

/** x positions of the blue side; red mirrors them. */
/**
 * Outer and inner towers are 720 apart: more than a tower's 560 range plus unit sizes,
 * so heroes hitting the outer tower are out of the inner tower's reach.
 */
export const STRUCTURE_X = { nexus: 380, inner: 700, outer: 1420 };
export const mirrorX = (team: Team, x: number) => (team === 'blue' ? x : MAP_W - x);
export const laneDir = (team: Team) => (team === 'blue' ? 1 : -1);

export const FIRST_WAVE = 8;
export const WAVE_INTERVAL = 15;
export const RANGED_THRESHOLD = 200;

/** Slower curve so the extra levels (max 21) arrive late in the match. */
export const xpToNext = (level: number) => 160 + 75 * level;
/** 15% shorter than the v3.4 timer (3 + 1.1 per level). */
export const respawnTime = (level: number) => 0.85 * (3 + 1.1 * level);

/** Mid-lane power rune: grabbing it grants a Rare-or-better boon choice. */
export const RUNE_FIRST = 45;
export const RUNE_INTERVAL = 50;
export const RUNE_RADIUS = 34;

/** Takedown boons: every Nth kill or assist earns a boon, whatever your level. */
export const KILLS_PER_BOON = 4;
export const ASSISTS_PER_BOON = 8;

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTY: Record<Difficulty, { castChance: number; damage: number }> = {
  easy: { castChance: 0.45, damage: 0.8 },
  normal: { castChance: 0.8, damage: 1 },
  hard: { castChance: 1, damage: 1.15 },
};
