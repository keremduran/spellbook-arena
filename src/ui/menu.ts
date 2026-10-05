import { el } from './dom';

export interface Settings {
  teamSize: number;
  boonEveryLevels: number;
  name: string;
}

const KEY = 'spellbook-settings';

export function loadSettings(): Settings {
  const fallback: Settings = { teamSize: 5, boonEveryLevels: 2, name: 'You' };
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
  const screen: HTMLElement = el('div.screen', {}, [
    el('div.menu', {}, [
      el('h1.title', { text: 'Spellbook Arena' }),
      el('p.tag', { text: 'Random hero. Draft any spell for every key. Fight in a single-lane brawl and stack Hades-style boons.' }),
      el('div.panel', {}, [
        el('div.setting', {}, [el('label', { text: 'Your name' }), name]),
        el('div.setting', {}, [
          el('label', { text: 'Team size' }),
          seg<number>([[1, '1v1'], [3, '3v3'], [5, '5v5']], s.teamSize, (v) => (s.teamSize = v)),
        ]),
        el('div.setting', {}, [
          el('label', { text: 'Boons' }),
          seg<number>([[1, 'Every level'], [2, 'Every 2 levels'], [3, 'Every 3 levels'], [0, 'Off']], s.boonEveryLevels, (v) => (s.boonEveryLevels = v)),
        ]),
      ]),
      el('div', { style: 'margin-top:22px' }, [
        el('button.btn-primary', { onclick: () => {
          s.name = name.value.trim() || 'You';
          saveSettings(s);
          screen.remove();
          onPlay(s);
        } }, ['Draft & Play']),
      ]),
      el('div.how.panel', { style: 'margin-top:22px' }, [
        el('div', { html: '<b>Draft:</b> you get a random hero and 60 seconds to pick 1 of 4 random options for your Passive, Q, W, E and R. Options roll rarities from Common to Legendary, so your build can be trash or totally broken.' }),
        el('div', { html: '<b>Desktop:</b> click to move / attack (hold to keep moving), <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd> <kbd>R</kbd> cast towards the mouse, <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> pick boons, <kbd>S</kbd> stop, hold <kbd>Tab</kbd> for the scoreboard, <kbd>Esc</kbd> pause.' }),
        el('div', { html: '<b>Mobile:</b> joystick or tap to move, ability buttons auto-aim at the nearest enemy. Play in landscape.' }),
        el('div', { html: '<b>Goal:</b> destroy the enemy towers, then their nexus. Your fountain heals you; theirs will melt you.' }),
      ]),
    ]),
  ]);
  root.append(screen);
  return () => screen.remove();
}
