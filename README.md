# Spellbook Arena

**Versions:** `v1` first prototype · `v2` graphics, sound and phone controls · `v3` effect boons, power rune, faster matches (current). Git tags mark each one.

A browser MOBA prototype that also runs on phones. Everyone gets a **random hero** (ARAM style), then has **60 seconds to draft their own spells**: for each key (Passive, Q, W, E, R) you pick 1 of 4 random options. Every option rolls a rarity from Common to Legendary, so a build can be useless or completely broken. During the match you pick **Hades-style boons** as you level up.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

- **Desktop:** click to move or attack (hold to keep moving). `Q` `W` `E` `R` cast towards the mouse, `1` `2` `3` pick a boon, `S` stops, hold `Tab` for the scoreboard, `Esc` pauses.
- **Phone:** play in landscape. Left thumb: joystick. Right thumb: skills around a big attack button. Tap a skill to auto-aim, or drag it to aim and release to cast.
- **Goal:** destroy the enemy's outer tower, then the inner tower, then the nexus. Your fountain heals you; the enemy's fountain kills you.

- **Watch & manage bots:** all 10 heroes are bots. Click one to follow it and give it orders (Push, Farm, Group, Retreat, focus an enemy), or order a whole team. You pick the boons for the bots you manage; tabs or `N` switch between bots that are waiting.

Add `?seed=123` to the URL for a repeatable draft and match, or `?quick` to skip the draft.

## What's in it

| | |
|---|---|
| Heroes | 10 base heroes (tank, assassin, marksman, mage and so on). Heroes only set base stats; all abilities come from the draft. |
| Basic abilities (Q/W/E) | 24: skillshots, area attacks, dashes, blink, invisibility, hook, shields, heals, attack-speed buffs and more |
| Ultimates (R) | 12, including a map-wide strike, a black hole, a beam, invulnerability, an execute and an unstoppable charge |
| Passives (P) | 15: lifesteal, attack speed, thorns, stuns every few attacks, out-of-combat invisibility, extra range and more |
| Boons | 10 stat boons and 15 effect boons (burning attacks, ricochet, cleave, echoing spells, split shot, exploding kills, cheat death...) in 4 rarities. Effects stack. Offered every 3 levels by default, plus from the power rune. |
| Power rune | Spawns mid-lane at 0:45 and about every 50s after it's taken. Grants a Rare-or-better boon, a heal and a speed burst. Bots contest it. |
| Map | One short lane with 2 towers and a nexus per side, minion waves every 24s and fountains. Towers are fortified for 5 minutes and crumble in overtime after 15; matches average about 13 minutes. |
| Bots | Every other slot is a bot. Bots draft the highest-rarity options, last-hit minions, fight, avoid tower dives, retreat when low, and use abilities by type (damage, engage, self-buff, heal, escape). |

## Code layout

```
src/sim/      game rules; pure TypeScript with no browser code, runs headless
  world.ts    units, combat, minions, towers, XP, boons, effects
  abilities.ts  every ability (data plus cast function)
  boons.ts, heroes.ts, draft.ts, ai.ts
src/game/     Phaser scene that draws the world and handles input
src/ui/       HTML/CSS screens: menu, draft, HUD, touch joystick
tests/        headless tests: every ability casts, full 5v5 bot matches end with a winner
```

The simulation doesn't depend on rendering, so online multiplayer can be added later by running `World` on a server (for example with Colyseus) and sending its state to clients.

## Scripts

- `npm test`: unit tests plus full simulated bot matches
- `BALANCE=1 GAMES=60 npx vitest run tests/balance.test.ts`: win rate per hero and ability over many bot matches
- `npm run build`: type-check and production build into `dist/`

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. Enable Pages with "GitHub Actions" as the source.

## About League of Legends assets

This project uses no Riot Games names, champions, art or abilities. Riot's fan content policy doesn't allow games built on their IP, so the heroes and spells here are original.

## License

MIT. Uses [Phaser](https://phaser.io) (MIT). The art is emoji and shapes, so there are no third-party assets.
