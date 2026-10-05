import type { Draft, DraftOption, Picks } from '../sim/draft';
import type { HeroDef } from '../sim/heroes';
import type { Rng } from '../sim/rng';
import { RARITIES, SLOTS, type Slot } from '../sim/types';
import { heroImg } from '../game/heroIcons';
import { el } from './dom';

export const SLOT_LABEL: Record<Slot, string> = { P: 'Passive', Q: 'Ability', W: 'Ability', E: 'Ability', R: 'Ultimate' };
const DRAFT_SECONDS = 60;

export function optionCard(o: DraftOption, hero: HeroDef, onClick?: () => void) {
  const r = RARITIES[o.rarity];
  const p = r.mult * hero.spellPower;
  const meta = [
    ...o.def.tags.slice(0, 3).map((t) => el('i', { text: t })),
    o.def.cooldown ? el('i', { text: `CD ${o.def.cooldown}s` }) : null,
  ];
  return el('button.card', { style: `--rc:${r.color};--ac:${o.def.color}`, onclick: onClick }, [
    el('div.top', {}, [
      el('div.icon', { text: o.def.icon }),
      el('div', {}, [el('div.name', { text: o.def.name }), el('div.rar', { text: r.label })]),
    ]),
    el('div.desc', { text: o.def.desc(p, r.mult) }),
    el('div.meta', {}, meta),
  ]);
}

export function showDraft(root: HTMLElement, hero: HeroDef, draft: Draft, rng: Rng, onLock: (p: Picks) => void) {
  const picks: Partial<Picks> = {};
  const badges = {} as Record<Slot, HTMLElement>;
  const cards = {} as Record<Slot, HTMLElement[]>;
  let left = DRAFT_SECONDS;
  let done = false;

  const timerText = el('span', { text: String(left) });
  const timer = el('div.timer', {}, [timerText]);
  const lock = el('button.btn-primary', { disabled: true, onclick: () => finish() }, ['Lock in (5 left)']) as HTMLButtonElement;

  const choose = (slot: Slot, i: number) => {
    const clearing = picks[slot] === draft[slot][i];
    if (clearing) delete picks[slot];
    else picks[slot] = draft[slot][i];
    cards[slot].forEach((c, j) => {
      c.classList.toggle('selected', !clearing && i === j);
      c.classList.toggle('dim', !clearing && i !== j);
    });
    badges[slot].classList.toggle('done', !clearing);
    const left = SLOTS.filter((s) => !picks[s]).length;
    lock.disabled = left > 0;
    lock.textContent = left > 0 ? `Lock in (${left} left)` : 'Lock in';
  };

  const rows = SLOTS.map((slot) => {
    badges[slot] = el('div.keybadge', {}, [el('b', { text: slot }), el('small', { text: SLOT_LABEL[slot] })]);
    cards[slot] = draft[slot].map((o, i) => optionCard(o, hero, () => choose(slot, i)));
    return el('div.row', {}, [badges[slot], el('div.options', {}, cards[slot])]);
  });

  const stat = (label: string, value: string) => el('div', {}, [el('span', { text: label }), el('b', { text: value })]);
  const screen = el('div.screen', {}, [
    el('div.draft', {}, [
      el('div.draft-head', {}, [el('h1.title', { text: 'Draft your spellbook' }), timer]),
      el('div.draft-body', {}, [
        el('div.hero-card.panel', {}, [
          el('div.portrait', { style: `--hc:${hero.color}` }, [heroImg(hero)]),
          el('h2', { text: hero.name }),
          el('div.role', { text: `${hero.role} · ${hero.range > 200 ? 'Ranged' : 'Melee'}` }),
          el('div.statgrid', {}, [
            stat('Health', String(hero.hp)),
            stat('Attack', String(hero.ad)),
            stat('Atk speed', hero.attackSpeed.toFixed(2)),
            stat('Range', String(hero.range)),
            stat('Move', String(hero.moveSpeed)),
            stat('Spell pow', `${Math.round(hero.spellPower * 100)}%`),
          ]),
          el('div.random-note', { text: 'Your hero was assigned at random, ARAM style. Numbers on the cards already include its spell power.' }),
        ]),
        el('div.rows', {}, rows),
      ]),
      el('div.draft-foot', {}, [
        el('button.btn-ghost', { onclick: () => {
          for (const s of SLOTS) if (!picks[s]) choose(s, rng.int(draft[s].length));
        } }, ['Randomize the rest']),
        lock,
      ]),
    ]),
  ]);

  const tick = setInterval(() => {
    left--;
    timerText.textContent = String(Math.max(0, left));
    timer.style.setProperty('--p', `${(left / DRAFT_SECONDS) * 100}%`);
    timer.classList.toggle('low', left <= 10);
    if (left <= 0) finish();
  }, 1000);

  function finish() {
    if (done) return;
    done = true;
    clearInterval(tick);
    for (const s of SLOTS) if (!picks[s]) picks[s] = rng.pick(draft[s]);
    screen.remove();
    onLock(picks as Picks);
  }

  root.append(screen);
}
