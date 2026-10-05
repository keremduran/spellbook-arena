/**
 * Procedural minion art, painted in greyscale facing up (−y) so it can be tinted with the
 * team colour and rotated toward the minion's facing. Heroes use game-icons.net emblems.
 */

type Ctx = CanvasRenderingContext2D;


function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}

function ball(c: Ctx, x: number, y: number, r: number, color: string, light = 0.35) {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, shade(color, light));
  g.addColorStop(0.7, color);
  g.addColorStop(1, shade(color, -0.35));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, color: string, light = 0.25) {
  const g = c.createRadialGradient(x - rx * 0.3, y - ry * 0.4, 2, x, y, Math.max(rx, ry));
  g.addColorStop(0, shade(color, light));
  g.addColorStop(0.75, color);
  g.addColorStop(1, shade(color, -0.4));
  c.fillStyle = g;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

function outline(c: Ctx, draw: () => void, color = 'rgba(0,0,0,0.55)', w = 3) {
  c.save();
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineJoin = 'round';
  draw();
  c.stroke();
  c.restore();
}

function blade(c: Ctx, x: number, y0: number, y1: number, w: number, color = '#dfe6ee') {
  const g = c.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, shade(color, -0.3));
  g.addColorStop(0.5, shade(color, 0.4));
  g.addColorStop(1, shade(color, -0.2));
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x - w, y0);
  c.lineTo(x - w, y1 + w * 2);
  c.lineTo(x, y1);
  c.lineTo(x + w, y1 + w * 2);
  c.lineTo(x + w, y0);
  c.closePath();
  c.fill();
  outline(c, () => {
    c.beginPath();
    c.moveTo(x - w, y0);
    c.lineTo(x - w, y1 + w * 2);
    c.lineTo(x, y1);
    c.lineTo(x + w, y1 + w * 2);
    c.lineTo(x + w, y0);
  }, 'rgba(0,0,0,0.4)', 1.5);
}

function stick(c: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, color: string) {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

function glowOrb(c: Ctx, x: number, y: number, r: number, color: string) {
  const g = c.createRadialGradient(x, y, 0, x, y, r * 2.2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.3, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r * 2.2, 0, Math.PI * 2);
  c.fill();
}




/** Greyscale minion art (tinted per team at render time). */
export function paintMinion(c: Ctx, ranged: boolean) {
  c.clearRect(0, 0, 64, 64);
  const M = 32;
  ellipse(c, M, M + 4, 18, 13, '#bdbdbd');
  if (ranged) {
    stick(c, M + 15, M + 8, M + 15, M - 20, 3, '#8a8a8a');
    glowOrb(c, M + 15, M - 22, 4, '#ffffff');
    ball(c, M, M, 10, '#d6d6d6', 0.4);
    ball(c, M, M - 2, 6, '#9e9e9e', 0.3);
  } else {
    blade(c, M + 14, M + 2, M - 26, 2.5, '#eeeeee');
    c.fillStyle = '#e0e0e0';
    c.beginPath();
    c.ellipse(M - 15, M - 4, 7, 9, 0, 0, Math.PI * 2);
    c.fill();
    ball(c, M, M - 1, 10, '#e6e6e6', 0.45);
    c.fillStyle = '#424242';
    c.fillRect(M - 6, M - 7, 12, 2.5);
  }
}
