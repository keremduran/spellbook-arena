/**
 * Procedural top-down character art. Each hero is painted once into a 128×128 canvas,
 * facing up (−y); the renderer rotates the sprite toward the hero's facing direction.
 * Minions are painted in greyscale so they can be tinted with the team colour.
 */

type Ctx = CanvasRenderingContext2D;

const C = 64;

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

const SKIN = '#e0b48c';

/** Shoulders + torso seen from above. */
function torso(c: Ctx, color: string, w = 34, h = 22) {
  outline(c, () => {
    c.beginPath();
    c.ellipse(C, C + 6, w, h, 0, 0, Math.PI * 2);
  });
  ellipse(c, C, C + 6, w, h, color);
}

function hands(c: Ctx, color = SKIN, lx = C - 30, rx = C + 30, y = C - 2) {
  ball(c, lx, y, 7, color);
  ball(c, rx, y, 7, color);
}

const ART: Record<string, (c: Ctx, color: string) => void> = {
  knight(c, color) {
    // Kite shield on the left, longsword on the right.
    torso(c, '#8e9aa6', 34, 22);
    c.fillStyle = color;
    c.fillRect(C - 8, C - 10, 16, 34);
    ball(c, C - 30, C + 2, 13, '#aab4be');
    ball(c, C + 30, C + 2, 13, '#aab4be');
    blade(c, C + 32, C - 4, 8, 4);
    c.fillStyle = '#c9a43b';
    c.fillRect(C + 22, C - 8, 20, 5);
    // Shield
    c.save();
    c.translate(C - 36, C - 10);
    c.beginPath();
    c.moveTo(-14, -12);
    c.lineTo(14, -12);
    c.lineTo(14, 4);
    c.lineTo(0, 20);
    c.lineTo(-14, 4);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = '#d9dee3';
    c.stroke();
    c.fillStyle = '#ffffff';
    c.fillRect(-2, -9, 4, 22);
    c.fillRect(-9, -4, 18, 4);
    c.restore();
    ball(c, C, C - 6, 15, '#b8c2cc', 0.45);
    c.fillStyle = '#1d2329';
    c.fillRect(C - 9, C - 14, 18, 3);
    c.fillRect(C - 1.5, C - 14, 3, 10);
  },
  berserker(c, color) {
    // Fur mantle, horned helm, huge double axe.
    torso(c, '#c49573', 36, 22);
    ellipse(c, C, C + 10, 30, 14, '#6d4c33', 0.15);
    stick(c, C + 30, C + 8, C + 30, C - 50, 5, '#6b4423');
    for (const side of [-1, 1]) {
      c.fillStyle = '#cfd6dc';
      c.beginPath();
      c.moveTo(C + 30, C - 44);
      c.quadraticCurveTo(C + 30 + side * 26, C - 52, C + 30 + side * 20, C - 30);
      c.quadraticCurveTo(C + 30 + side * 10, C - 34, C + 30, C - 32);
      c.closePath();
      c.fill();
      outline(c, () => {
        c.beginPath();
        c.moveTo(C + 30, C - 44);
        c.quadraticCurveTo(C + 30 + side * 26, C - 52, C + 30 + side * 20, C - 30);
      }, 'rgba(0,0,0,0.4)', 2);
    }
    hands(c, SKIN, C - 30, C + 30, C);
    ball(c, C, C - 6, 14, color);
    for (const side of [-1, 1]) {
      c.fillStyle = '#efe6d2';
      c.beginPath();
      c.moveTo(C + side * 10, C - 12);
      c.quadraticCurveTo(C + side * 26, C - 18, C + side * 24, C - 32);
      c.quadraticCurveTo(C + side * 18, C - 20, C + side * 6, C - 4);
      c.closePath();
      c.fill();
    }
  },
  duelist(c, color) {
    // Flowing cape, rapier forward, off-hand parrying dagger.
    c.fillStyle = shade(color, -0.45);
    c.beginPath();
    c.moveTo(C - 30, C + 4);
    c.quadraticCurveTo(C, C + 56, C + 30, C + 4);
    c.closePath();
    c.fill();
    torso(c, color, 28, 18);
    c.strokeStyle = '#e6c35c';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(C, C + 6, 24, 14, 0, Math.PI * 1.1, Math.PI * 1.9);
    c.stroke();
    blade(c, C + 26, C - 6, 4, 2.2, '#eef3f8');
    c.strokeStyle = '#e6c35c';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(C + 26, C - 4, 6, Math.PI, 0);
    c.stroke();
    blade(c, C - 26, C - 4, C - 24, 2.5);
    hands(c, SKIN, C - 26, C + 26, C - 2);
    ball(c, C, C - 6, 13, SKIN);
    ellipse(c, C, C - 1, 13, 9, '#4a2e1c', 0.2);
  },
  shade(c, color) {
    // Hooded cloak and twin daggers angled forward.
    const cloak = shade(color, -0.55);
    ellipse(c, C, C + 8, 32, 26, cloak, 0.15);
    blade(c, C - 24, C - 6, C - 34, 3);
    blade(c, C + 24, C - 6, C - 34, 3);
    hands(c, '#3a2f4a', C - 24, C + 24, C - 2);
    ball(c, C, C - 4, 16, shade(color, -0.3), 0.25);
    c.fillStyle = '#0b0910';
    c.beginPath();
    c.ellipse(C, C - 12, 9, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = color;
    c.beginPath();
    c.arc(C - 4, C - 13, 1.8, 0, Math.PI * 2);
    c.arc(C + 4, C - 13, 1.8, 0, Math.PI * 2);
    c.fill();
  },
  ranger(c, color) {
    // Quiver on the back, bow held across the front with an arrow nocked.
    c.fillStyle = '#6b4423';
    c.fillRect(C + 8, C + 14, 12, 26);
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#f3e9d2' : '#d9483b';
      c.fillRect(C + 9 + i * 3, C + 38, 2, 6);
    }
    torso(c, shade(color, -0.25), 30, 19);
    c.strokeStyle = '#7a4b25';
    c.lineWidth = 4;
    c.beginPath();
    c.arc(C, C + 12, 40, Math.PI * 1.22, Math.PI * 1.78);
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(C + Math.cos(Math.PI * 1.22) * 40, C + 12 + Math.sin(Math.PI * 1.22) * 40);
    c.lineTo(C, C - 8);
    c.lineTo(C + Math.cos(Math.PI * 1.78) * 40, C + 12 + Math.sin(Math.PI * 1.78) * 40);
    c.stroke();
    stick(c, C, C - 4, C, C - 40, 2, '#c8a46a');
    c.fillStyle = '#cfd6dc';
    c.beginPath();
    c.moveTo(C, C - 46);
    c.lineTo(C - 4, C - 38);
    c.lineTo(C + 4, C - 38);
    c.fill();
    hands(c, SKIN, C - 22, C + 4, C - 18);
    ball(c, C, C + 2, 14, color, 0.2);
  },
  sorcerer(c, color) {
    // Robe, wide wizard hat with a star, staff topped by a glowing orb.
    torso(c, shade(color, -0.35), 32, 22);
    stick(c, C + 30, C + 16, C + 30, C - 40, 4, '#5d4130');
    glowOrb(c, C + 30, C - 44, 8, color);
    hands(c, SKIN, C - 28, C + 30, C - 2);
    ball(c, C, C - 2, 24, color, 0.3);
    ball(c, C, C - 4, 12, shade(color, -0.2), 0.4);
    c.fillStyle = '#fff59d';
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 3 : 7;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      c.lineTo(C + Math.cos(a) * r, C - 4 + Math.sin(a) * r);
    }
    c.fill();
  },
  oracle(c, color) {
    // Pale robes, golden halo, two floating light orbs.
    torso(c, '#f2efe6', 30, 21);
    c.strokeStyle = shade(color, -0.1);
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(C, C + 6, 22, 13, 0, 0, Math.PI * 2);
    c.stroke();
    glowOrb(c, C - 34, C - 18, 7, color);
    glowOrb(c, C + 34, C - 18, 7, color);
    hands(c, SKIN, C - 26, C + 26, C);
    ball(c, C, C - 4, 13, '#f0d9b5');
    c.strokeStyle = '#ffd54f';
    c.lineWidth = 4;
    c.beginPath();
    c.ellipse(C, C - 6, 19, 19, 0, 0, Math.PI * 2);
    c.stroke();
  },
  sharpshooter(c, color) {
    // Long coat, wide-brim hat, long rifle pointing forward.
    torso(c, shade(color, -0.35), 32, 21);
    c.fillStyle = '#3a3f45';
    c.fillRect(C + 6, C - 52, 7, 56);
    c.fillStyle = '#6b4423';
    c.fillRect(C + 4, C - 2, 11, 16);
    c.fillStyle = '#1f2327';
    c.fillRect(C + 7, C - 30, 5, 10);
    hands(c, SKIN, C + 2, C + 16, C - 10);
    ball(c, C - 6, C + 2, 22, '#5d4130', 0.25);
    ball(c, C - 6, C + 1, 12, '#4a3326', 0.3);
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(C - 6, C + 1, 13, 0, Math.PI * 2);
    c.stroke();
  },
  warlock(c, color) {
    // Dark robe with ember trim, curled horns, fire in both hands.
    torso(c, '#2b2230', 32, 22);
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(C, C + 6, 28, 17, 0, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
    glowOrb(c, C - 28, C - 10, 8, color);
    glowOrb(c, C + 28, C - 10, 8, color);
    ball(c, C, C - 4, 14, '#9b7a6a');
    for (const side of [-1, 1]) {
      c.fillStyle = '#2a1d16';
      c.beginPath();
      c.moveTo(C + side * 8, C - 12);
      c.quadraticCurveTo(C + side * 24, C - 20, C + side * 16, C - 30);
      c.quadraticCurveTo(C + side * 14, C - 20, C + side * 4, C - 6);
      c.closePath();
      c.fill();
    }
  },
  monk(c, color) {
    // Saffron robe, prayer beads, fists raised forward.
    torso(c, color, 32, 21);
    c.fillStyle = shade(color, -0.3);
    c.beginPath();
    c.moveTo(C - 30, C + 2);
    c.lineTo(C + 10, C + 26);
    c.lineTo(C + 22, C + 20);
    c.lineTo(C - 18, C - 6);
    c.closePath();
    c.fill();
    ball(c, C - 14, C - 24, 8, SKIN);
    ball(c, C + 14, C - 24, 8, SKIN);
    stick(c, C - 22, C - 2, C - 14, C - 20, 7, SKIN);
    stick(c, C + 22, C - 2, C + 14, C - 20, 7, SKIN);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ball(c, C + Math.cos(a) * 17, C - 2 + Math.sin(a) * 15, 2.6, '#5d3a1a', 0.4);
    }
    ball(c, C, C - 2, 13, SKIN, 0.45);
  },
};

/** Paints the hero with the given id into a fresh canvas (falls back to a generic figure). */
export function paintHero(c: Ctx, id: string, color: string) {
  c.clearRect(0, 0, 128, 128);
  (ART[id] ?? ART.duelist)(c, color);
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
