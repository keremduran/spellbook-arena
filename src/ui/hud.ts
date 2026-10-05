import { autoAim } from '../game/aim';
import { sfx } from '../game/audio';
import { MAP_H, MAP_W, xpToNext } from '../sim/constants';
import { RARITIES, SLOTS, type BoonInst, type GameEvent, type Slot, type Team, type Unit } from '../sim/types';
import type { World } from '../sim/world';
import { clear, el } from './dom';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  root: HTMLElement;
  private kBlue = el('span.k-blue', { text: '0' });
  private kRed = el('span.k-red', { text: '0' });
  private clock = el('span.clock', { text: '0:00' });
  private feed = el('div.feed');
  private minimap = el('canvas.minimap', { width: 480, height: 126 }) as HTMLCanvasElement;
  private hpFill = el('i');
  private hpText = el('span');
  private xpFill = el('i');
  private lvl = el('span.lvl');
  private statline = el('div.statline');
  private slots = {} as Record<Slot, { btn: HTMLElement; cd: HTMLElement }>;
  private boons = el('div.boons.hidden');
  private death = el('div.death.hidden');
  private scoreboard = el('div.scoreboard.hidden');
  private acc = 1;
  private offerShown = -1;
  /** Set by main: touch drag-to-aim preview in the scene. */
  onAim: ((slot: Slot | null, dir: { x: number; y: number } | null) => void) | null = null;
  /** Set by main: celebrate a boon pick. */
  onBoonPicked: (() => void) | null = null;

  constructor(parent: HTMLElement, private world: World, private player: Unit, onPause: () => void) {
    const h = player.hero!;
    const slotEls = SLOTS.map((slot) => {
      const inst = h.abilities[slot];
      const cd = el('div.cd.hidden');
      const btn = el(`button.slot${slot === 'P' ? '.passive' : ''}`, {
        'data-slot': slot,
        style: `--rc:${inst ? RARITIES[inst.rarity].color : '#555'}`,
        title: inst ? `${inst.def.name} (${RARITIES[inst.rarity].label})\n${inst.def.desc(world.power(player, inst.rarity), RARITIES[inst.rarity].mult)}` : '',
      }, [el('span.key', { text: slot }), inst?.def.icon ?? '', cd]);
      if (slot !== 'P' && inst) this.bindAimButton(btn, slot);
      this.slots[slot] = { btn, cd };
      return btn;
    });
    // Big attack button for touch: target the nearest enemy, heroes first.
    const atk = el('button.slot.atk', { 'data-slot': 'A', title: 'Attack nearest enemy' }, ['⚔️']);
    atk.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      atk.classList.add('pressed');
      const u = this.player;
      let best: Unit | undefined;
      let bestScore = Infinity;
      for (const t of this.world.units) {
        if (!this.world.attackable(u, t)) continue;
        const d = Math.hypot(t.x - u.x, t.y - u.y);
        if (d > u.stats.attackRange + 450) continue;
        const score = d - (t.kind === 'hero' ? 350 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (best) u.order = { kind: 'attack', id: best.id };
    });
    atk.addEventListener('pointerup', () => atk.classList.remove('pressed'));
    atk.addEventListener('pointercancel', () => atk.classList.remove('pressed'));

    this.root = el('div.hud', {}, [
      el('div.topbar', {}, [this.kBlue, this.clock, this.kRed]),
      el('div.topbtns', {}, [
        el('button.iconbtn', { title: 'Scoreboard', onclick: () => this.scoreboard.classList.toggle('hidden') }, ['📊']),
        ...soundButtons(),
        el('button.iconbtn', { title: 'Pause', onclick: () => onPause() }, ['⏸']),
      ]),
      this.feed,
      this.minimap,
      this.boons,
      this.death,
      this.scoreboard,
      el('div.bottom', {}, [
        el('div.me', {}, [
          el('div.face', { style: `--hc:${h.def.color}` }, [h.def.icon, this.lvl]),
          el('div.bars', {}, [
            el('div.bar', {}, [this.hpFill, this.hpText]),
            el('div.bar.xp', {}, [this.xpFill]),
            this.statline,
          ]),
        ]),
        el('div.slots', {}, [...slotEls, atk]),
      ]),
    ]);
    parent.append(this.root);
  }

  destroy() {
    this.root.remove();
  }

  /**
   * Tap = quick cast with auto-aim. Drag = aim in that direction (preview in the scene),
   * release to cast. Drag back onto the button to cancel.
   */
  private bindAimButton(btn: HTMLElement, slot: Slot) {
    let start: { x: number; y: number; id: number } | null = null;
    let dir: { x: number; y: number } | null = null;
    const DEAD = 22;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dir = null;
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('pressed');
    });
    btn.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const d = Math.hypot(dx, dy);
      dir = d > DEAD ? { x: dx / d, y: dy / d } : null;
      this.onAim?.(dir ? slot : null, dir);
    });
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      btn.classList.remove('pressed');
      this.onAim?.(null, null);
      if (cancelled) return;
      const u = this.player;
      const inst = u.hero!.abilities[slot];
      if (!inst) return;
      const range = Math.max(inst.def.range, 250);
      const aim = dir ? { x: u.x + dir.x * range, y: u.y + dir.y * range } : autoAim(this.world, u, inst.def);
      this.world.castAbility(u, slot, aim);
    };
    btn.addEventListener('pointerup', (e) => finish(e, false));
    btn.addEventListener('pointercancel', (e) => finish(e, true));
  }

  onEvents(events: GameEvent[]) {
    bannerEvents(this.root, events, this.world);
    for (const e of events) {
      if (e.type === 'kill') {
        const line = el('div', {}, [
          el(`span.${e.killerTeam}`, { text: e.killer ?? '?' }),
          ' ⚔ ',
          el(`span.${e.victimTeam}`, { text: e.victim }),
        ]);
        this.feed.prepend(line);
        while (this.feed.children.length > 5) this.feed.lastChild?.remove();
        setTimeout(() => line.remove(), 6000);
      } else if (e.type === 'structure') {
        const line = el('div', {}, [el(`span.${e.team}`, { text: e.team === this.player.team ? 'Your' : 'Enemy' }), ` ${e.kind} destroyed!`]);
        this.feed.prepend(line);
        setTimeout(() => line.remove(), 6000);
      }
    }
  }

  pickBoon(index: number) {
    if (!this.player.hero!.offers.length) return;
    this.world.pickBoon(this.player, index);
    this.offerShown = -1;
    this.renderBoons();
    this.onBoonPicked?.();
  }

  showScoreboard(show: boolean) {
    this.scoreboard.classList.toggle('hidden', !show);
    if (show) this.renderScoreboard();
  }

  /** Called every frame: cooldown sweeps update every frame, the rest about 10 times a second. */
  update(dt: number) {
    const u0 = this.player;
    for (const slot of SLOTS) {
      const inst = u0.hero!.abilities[slot];
      if (!inst || slot === 'P') continue;
      const left = inst.readyAt - this.world.time;
      const total = Math.max(0.1, inst.def.cooldown * (1 - u0.stats.cdr));
      const { btn, cd } = this.slots[slot];
      const cooling = left > 0 || u0.dead;
      cd.classList.toggle('hidden', !cooling);
      cd.style.setProperty('--p', `${u0.dead ? 100 : Math.min(100, (left / total) * 100)}%`);
      cd.textContent = u0.dead ? '' : left > 0 ? (left < 1 ? left.toFixed(1) : String(Math.ceil(left))) : '';
      if (btn.dataset.ready === '0' && !cooling) {
        btn.classList.remove('ready-pop');
        void btn.offsetWidth;
        btn.classList.add('ready-pop');
      }
      btn.dataset.ready = cooling ? '0' : '1';
    }
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const w = this.world;
    const u = this.player;
    const h = u.hero!;
    this.kBlue.textContent = String(w.kills.blue);
    this.kRed.textContent = String(w.kills.red);
    this.clock.textContent = fmtTime(w.time);
    this.hpFill.style.width = `${(u.hp / u.stats.maxHp) * 100}%`;
    this.hpText.textContent = `${Math.min(Math.ceil(u.hp), Math.round(u.stats.maxHp))} / ${Math.round(u.stats.maxHp)}${u.shield > 0 ? ` (+${Math.round(u.shield)})` : ''}`;
    this.xpFill.style.width = h.level >= 18 ? '100%' : `${(h.xp / xpToNext(h.level)) * 100}%`;
    this.lvl.textContent = String(h.level);
    const s = u.stats;
    this.statline.textContent = `⚔ ${Math.round(s.ad)}  ⚡ ${s.attackSpeed.toFixed(2)}  👟 ${Math.round(s.moveSpeed)}  🔮 ${Math.round(s.spellPower * 100)}%  ⏱ ${Math.round(s.cdr * 100)}%`;


    this.death.classList.toggle('hidden', !u.dead);
    if (u.dead) {
      clear(this.death);
      this.death.append(el('b', { text: 'Slain' }), el('span', { text: `Respawning in ${Math.ceil(h.respawnAt - w.time)}s` }));
    }
    if (this.offerShown !== h.offers.length) this.renderBoons();
    if (!this.scoreboard.classList.contains('hidden')) this.renderScoreboard();
    this.drawMinimap();
  }

  private renderBoons() {
    const h = this.player.hero!;
    this.offerShown = h.offers.length;
    clear(this.boons);
    const offer = h.offers[0];
    this.boons.classList.toggle('hidden', !offer);
    if (!offer) return;
    this.boons.append(
      el('h3', {}, [
        el('span.bt', {}, [portrait(this.player), `Choose a boon for ${h.def.name}`, el('small', { text: ` Lv ${h.level}` })]),
        el('small', { text: h.offers.length > 1 ? `+${h.offers.length - 1} more waiting · keys 1 2 3` : 'Keys 1 · 2 · 3' }),
      ]),
      boonCards(offer, (i) => this.pickBoon(i)),
    );
  }

  private renderScoreboard() {
    clear(this.scoreboard);
    const rows = [...this.world.heroList].sort((a, b) => (a.team === b.team ? 0 : a.team === 'blue' ? -1 : 1)).map((u) => {
      const h = u.hero!;
      const ab = SLOTS.map((s) => h.abilities[s]?.def.icon ?? '·').join('');
      const boons = h.boons.map((b) => b.def.icon).join('');
      return el(`tr.${u.team}${h.isPlayer ? '.you' : ''}`, {}, [
        el('td', { text: `${h.def.icon} ${h.name}` }),
        el('td', { text: String(h.level) }),
        el('td', { text: `${h.kills} / ${h.deaths} / ${h.assists}` }),
        el('td.ab', { text: ab }),
        el('td.ab', { text: boons || '—' }),
      ]);
    });
    this.scoreboard.append(el('table', {}, [
      el('tr', {}, ['Hero', 'Lvl', 'K / D / A', 'P Q W E R', 'Boons'].map((t) => el('th', { text: t }))),
      ...rows,
    ]));
  }

  private drawMinimap() {
    drawMinimap(this.minimap, this.world, this.player.team);
  }
}

/** Draws the whole lane; `view` hides enemies that are invisible to that team (null = see everything). */
export function drawMinimap(canvas: HTMLCanvasElement, world: World, view: Team | null, selected?: Unit | null) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const sx = canvas.width / MAP_W;
  const sy = canvas.height / MAP_H;
  c.fillStyle = '#0c140f';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#223828';
  c.fillRect(0, 360 * sy, canvas.width, 380 * sy);
  if (world.rune.active) {
    c.fillStyle = '#ffca28';
    c.beginPath();
    c.arc(world.rune.x * sx, world.rune.y * sy, 7, 0, Math.PI * 2);
    c.fill();
  }
  for (const u of world.units) {
    if (u.dead) continue;
    if (view && u.team !== view && !world.isVisible(u, view)) continue;
    const col = u.team === 'blue' ? '#4fa3ff' : '#ff5a5a';
    const r = u.kind === 'hero' ? 6 : u.kind === 'creep' ? 2.5 : 7;
    c.fillStyle = u.hero?.isPlayer || u === selected ? '#ffe082' : col;
    c.beginPath();
    if (u.kind === 'tower' || u.kind === 'nexus') c.rect(u.x * sx - r, u.y * sy - r, r * 2, r * 2);
    else c.arc(u.x * sx, u.y * sy, r, 0, Math.PI * 2);
    c.fill();
  }
}

/** Big centred banner for announcements (First Blood, Rampage, rune spawns). */
export function showBanner(root: HTMLElement, text: string, sub: string, team: Team | 'gold') {
  root.querySelector('.banner')?.remove();
  const b = el(`div.banner.${team}`, {}, [el('b', { text }), sub ? el('span', { text: sub }) : null]);
  root.append(b);
  setTimeout(() => b.remove(), 2600);
}

/** Banners for announcement and rune events. */
export function bannerEvents(root: HTMLElement, events: GameEvent[], world: World) {
  for (const e of events) {
    if (e.type === 'announce') showBanner(root, e.text, e.sub, e.team);
    else if (e.type === 'runeSpawn') showBanner(root, 'Power Rune', 'Mid lane: grab it for a Rare+ boon', 'gold');
    else if (e.type === 'rune') {
      const u = world.unit(e.unitId);
      if (u?.hero) showBanner(root, `${u.hero.name} took the rune`, '', u.team);
    }
  }
}

/** Adds a line to a kill feed element and trims it. */
export function pushFeed(feed: HTMLElement, events: GameEvent[], viewTeam: Team) {
  for (const e of events) {
    let line: HTMLElement | null = null;
    if (e.type === 'kill') {
      line = el('div', {}, [el(`span.${e.killerTeam}`, { text: e.killer ?? '?' }), ' ⚔ ', el(`span.${e.victimTeam}`, { text: e.victim })]);
    } else if (e.type === 'structure') {
      line = el('div', {}, [el(`span.${e.team}`, { text: e.team === viewTeam ? 'Blue' : 'Red' }), ` ${e.kind} destroyed!`]);
    }
    if (!line) continue;
    feed.prepend(line);
    while (feed.children.length > 5) feed.lastChild?.remove();
    const l = line;
    setTimeout(() => l.remove(), 6000);
  }
}

/** Round hero portrait used in boon pickers and tabs. */
export function portrait(u: Unit, size: 'sm' | 'md' = 'md') {
  return el(`span.pface.${size}`, { style: `--hc:${u.hero!.def.color}`, title: u.hero!.name, text: u.hero!.def.icon });
}

/** The three boon cards of an offer. */
export function boonCards(offer: BoonInst[], onPick: (i: number) => void) {
  return el('div.boon-row', {}, offer.map((b, i) => {
    const r = RARITIES[b.rarity];
    const effect = b.def.kind === 'effect';
    return el(`button.boon${effect ? '.effect' : ''}`, { style: `--rc:${r.color}`, onclick: () => onPick(i) }, [
      el('span.bi', { text: b.def.icon }),
      el('div', {}, [
        el('b', { text: b.def.name }),
        el('span.rar', { text: effect ? `✦ ${r.label}` : r.label, title: effect ? 'Effect boon: changes how you fight' : '' }),
        el('p', { text: b.def.desc(r.mult) }),
      ]),
      el('kbd.hk', { text: String(i + 1) }),
    ]);
  }));
}

/** Sound effects and music toggles for the HUD top bar. */
export function soundButtons() {
  const sfxBtn = el('button.iconbtn', { title: 'Sound effects' }, [sfx.sfxOn ? '🔊' : '🔇']);
  const musicBtn = el('button.iconbtn', { title: 'Music' }, ['🎵']);
  musicBtn.classList.toggle('off', !sfx.musicOn);
  sfxBtn.addEventListener('click', () => {
    sfx.unlock();
    sfx.setSfx(!sfx.sfxOn);
    sfxBtn.textContent = sfx.sfxOn ? '🔊' : '🔇';
  });
  musicBtn.addEventListener('click', () => {
    sfx.unlock();
    sfx.setMusic(!sfx.musicOn);
    if (sfx.musicOn) sfx.startMusic();
    musicBtn.classList.toggle('off', !sfx.musicOn);
  });
  return [sfxBtn, musicBtn];
}
