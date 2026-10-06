import type { Unit } from '../sim/types';
import { el } from './dom';

export const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/** Virtual joystick that drives the player's moveDir. */
export function createJoystick(parent: HTMLElement, player: Unit) {
  const knob = el('div.knob');
  const pad = el('div.joystick', {}, [knob]);
  let active: number | null = null;
  const max = 50;

  const move = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > max) {
      dx = (dx / d) * max;
      dy = (dy / d) * max;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const h = player.hero!;
    if (d < 12) h.moveDir = null;
    else {
      h.moveDir = { x: dx / Math.hypot(dx, dy), y: dy / Math.hypot(dx, dy) };
      h.moveMag = Math.min(1, d / max);
      player.order = { kind: 'idle' };
    }
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    active = null;
    knob.style.transform = '';
    player.hero!.moveDir = null;
  };

  pad.addEventListener('pointerdown', (e) => {
    active = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    move(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (e.pointerId === active) move(e);
  });
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  parent.append(pad);
  return pad;
}
