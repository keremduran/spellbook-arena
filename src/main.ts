import Phaser from 'phaser';
import './style.css';
import { ArenaScene } from './game/ArenaScene';
import { buildBotRoster, buildRoster, randomPicks, rollDraft, type Picks } from './sim/draft';
import { HEROES, type HeroDef } from './sim/heroes';
import { Rng } from './sim/rng';
import { RARITIES, SLOTS, type Team, type Unit } from './sim/types';
import { World } from './sim/world';
import { sfx } from './game/audio';
import { el } from './ui/dom';
import { showDraft } from './ui/draftScreen';
import { Hud, damageTable } from './ui/hud';
import { ManagerHud } from './ui/managerHud';
import { musicPicker } from './ui/musicPicker';
import { renderMenu, type Settings } from './ui/menu';
import { createJoystick, isTouchDevice } from './ui/touch';

const ui = document.getElementById('ui')!;
const params = new URLSearchParams(location.search);
if (isTouchDevice()) document.body.classList.add('touch');

// Audio can only start after a user gesture; UI buttons get a soft click.
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.addEventListener(ev, () => sfx.unlock(), { capture: true });
// Coming back to the app (or rotating) can suspend audio on phones; wake it on the next touch.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sfx.unlock();
});
// Exposed for automated audio checks.
(window as unknown as { __sfx: unknown }).__sfx = sfx;
ui.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('button')) sfx.play('click', 0.5);
});

const rotateHint = el('div.rotate', {}, [el('div', {}, [el('b', { text: '📱' }), 'Turn your phone sideways to play']) ]);


let game: Phaser.Game | null = null;

function menu() {
  renderMenu(ui, (settings) => (settings.mode === 'manage' ? startManager(settings) : startDraft(settings)));
}

function createGame(scene: ArenaScene) {
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#0c140f',
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    input: { activePointers: 3 },
    scene,
    banner: false,
  });
}

/** Spectator mode: 10 bots, you give orders and pick boons for the managed ones. */
function startManager(settings: Settings) {
  const seed = Number(params.get('seed')) || Math.floor(Math.random() * 2 ** 31);
  const rng = new Rng(seed);
  const world = new World({ boonEveryLevels: settings.boonEveryLevels, seed });
  const managed = { blue: true, red: settings.manageTeams === 'both' };
  for (const s of buildBotRoster(rng, settings.teamSize, managed)) world.addHero(s);

  let ended = false;
  const quit = () => {
    sfx.stopMusic();
    hud.destroy();
    end?.remove();
    game?.destroy(true);
    game = null;
    menu();
  };
  let end: HTMLElement | null = null;
  const hud = new ManagerHud(ui, world, quit);
  const scene = new ArenaScene(world, null, {
    onEvents: (events) => {
      hud.onEvents(events);
      const e = events.find((x) => x.type === 'end');
      if (e && e.type === 'end' && !ended) {
        ended = true;
        setTimeout(() => sfx.play('victory'), 1000);
        end = el('div.screen.overlay', {}, [
          el('div.endbox.panel', {}, [
            el(`h1.title.${e.winner === 'blue' ? 'win' : 'lose'}`, { text: `${e.winner === 'blue' ? 'Blue' : 'Red'} wins` }),
            el('p.summary', { text: `${Math.floor(world.time / 60)} min · kills ${world.kills.blue} – ${world.kills.red}` }),
            damageTable(world, null),
            el('button.btn-primary', { onclick: quit }, ['Back to menu']),
          ]),
        ]);
        setTimeout(() => end && ui.append(end), 1200);
      }
    },
    onFrame: (dt) => hud.update(dt),
    onBoonKey: (i) => hud.pickBoon(i),
    onToggleScoreboard: () => {},
    onPause: () => hud.togglePause(),
    isPaused: () => hud.paused,
    speed: () => hud.speed,
    selected: () => hud.selected,
    onSelect: (u) => hud.select(u),
    onNextBoon: () => hud.nextBoonBot(),
  });
  hud.onLook = (x, y) => scene.lookAt(x, y);
  createGame(scene);
  if (sfx.musicOn) sfx.startMusic();
  (window as unknown as { __match: unknown }).__match = { world, hud };
}

function startDraft(settings: Settings) {
  const seed = Number(params.get('seed')) || Math.floor(Math.random() * 2 ** 31);
  const rng = new Rng(seed);
  const hero = rng.pick(HEROES);
  const draft = rollDraft(rng);
  // ?quick skips the draft (handy for testing).
  if (params.has('quick')) return startMatch(settings, rng, seed, hero, randomPicks(draft, rng));
  showDraft(ui, hero, draft, rng, (picks) => startMatch(settings, rng, seed, hero, picks));
}

function startMatch(settings: Settings, rng: Rng, seed: number, hero: HeroDef, picks: Picks) {
  const world = new World({ boonEveryLevels: settings.boonEveryLevels, seed, difficulty: settings.difficulty });
  for (const s of buildRoster(rng, settings.teamSize, { def: hero, picks, name: settings.name })) world.addHero(s);
  const player = world.heroList.find((u) => u.hero!.isPlayer)!;

  let paused = false;
  let pauseBox: HTMLElement | null = null;
  const togglePause = () => {
    if (world.winner) return;
    paused = !paused;
    if (paused) {
      pauseBox = el('div.screen.overlay', {}, [
        el('div.pausebox.panel', {}, [
          el('h2.title', { text: 'Paused', style: 'font-size:40px;margin-bottom:18px' }),
          el('div', { style: 'margin-bottom:16px' }, [musicPicker(false)]),
          el('div', { style: 'display:flex;gap:10px;justify-content:center' }, [
            el('button.btn-primary', { onclick: togglePause }, ['Resume']),
            el('button.btn-ghost', { onclick: () => { paused = false; pauseBox?.remove(); teardown(); menu(); } }, ['Quit']),
          ]),
        ]),
      ]);
      ui.append(pauseBox);
    } else pauseBox?.remove();
  };

  const hud = new Hud(ui, world, player, togglePause);
  const joystick = isTouchDevice() ? createJoystick(hud.root, player) : null;
  ui.append(rotateHint);
  let ended = false;

  const scene = new ArenaScene(world, player, {
    onEvents: (events) => {
      hud.onEvents(events);
      const end = events.find((e) => e.type === 'end');
      if (end && end.type === 'end' && !ended) {
        ended = true;
        setTimeout(() => sfx.play(end.winner === player.team ? 'victory' : 'defeat'), 900);
        setTimeout(() => showEnd(world, player, end.winner), 1200);
      }
    },
    onFrame: (dt) => hud.update(dt),
    onBoonKey: (i) => hud.pickBoon(i),
    onToggleScoreboard: (show) => hud.showScoreboard(show),
    onPause: togglePause,
    isPaused: () => paused,
  });

  hud.onAim = (slot, dir) => scene.setAim(slot, dir);
  hud.onBoonPicked = () => scene.vis?.boonPicked(player);
  createGame(scene);
  if (sfx.musicOn) sfx.startMusic();

  const teardown = () => {
    sfx.stopMusic();
    rotateHint.remove();
    hud.destroy();
    joystick?.remove();
    game?.destroy(true);
    game = null;
  };

  // Exposed for debugging and automated browser checks.
  (window as unknown as { __match: unknown }).__match = { world, player, hud, sfx, scene };

  function showEnd(w: World, me: Unit, winner: Team) {
    const h = me.hero!;
    const won = winner === me.team;
    const build = [
      ...SLOTS.map((s) => h.abilities[s]).filter((a) => !!a).map((a) => el('span', { style: `--rc:${RARITIES[a!.rarity].color}`, text: `${a!.def.icon} ${a!.def.name}` })),
    ];
    // Boons as compact icon chips, duplicates merged (hover for the name).
    const groups = new Map<string, { b: (typeof h.boons)[number]; n: number }>();
    for (const b of h.boons) {
      const g = groups.get(b.def.id);
      if (!g) groups.set(b.def.id, { b, n: 1 });
      else {
        g.n++;
        if (RARITIES[b.rarity].mult > RARITIES[g.b.rarity].mult) g.b = b;
      }
    }
    const boonChips = [...groups.values()].map(({ b, n }) =>
      el('span.boonchip', { style: `--rc:${RARITIES[b.rarity].color}`, title: b.def.name, text: n > 1 ? `${b.def.icon}×${n}` : b.def.icon }));
    const box = el('div.screen.overlay', {}, [
      el('div.endbox.panel', {}, [
        el(`h1.title.${won ? 'win' : 'lose'}`, { text: won ? 'Victory' : 'Defeat' }),
        el('p.summary', { text: `${Math.floor(w.time / 60)} min · ${h.def.name} level ${h.level} · ${h.kills} / ${h.deaths} / ${h.assists}` }),
        damageTable(w, me),
        el('div.build', {}, build),
        el('div.build.buildboons', {}, boonChips),
        el('button.btn-primary', { onclick: () => { box.remove(); teardown(); menu(); } }, ['Play again']),
      ]),
    ]);
    ui.append(box);
  }
}

menu();

// Installable app: register the offline cache when running as a normal page (not inside an
// embedding frame such as the Claude artifact viewer, where service workers aren't allowed).
if ('serviceWorker' in navigator && window.top === window && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
