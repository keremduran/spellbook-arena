import { el } from './dom';

export const VERSION = 'v3.6 · tank skills, stacking fixes, boon previews';

export interface Settings {
  mode: 'play' | 'manage';
  /** In manager mode: whose boons the user picks. */
  manageTeams: 'blue' | 'both';
  teamSize: number;
  boonEveryLevels: number;
  name: string;
  difficulty: 'easy' | 'normal' | 'hard';
}

const KEY = 'spellbook-settings-v3';

export function loadSettings(): Settings {
  const fallback: Settings = { mode: 'play', manageTeams: 'blue', teamSize: 5, boonEveryLevels: 3, name: 'You', difficulty: 'normal' };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage unavailable (private mode); settings just won't persist
  }
}

function seg<T>(options: [T, string][], value: T, onPick: (v: T) => void) {
  const wrap = el('div.seg');
  const buttons = options.map(([v, label]) =>
    el('button', { class: v === value ? 'on' : '', onclick: () => {
      buttons.forEach((b) => b.classList.remove('on'));
      btnFor(v).classList.add('on');
      onPick(v);
    } }, [label]),
  );
  const btnFor = (v: T) => buttons[options.findIndex(([o]) => o === v)];
  wrap.append(...buttons);
  return wrap;
}

export function renderMenu(root: HTMLElement, onPlay: (s: Settings) => void) {
  const s = loadSettings();
  const name = el('input.name', { value: s.name, maxlength: 14 }) as HTMLInputElement;
  const manageRow = el('div.setting', {}, [
    el('label', { text: 'You pick boons for' }),
    seg<Settings['manageTeams']>([['blue', 'Blue bots'], ['both', 'Every bot']], s.manageTeams, (v) => (s.manageTeams = v)),
  ]);
  const nameRow = el('div.setting', {}, [el('label', { text: 'Your name' }), name]);
  const diffRow = el('div.setting', {}, [
    el('label', { text: 'Enemy bots' }),
    seg<Settings['difficulty']>([['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], s.difficulty, (v) => (s.difficulty = v)),
  ]);
  const syncMode = () => {
    manageRow.classList.toggle('hidden', s.mode !== 'manage');
    nameRow.classList.toggle('hidden', s.mode !== 'play');
    diffRow.classList.toggle('hidden', s.mode !== 'play');
  };
  const screen: HTMLElement = el('div.screen', {}, [
    el('div.menu', {}, [
      el('h1.title', { text: 'Spellbook Arena' }),
      el('div.ver', { text: VERSION }),
      el('p.tag', { text: 'Random hero. Draft any spell for every key. Fight in a single-lane brawl and stack Hades-style boons.' }),
      el('div.panel', {}, [
        el('div.setting', {}, [
          el('label', { text: 'Mode' }),
          seg<Settings['mode']>([['play', '🎮 Play'], ['manage', '🧠 Watch & manage bots']], s.mode, (v) => { s.mode = v; syncMode(); }),
        ]),
        manageRow,
        nameRow,
        diffRow,
        el('div.setting', {}, [
          el('label', { text: 'Team size' }),
          seg<number>([[1, '1v1'], [3, '3v3'], [5, '5v5']], s.teamSize, (v) => (s.teamSize = v)),
        ]),
        el('div.setting', {}, [
          el('label', { text: 'Boons' }),
          seg<number>([[2, 'Every 2 levels'], [3, 'Every 3 levels'], [4, 'Every 4 levels'], [0, 'Off']], s.boonEveryLevels, (v) => (s.boonEveryLevels = v)),
        ]),
      ]),
      el('div', { style: 'margin-top:22px' }, [
        el('button.btn-primary', { onclick: () => {
          s.name = name.value.trim() || 'You';
          saveSettings(s);
          screen.remove();
          onPlay(s);
        } }, ['Start']),
      ]),
      el('div.how.panel', { style: 'margin-top:22px' }, [
        el('div', { html: '<b>Draft:</b> you get a random hero and 60 seconds to pick 1 of 4 random options for your Passive, Q, W, E and R. Options roll rarities from Common to Legendary, so your build can be trash or totally broken.' }),
        el('div', { html: '<b>Desktop:</b> click to move / attack (hold to keep moving), <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> cast towards the mouse, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> pick boons, <kbd>S</kbd> stop, hold <kbd>Tab</kbd> for the scoreboard, <kbd>Esc</kbd> pause.' }),
        el('div', { html: '<b>Mobile:</b> joystick or tap to move, ability buttons auto-aim at the nearest enemy. Play in landscape.' }),
        el('div', { html: '<b>Watch &amp; manage:</b> all 10 heroes are bots. Click a bot (or its row) to follow it and give it orders: Push, Farm, Group, Retreat, or focus an enemy. Team buttons order everyone at once. You choose the boons for the bots you manage: tabs (or <kbd>N</kbd>) switch between bots that are waiting, and “Let bot pick” hands one back. Drag, WASD/arrows or the minimap move the camera, scroll to zoom, change speed at the top, <kbd>Space</kbd> pauses.' }),
        el('div', { html: '<b>Boons:</b> you earn one every few levels, every 4th kill, every 8th assist, and for each shutdown (Rare or better). ✦ Effect boons change how you fight (burning attacks, ricochet, echoing spells, exploding kills, cheat death) and stack if you take them again. A <b>power rune</b> spawns mid-lane about every minute: grab it for a Rare-or-better boon.' }),
        el('div', { html: '<b>Goal:</b> destroy the enemy towers, then their nexus. Your fountain heals you; theirs will melt you.' }),
      ]),
      el('p.credits', { html: 'Hero icons by Lorc and Delapouite from <a href="https://game-icons.net" target="_blank" rel="noopener">game-icons.net</a>, licensed <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>.' }),
    ]),
  ]);
  syncMode();
  root.append(screen);
  return () => screen.remove();
}
