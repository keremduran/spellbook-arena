import { heroImg } from '../game/heroIcons';
import { MAP_H, MAP_W, MAX_LEVEL, xpToNext } from '../sim/constants';
import { DIRECTIVES, RARITIES, SLOTS, type Directive, type GameEvent, type Team, type Unit } from '../sim/types';
import type { World } from '../sim/world';
import { clear, el } from './dom';
import { bestBoonIndex } from '../sim/boons';
import { bannerEvents, boonCards, drawMinimap, portrait, pushFeed, soundButtons } from './hud';

const DIRECTIVE_LABEL: Record<Directive, string> = { auto: 'Auto', push: 'Push', farm: 'Farm', group: 'Group', retreat: 'Retreat' };
const DIRECTIVE_ICON: Record<Directive, string> = { auto: '🤖', push: '⏩', farm: '🌾', group: '🫂', retreat: '🏃' };
const SPEEDS = [1, 2, 4, 8];
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Spectator HUD: watch bots, give them orders, and choose boons for managed bots. */
export class ManagerHud {
  root: HTMLElement;
  selected: Unit | null = null;
  /** Set by main: move the spectator camera. */
  onLook: ((x: number, y: number) => void) | null = null;
  speed = 2;
  paused = false;
  private kBlue = el('span.k-blue', { text: '0' });
  private kRed = el('span.k-red', { text: '0' });
  private clock = el('span.clock', { text: '0:00' });
  private speedBtns: HTMLElement[] = [];
  private pauseBtn: HTMLElement;
  private feed = el('div.feed');
  private minimap = el('canvas.minimap', { width: 480, height: 126 }) as HTMLCanvasElement;
  private roster = el('div.roster');
  private selPanel = el('div.sel.hidden');
  private boons = el('div.boons.hidden');
  private acc = 1;
  private boonKey: string | null = null;
  private boonFocusId: number | undefined;

  constructor(parent: HTMLElement, private world: World, onQuit: () => void) {
    this.pauseBtn = el('button', { onclick: () => this.togglePause() }, ['⏸']);
    this.speedBtns = SPEEDS.map((s) => el('button', { onclick: () => this.setSpeed(s) }, [`${s}×`]));
    this.root = el('div.hud.manager', {}, [
      el('div.topbar', {}, [this.kBlue, this.clock, this.kRed, el('div.speed', {}, [this.pauseBtn, ...this.speedBtns])]),
      el('div.topbtns', {}, [
        el('button.iconbtn', { title: 'Hide/show roster', onclick: () => this.roster.classList.toggle('collapsed') }, ['👥']),
        ...soundButtons(),
        el('button.iconbtn', { title: 'Quit', onclick: onQuit }, ['🚪']),
      ]),
      this.roster,
      this.feed,
      this.minimap,
      this.boons,
      this.selPanel,
    ]);
    this.minimap.addEventListener('pointerdown', (e) => {
      const r = this.minimap.getBoundingClientRect();
      this.select(null);
      this.onLook?.(((e.clientX - r.left) / r.width) * MAP_W, ((e.clientY - r.top) / r.height) * MAP_H);
    });
    parent.append(this.root);
    this.setSpeed(this.speed);
  }

  destroy() {
    this.root.remove();
  }

  select(u: Unit | null) {
    this.selected = u;
    this.renderSelected();
    this.renderRoster();
  }

  setSpeed(s: number) {
    this.speed = s;
    this.paused = false;
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === s));
    this.pauseBtn.classList.remove('on');
  }

  togglePause() {
    this.paused = !this.paused;
    this.pauseBtn.classList.toggle('on', this.paused);
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', !this.paused && SPEEDS[i] === this.speed));
  }

  onEvents(events: GameEvent[]) {
    bannerEvents(this.root, events, this.world);
    pushFeed(this.feed, events, 'blue');
  }

  /** Key 1/2/3: pick for whoever the boon panel is showing. */
  pickBoon(index: number) {
    const u = this.boonTarget();
    if (!u) return;
    this.world.pickBoon(u, index);
    this.afterBoonChange(u);
  }

  /** Bot takes its highest-rarity option itself. */
  private letBotPick(u: Unit) {
    this.world.pickBoon(u, bestBoonIndex(u.hero!.offers[0]));
    this.afterBoonChange(u);
  }

  private afterBoonChange(u: Unit) {
    if (!u.hero!.offers.length && this.boonFocusId === u.id) this.boonFocusId = undefined;
    this.boonKey = null;
    this.renderBoons();
    this.renderRoster();
    if (u === this.selected) this.renderSelected();
  }

  /** Cycle through bots that are waiting on a boon (Tab-like, key N). */
  nextBoonBot() {
    const waiting = this.waiting();
    if (waiting.length < 2) return;
    const cur = this.boonTarget();
    this.boonFocusId = waiting[(waiting.indexOf(cur!) + 1) % waiting.length].id;
    this.renderBoons();
  }

  private waiting() {
    return this.world.heroList.filter((h) => h.hero!.managed && h.hero!.offers.length);
  }

  private boonTarget(): Unit | undefined {
    const waiting = this.waiting();
    const focused = waiting.find((h) => h.id === this.boonFocusId);
    if (focused) return focused;
    if (this.selected && waiting.includes(this.selected)) return this.selected;
    return waiting[0];
  }

  private order(units: Unit[], d: Directive) {
    for (const u of units) {
      u.hero!.directive = d;
      if (d === 'retreat') u.hero!.focusId = undefined;
    }
    this.renderRoster();
    this.renderSelected();
  }

  private focus(units: Unit[], target: Unit | undefined) {
    for (const u of units) u.hero!.focusId = target?.id;
    this.renderSelected();
    this.renderRoster();
  }

  update(dt: number) {
    this.acc += dt;
    if (this.acc < 0.15) return;
    this.acc = 0;
    const w = this.world;
    this.kBlue.textContent = String(w.kills.blue);
    this.kRed.textContent = String(w.kills.red);
    this.clock.textContent = fmtTime(w.time);
    this.renderRoster();
    this.renderSelected(true);
    this.renderBoons();
    drawMinimap(this.minimap, w, null, this.selected);
  }

  // ------------------------------------------------------------------ roster

  private rows = new Map<number, { row: HTMLElement; stats: HTMLElement; hp: HTMLElement; tag: HTMLElement; boon: HTMLElement }>();

  /** Built once; renderRoster only updates text and classes so clicks are never lost. */
  private buildRoster() {
    for (const team of ['blue', 'red'] as Team[]) {
      const heroes = this.world.heroList.filter((h) => h.team === team);
      this.roster.append(
        el(`div.rhead.${team}`, {}, [
          el('b', { text: team === 'blue' ? 'Blue team' : 'Red team' }),
          el('div.dirs', {}, DIRECTIVES.map((d) => el('button', { title: `Whole team: ${DIRECTIVE_LABEL[d]}`, onclick: () => this.order(heroes, d) }, [DIRECTIVE_ICON[d]]))),
        ]),
      );
      for (const u of heroes) {
        const h = u.hero!;
        const stats = el('small');
        const hp = el('i');
        const tag = el('span.rtag');
        const boon = el('span.rboon.hidden');
        const row = el('button.rrow', { onclick: () => this.select(u === this.selected ? null : u) }, [
          el('span.ricon', {}, [heroImg(h.def)]),
          el('span.rname', {}, [el('b', { text: h.name }), stats]),
          el('span.rhp', {}, [hp]),
          tag,
          boon,
        ]);
        this.rows.set(u.id, { row, stats, hp, tag, boon });
        this.roster.append(row);
      }
    }
  }

  private renderRoster() {
    if (!this.rows.size) this.buildRoster();
    for (const u of this.world.heroList) {
      const r = this.rows.get(u.id)!;
      const h = u.hero!;
      r.row.classList.toggle('on', u === this.selected);
      r.row.classList.toggle('dead', u.dead);
      r.stats.textContent = `Lv ${h.level} · ${h.kills}/${h.deaths}/${h.assists}`;
      r.hp.style.width = `${u.dead ? 0 : (u.hp / u.stats.maxHp) * 100}%`;
      r.tag.textContent = DIRECTIVE_ICON[h.directive] + (this.world.unit(h.focusId) ? '🎯' : '');
      r.tag.title = DIRECTIVE_LABEL[h.directive];
      const waiting = h.managed ? h.offers.length : 0;
      r.boon.classList.toggle('hidden', !waiting);
      r.boon.textContent = `✨${waiting}`;
    }
  }

  // ------------------------------------------------------------------ selected bot

  private selKey = '';
  private live: { hp: HTMLElement; hpText: HTMLElement; xp: HTMLElement; stat: HTMLElement; cds: Partial<Record<string, HTMLElement>> } | null = null;

  /** Rebuilds the panel only when its buttons change; numbers update in place. */
  private renderSelected(fromTick = false) {
    const u = this.selected;
    this.selPanel.classList.toggle('hidden', !u);
    if (!u) return;
    const w = this.world;
    const h = u.hero!;
    const key = [u.id, h.level, h.directive, h.focusId, h.boons.length, w.heroList.filter((e) => e.dead).map((e) => e.id).join()].join('|');
    if (!fromTick || key !== this.selKey || !this.live) {
      this.selKey = key;
      this.buildSelected(u);
    }
    const s = u.stats;
    const live = this.live!;
    live.hp.style.width = `${(u.hp / s.maxHp) * 100}%`;
    live.hpText.textContent = u.dead ? `Respawning in ${Math.ceil(h.respawnAt - w.time)}s` : `${Math.min(Math.ceil(u.hp), Math.round(s.maxHp))} / ${Math.round(s.maxHp)}`;
    live.xp.style.width = `${h.level >= MAX_LEVEL ? 100 : (h.xp / xpToNext(h.level)) * 100}%`;
    live.stat.textContent = `⚔ ${Math.round(s.ad)}  ⚡ ${s.attackSpeed.toFixed(2)}  👟 ${Math.round(s.moveSpeed)}  🔮 ${Math.round(s.spellPower * 100)}%`;
    for (const slot of SLOTS) {
      const cd = live.cds[slot];
      if (!cd) continue;
      const left = (h.abilities[slot]?.readyAt ?? 0) - w.time;
      cd.classList.toggle('hidden', !(left > 0));
      cd.textContent = left > 0 ? String(Math.ceil(left)) : '';
    }
  }

  private buildSelected(u: Unit) {
    const w = this.world;
    const h = u.hero!;
    clear(this.selPanel);
    const enemies = w.heroList.filter((e) => e.team !== u.team);
    const live = { hp: el('i'), hpText: el('span'), xp: el('i'), stat: el('div.statline'), cds: {} as Record<string, HTMLElement> };
    this.live = live;
    this.selPanel.append(
      el('div.selhead', {}, [
        el('div.face', { style: `--hc:${h.def.color}` }, [heroImg(h.def), el('span.lvl', { text: String(h.level) })]),
        el('div.bars', {}, [
          el('div.selname', {}, [el('b', { text: h.name }), el('small', { text: ` ${h.def.name} · ${u.team}${h.managed ? ' · you pick its boons' : ''}` })]),
          el('div.bar', {}, [live.hp, live.hpText]),
          el('div.bar.xp', {}, [live.xp]),
          live.stat,
        ]),
        el('div.slots', {}, SLOTS.map((slot) => {
          const inst = h.abilities[slot];
          const cd = el('div.cd.hidden');
          if (slot !== 'P') live.cds[slot] = cd;
          return el(`div.slot${slot === 'P' ? '.passive' : ''}`, {
            style: `--rc:${inst ? RARITIES[inst.rarity].color : '#555'}`,
            title: inst ? `${inst.def.name} (${RARITIES[inst.rarity].label})\n${inst.def.desc(w.power(u, inst.rarity), RARITIES[inst.rarity].mult)}` : '',
          }, [el('span.key', { text: slot }), inst?.def.icon ?? '', cd]);
        })),
      ]),
      el('div.selrow', {}, [
        el('span.lbl', { text: 'Order' }),
        ...DIRECTIVES.map((d) => el(`button.dir${h.directive === d ? '.on' : ''}`, { onclick: () => this.order([u], d) }, [`${DIRECTIVE_ICON[d]} ${DIRECTIVE_LABEL[d]}`])),
      ]),
      el('div.selrow', {}, [
        el('span.lbl', { text: 'Focus' }),
        ...enemies.map((e) => el(`button.dir${h.focusId === e.id ? '.on' : ''}${e.dead ? '.dead' : ''}`, { title: `Focus ${e.hero!.name}`, onclick: () => this.focus([u], h.focusId === e.id ? undefined : e) }, [heroImg(e.hero!.def, 'inline'), ` ${e.hero!.name}`])),
        el('button.dir', { title: "Whole team focuses this bot's target", onclick: () => this.focus(w.heroList.filter((a) => a.team === u.team), w.unit(h.focusId)) }, ['📣 Team']),
      ]),
      el('div.selrow', {}, [
        el('span.lbl', { text: 'Boons' }),
        h.boons.length ? el('span.boonlist', {}, h.boons.map((b) => el('span', { style: `--rc:${RARITIES[b.rarity].color}`, title: `${b.def.name} (${RARITIES[b.rarity].label}): ${b.def.desc(RARITIES[b.rarity].mult)}`, text: b.def.icon }))) : el('small', { text: 'none yet' }),
      ]),
    );
  }

  // ------------------------------------------------------------------ boons

  private renderBoons() {
    const u = this.boonTarget();
    const waiting = this.waiting();
    const key = u ? `${u.id}|${waiting.map((h) => `${h.id}:${h.hero!.offers.length}`).join()}` : '';
    if (key === this.boonKey) return;
    this.boonKey = key;
    clear(this.boons);
    this.boons.classList.toggle('hidden', !u);
    if (!u) return;
    const h = u.hero!;
    const tabs = waiting.length > 1
      ? el('div.btabs', {}, waiting.map((w) => el(`button.btab${w === u ? '.on' : ''}`, { title: `${w.hero!.name}: ${w.hero!.offers.length} waiting`, onclick: () => { this.boonFocusId = w.id; this.renderBoons(); } }, [
        portrait(w, 'sm'), el('span', { text: String(w.hero!.offers.length) }),
      ])))
      : el('div.hidden');
    this.boons.append(
      el('h3', {}, [
        el('span.bt', {}, [portrait(u), `${h.name} `, el('small', { text: `${h.def.name} · Lv ${h.level}` })]),
        el('button.dir', { title: 'Let this bot take its best option', onclick: () => this.letBotPick(u) }, ['🤖 Let bot pick']),
      ]),
      tabs,
      boonCards(h.offers[0], (i) => this.pickBoon(i), (b) => this.world.previewBoon(u, b)),
    );
  }
}
