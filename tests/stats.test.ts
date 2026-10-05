import { it } from 'vitest';
import { STEP } from '../src/sim/constants';
import { buildBotRoster } from '../src/sim/draft';
import { Rng } from '../src/sim/rng';
import { SLOTS } from '../src/sim/types';
import { World } from '../src/sim/world';

declare const process: { env: Record<string, string | undefined> };
declare const require: (m: string) => { appendFileSync: (p: string, s: string) => void };

/**
 * Raw per-hero match records for offline balance analysis (one JSON line per match).
 * `STATS=out.jsonl FROM=0 GAMES=100 npx vitest run tests/stats.test.ts`
 */
it.runIf(process.env.STATS)('dump match stats', () => {
  const fs = require('fs');
  const from = Number(process.env.FROM ?? 0);
  const n = Number(process.env.GAMES ?? 50);
  for (let g = from; g < from + n; g++) {
    const seed = 50000 + g;
    const rng = new Rng(seed);
    const w = new World({ boonEveryLevels: 3, seed });
    for (const s of buildBotRoster(rng, 5, { blue: false, red: false })) w.addHero(s);
    while (!w.winner && w.time < 40 * 60) {
      w.update(STEP);
      w.events.length = 0;
    }
    const heroes = w.heroList.map((u) => {
      const h = u.hero!;
      return {
        team: u.team, win: u.team === w.winner, hero: h.def.name, level: h.level,
        k: h.kills, d: h.deaths, a: h.assists, dealt: Math.round(h.dmgDealt), taken: Math.round(h.dmgTaken),
        towers: Math.round(h.dmgBuildings), total: Math.round(h.dmgTotal),
        picks: Object.fromEntries(SLOTS.map((s) => [s, h.abilities[s] ? [h.abilities[s]!.def.name, h.abilities[s]!.rarity] : null])),
        boons: h.boons.map((b) => [b.def.name, b.rarity, b.def.kind]),
      };
    });
    fs.appendFileSync(process.env.STATS!, JSON.stringify({ seed, minutes: w.time / 60, winner: w.winner, kills: w.kills, heroes }) + '\n');
  }
}, 3600000);
