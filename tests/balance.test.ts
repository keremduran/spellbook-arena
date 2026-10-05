import { it } from 'vitest';
import { STEP } from '../src/sim/constants';
import { buildBotRoster } from '../src/sim/draft';
import { Rng } from '../src/sim/rng';
import { SLOTS } from '../src/sim/types';
import { World } from '../src/sim/world';

declare const process: { env: Record<string, string | undefined> };

/** Balance report: run with `BALANCE=1 npx vitest run tests/balance.test.ts`. Not part of the normal test suite. */
it.runIf(process.env.BALANCE)('balance report', () => {
  const N = Number(process.env.GAMES ?? 60);
  const stat = new Map<string, { picks: number; wins: number }>();
  const add = (k: string, win: boolean) => {
    const s = stat.get(k) ?? { picks: 0, wins: 0 };
    s.picks++;
    if (win) s.wins++;
    stat.set(k, s);
  };
  const lengths: number[] = [];
  const lvl18: number[] = [];
  const lvl6: number[] = [];
  let kills = 0;
  let blueWins = 0;
  for (let g = 0; g < N; g++) {
    const seed = 1000 + g;
    const rng = new Rng(seed);
    const w = new World({ boonEveryLevels: Number(process.env.BOON ?? 2), seed });
    for (const s of buildBotRoster(rng, 5, { blue: false, red: false })) w.addHero(s);
    let t6 = 0;
    let t18 = 0;
    while (!w.winner && w.time < 45 * 60) {
      w.update(STEP);
      w.events.length = 0;
      const avg = w.heroList.reduce((a, h) => a + h.hero!.level, 0) / w.heroList.length;
      if (!t6 && avg >= 6) t6 = w.time;
      if (!t18 && avg >= 18) t18 = w.time;
    }
    lengths.push(w.time / 60);
    lvl6.push(t6 / 60);
    if (t18) lvl18.push(t18 / 60);
    kills += w.kills.blue + w.kills.red;
    if (w.winner === 'blue') blueWins++;
    for (const h of w.heroList) {
      const win = h.team === w.winner;
      add(`hero:${h.hero!.def.name}`, win);
      for (const s of SLOTS) {
        const a = h.hero!.abilities[s];
        if (a) add(`${a.def.kind}:${a.def.name}`, win);
      }
    }
  }
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(1);
  console.log(`games ${N} | length avg ${avg(lengths)} min (min ${Math.min(...lengths).toFixed(1)}, max ${Math.max(...lengths).toFixed(1)}) | avg lvl6 at ${avg(lvl6)} min | avg lvl18 at ${avg(lvl18)} min (${lvl18.length} games) | kills/game ${(kills / N).toFixed(0)} | blue wins ${blueWins}`);
  const rows = [...stat.entries()].map(([k, s]) => ({ k, picks: s.picks, wr: s.wins / s.picks })).sort((a, b) => b.wr - a.wr);
  for (const r of rows) console.log(`${(r.wr * 100).toFixed(0).padStart(3)}%  ${String(r.picks).padStart(4)}  ${r.k}`);
}, 600000);
