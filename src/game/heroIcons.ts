/**
 * Hero emblems from game-icons.net (CC BY 3.0, see src/assets/heroes/CREDITS.md).
 * The SVGs are bundled as text so the game needs no extra image downloads.
 */
import berserker from '../assets/heroes/berserker.svg?raw';
import duelist from '../assets/heroes/duelist.svg?raw';
import knight from '../assets/heroes/knight.svg?raw';
import monk from '../assets/heroes/monk.svg?raw';
import oracle from '../assets/heroes/oracle.svg?raw';
import ranger from '../assets/heroes/ranger.svg?raw';
import shade from '../assets/heroes/shade.svg?raw';
import sharpshooter from '../assets/heroes/sharpshooter.svg?raw';
import sorcerer from '../assets/heroes/sorcerer.svg?raw';
import warlock from '../assets/heroes/warlock.svg?raw';
import type { HeroDef } from '../sim/heroes';

const RAW: Record<string, string> = { berserker, duelist, knight, monk, oracle, ranger, shade, sharpshooter, sorcerer, warlock };

/** Data URI of a hero's emblem in the given fill colour. */
export function heroIconUri(id: string, fill = '#ffffff') {
  const svg = (RAW[id] ?? RAW.duelist).replace(/fill="#fff"/g, `fill="${fill}"`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** <img> of a hero's emblem for HTML screens. */
export function heroImg(def: HeroDef, cls = '') {
  const img = document.createElement('img');
  img.className = `hicon ${cls}`.trim();
  img.alt = def.name;
  img.src = heroIconUri(def.id);
  img.draggable = false;
  return img;
}

/** Base64 data URI (Phaser's loader decodes data URIs with atob). The SVGs are plain ASCII. */
export function heroIconBase64(id: string, fill = '#ffffff') {
  const svg = (RAW[id] ?? RAW.duelist).replace(/fill="#fff"/g, `fill="${fill}"`);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
