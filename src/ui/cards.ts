import { RARITIES, RARITY_ORDER, type Rarity } from '../sim/types';
import { el } from './dom';

export interface CardSpec {
  icon: string;
  name: string;
  /** A few words; the card art and numbers do the talking. */
  line: string;
  rarity: Rarity;
  /** Ability color for the art glow. */
  color?: string;
  /** Top-left corner: slot key, ✦ for effect boons, etc. */
  corner?: string;
  /** Top-right corner: cooldown or similar. */
  badge?: string;
  /** Tiny line under the card body (e.g. what a boon stacks to). */
  note?: string;
  /** Full rules text, shown on hover / long press. */
  title?: string;
  hotkey?: string;
  onClick?: () => void;
}

/** A collectible-card style tile: rarity frame, glowing art, name, one short line, rarity pips. */
export function spellCard(c: CardSpec) {
  const r = RARITIES[c.rarity];
  const tier = RARITY_ORDER.indexOf(c.rarity);
  const pips = RARITY_ORDER.map((_, i) => (i <= tier ? '◆' : '◇')).join('');
  return el(`button.scard.r-${c.rarity}`, { style: `--rc:${r.color};--ac:${c.color ?? r.color}`, title: c.title ?? '', onclick: c.onClick }, [
    el('div.sc-art', {}, [
      el('span.sc-icon', { text: c.icon }),
      c.corner ? el('span.sc-corner', { text: c.corner }) : null,
      c.badge ? el('span.sc-badge', { text: c.badge }) : null,
    ]),
    el('div.sc-name', { text: c.name }),
    el('div.sc-line', { text: c.line }),
    c.note ? el('div.sc-note', { text: c.note }) : null,
    el('div.sc-pips', { text: pips, title: r.label }),
    c.hotkey ? el('kbd.sc-hk', { text: c.hotkey }) : null,
  ]);
}
