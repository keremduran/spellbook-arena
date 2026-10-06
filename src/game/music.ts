/**
 * Generative, dynamic background music (Web Audio, no files).
 *
 * Several styles share one engine: a 16th-note sequencer, a small synth kit (drums, bass,
 * pads, plucks, leads, strings, brass) and shared reverb/echo. Each style decides what
 * plays on every step. Two inputs make it follow the game:
 *  - intensity 0..2 (calm / skirmish / teamfight): layers drop in on the next beat and
 *    only drop out after a few calm bars, so fights swell and lulls breathe;
 *  - mood major/minor: harmony flips at the next 8-bar section (minor while you trail).
 * The lead melody is written in phrases (A A B A'), rewritten every 32 bars.
 */

export type Mode = 'major' | 'minor';
export type MusicStyle = 'arcade' | 'dnb' | 'battle' | 'chip' | 'chill';

export const MUSIC_STYLES: { id: MusicStyle; label: string; desc: string }[] = [
  { id: 'arcade', label: 'Arcade Drive', desc: 'Synthwave, 124 bpm' },
  { id: 'dnb', label: 'Drum & Bass', desc: 'Fast breakbeats, 170 bpm' },
  { id: 'battle', label: 'Battle Drums', desc: 'Epic taiko & strings, 140 bpm' },
  { id: 'chip', label: 'Chiptune', desc: 'Retro 8-bit, 150 bpm' },
  { id: 'chill', label: 'Chill', desc: 'Laid-back groove, 96 bpm' },
];

interface Chord {
  root: number;
  tones: number[];
}
type Note = [start: number, len: number, midi: number];

interface StyleDef {
  bpm: number;
  swing: number;
  prog: Record<Mode, Chord[]>;
  scale: Record<Mode, number[]>;
  /** Two-bar lead rhythms: [start step, length]. */
  rhythms: [number, number][][];
  step: (k: Kit, s: StepInfo) => void;
}

interface StepInfo {
  t: number;
  s16: number;
  inBar: number;
  bar: number;
  barOf8: number;
  /** 0 intro, 1 groove, 2 lift, 3 breakdown (8 bars each). */
  section: number;
  chord: Chord;
  intensity: number;
  /** Lead notes starting on this step. */
  lead: Note[];
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const triad = (root: number, minor = false) => [root, root + (minor ? 3 : 4), root + 7];
const voiced = (root: number, minor = false) => triad(root + 24, minor);

// ------------------------------------------------------------------ synth kit

class Kit {
  readonly dry: GainNode;
  private verb: ConvolverNode;
  private wet: GainNode;
  private echo: DelayNode;
  private noise: AudioBuffer;

  constructor(private c: AudioContext, out: AudioNode, echoTime: number) {
    this.dry = c.createGain();
    this.dry.connect(out);
    this.verb = c.createConvolver();
    const len = Math.floor(c.sampleRate * 2);
    const ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.verb.buffer = ir;
    this.wet = c.createGain();
    this.wet.gain.value = 0.28;
    this.verb.connect(this.wet).connect(out);
    this.echo = c.createDelay(1.5);
    this.echo.delayTime.value = echoTime;
    const fb = c.createGain();
    fb.gain.value = 0.3;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.echo.connect(tone).connect(fb).connect(this.echo);
    const echoOut = c.createGain();
    echoOut.gain.value = 0.3;
    tone.connect(echoOut).connect(this.dry);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  fadeOut() {
    const now = this.c.currentTime;
    this.dry.gain.setTargetAtTime(0, now, 0.15);
    this.wet.gain.setTargetAtTime(0, now, 0.15);
    window.setTimeout(() => {
      this.dry.disconnect();
      this.wet.disconnect();
    }, 1200);
  }

  private route(node: AudioNode, send: number, echo = false) {
    node.connect(this.dry);
    if (send > 0) {
      const g = this.c.createGain();
      g.gain.value = send;
      node.connect(g).connect(this.verb);
    }
    if (echo) node.connect(this.echo);
  }

  private env(t: number, vol: number, attack: number, dur: number, send: number, echo = false) {
    const g = this.c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    this.route(g, send, echo);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, end: number, to: AudioNode, detune = 0) {
    const o = this.c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detune;
    o.connect(to);
    o.start(t);
    o.stop(end + 0.05);
    return o;
  }

  private hiss(t: number, dur: number, vol: number, freq: number, type: BiquadFilterType, send = 0.15) {
    const src = this.c.createBufferSource();
    src.buffer = this.noise;
    const f = this.c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    this.route(g, send);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  kick(t: number, vol = 0.24, from = 120, to = 42, dur = 0.2) {
    const g = this.env(t, vol, 0.002, dur, 0.04);
    const o = this.osc('sine', from, t, t + dur, g);
    o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.7);
  }

  snare(t: number, vol = 0.08, dur = 0.14) {
    this.hiss(t, dur, vol, 2000, 'bandpass', 0.25);
    const g = this.env(t, vol * 0.7, 0.002, 0.08, 0.1);
    const o = this.osc('triangle', 200, t, t + 0.1, g);
    o.frequency.exponentialRampToValueAtTime(130, t + 0.08);
  }

  hat(t: number, vol = 0.018, open = false) {
    this.hiss(t, open ? 0.22 : 0.035, vol, 8000, 'highpass', 0.05);
  }

  crash(t: number, vol = 0.03) {
    this.hiss(t, 1.4, vol, 5000, 'highpass', 0.4);
  }

  taiko(t: number, vol = 0.2) {
    const g = this.env(t, vol, 0.003, 0.5, 0.35);
    const o = this.osc('sine', 95, t, t + 0.55, g);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
    this.hiss(t, 0.12, vol * 0.25, 700, 'lowpass', 0.3);
  }

  bass(m: number, t: number, dur: number, vol: number, wave: OscillatorType = 'sine', cutoff = 700) {
    const g = this.env(t, vol, 0.008, dur, 0.04);
    if (wave === 'sine' || wave === 'triangle') {
      this.osc(wave, hz(m), t, t + dur, g);
      return;
    }
    const f = this.c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 2, t);
    f.frequency.exponentialRampToValueAtTime(cutoff * 0.6, t + Math.max(0.05, dur));
    f.Q.value = 3;
    f.connect(g);
    this.osc(wave, hz(m), t, t + dur, f);
    this.osc(wave, hz(m), t, t + dur, f, 9);
  }

  pad(tones: number[], t: number, dur: number, vol: number, wave: OscillatorType = 'sawtooth', cutoff = 1100, attack = 0.5) {
    const f = this.c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - 0.2));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.4);
    f.connect(g);
    this.route(g, 0.55);
    for (const m of tones) for (const det of [-9, 9]) this.osc(wave, hz(m), t, t + dur + 0.45, f, det);
  }

  pluck(m: number, t: number, dur: number, vol: number, wave: OscillatorType = 'sawtooth', bright = 3000, echo = false) {
    const f = this.c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(bright, t);
    f.frequency.exponentialRampToValueAtTime(400, t + Math.max(0.08, dur));
    const g = this.env(t, vol, 0.004, Math.max(0.08, dur), 0.3, echo);
    f.connect(g);
    this.osc(wave, hz(m), t, t + dur + 0.05, f);
  }

  lead(m: number, t: number, dur: number, vol: number, wave: OscillatorType = 'sawtooth', cutoff = 2600) {
    const f = this.c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.c.createGain();
    const end = t + dur;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.setValueAtTime(vol * 0.8, Math.max(t + 0.013, end - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, end + 0.12);
    f.connect(g);
    this.route(g, 0.3, true);
    const o = this.osc(wave, hz(m), t, end + 0.15, f);
    const o2 = this.osc(wave, hz(m), t, end + 0.15, f, 7);
    if (dur > 0.25) {
      // Gentle vibrato on held notes.
      const lfo = this.c.createOscillator();
      const depth = this.c.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(hz(m) * 0.006, t + 0.25);
      lfo.connect(depth);
      depth.connect(o.frequency);
      depth.connect(o2.frequency);
      lfo.start(t);
      lfo.stop(end + 0.15);
    }
  }

  mallet(m: number, t: number, dur: number, vol: number, echo = true) {
    const ring = Math.min(1.4, 0.3 + dur);
    const g = this.env(t, vol, 0.005, ring, 0.45, echo);
    this.osc('sine', hz(m), t, t + ring, g);
    const pg = this.c.createGain();
    pg.gain.setValueAtTime(0.22, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    pg.connect(g);
    this.osc('sine', hz(m) * 4.02, t, t + 0.12, pg);
  }

  /** Short bowed string note (spiccato ostinato). */
  string(m: number, t: number, dur: number, vol: number) {
    const f = this.c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1900;
    const g = this.env(t, vol, 0.01, dur, 0.4);
    f.connect(g);
    this.osc('sawtooth', hz(m), t, t + dur, f, -6);
    this.osc('sawtooth', hz(m), t, t + dur, f, 6);
  }

  /** Brass stab: bright attack that closes down. */
  stab(tones: number[], t: number, vol: number, dur = 0.3) {
    const f = this.c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(2600, t + 0.04);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = this.env(t, vol, 0.02, dur, 0.45);
    f.connect(g);
    for (const m of tones) this.osc('sawtooth', hz(m), t, t + dur, f, (m % 3) * 4 - 4);
  }
}

// ------------------------------------------------------------------ styles

const FAST_RHYTHMS: [number, number][][] = [
  [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4], [16, 2], [18, 2], [20, 2], [22, 2], [24, 8]],
  [[0, 3], [3, 3], [6, 2], [8, 6], [16, 3], [19, 3], [22, 2], [24, 4], [28, 4]],
  [[0, 4], [4, 2], [6, 2], [8, 4], [12, 4], [16, 2], [18, 2], [20, 4], [24, 2], [26, 6]],
  [[2, 2], [4, 2], [6, 4], [10, 2], [12, 4], [18, 2], [20, 2], [22, 2], [24, 8]],
];
const SLOW_RHYTHMS: [number, number][][] = [
  [[0, 3], [4, 2], [6, 2], [8, 6], [16, 2], [18, 2], [20, 8]],
  [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4], [16, 6], [24, 6]],
  [[2, 2], [4, 2], [6, 6], [12, 2], [14, 2], [16, 10]],
];
const PENTA: Record<Mode, number[]> = {
  major: [69, 71, 74, 76, 78, 81, 83, 86, 88],
  minor: [69, 72, 74, 77, 79, 81, 84, 86, 89],
};

/** Jazzy 7th-chord progression (D major / D minor), one chord per bar. */
const DREAMY: Record<Mode, Chord[]> = {
  major: [
    { root: 38, tones: [62, 66, 69, 73] }, { root: 35, tones: [62, 66, 69, 71] },
    { root: 43, tones: [62, 66, 67, 71] }, { root: 45, tones: [61, 64, 66, 69] },
    { root: 40, tones: [62, 64, 67, 71] }, { root: 43, tones: [62, 66, 67, 71] },
    { root: 42, tones: [61, 66, 69, 73] }, { root: 45, tones: [61, 64, 67, 69] },
  ],
  minor: [
    { root: 38, tones: [64, 65, 69, 72] }, { root: 34, tones: [62, 65, 69, 70] },
    { root: 43, tones: [62, 65, 67, 70] }, { root: 45, tones: [61, 64, 67, 69] },
    { root: 38, tones: [60, 62, 65, 69] }, { root: 41, tones: [64, 65, 69, 72] },
    { root: 43, tones: [62, 65, 67, 70] }, { root: 45, tones: [61, 64, 67, 69] },
  ],
};

const arcade: StyleDef = {
  bpm: 124,
  swing: 0,
  prog: {
    major: [38, 45, 47, 43, 38, 45, 43, 45].map((r, i) => ({ root: r, tones: voiced(r, i === 2) })),
    minor: [38, 46, 41, 36, 38, 46, 36, 45].map((r, i) => ({ root: r, tones: voiced(r, i === 0 || i === 4) })),
  },
  scale: PENTA,
  rhythms: FAST_RHYTHMS,
  step(k, s) {
    const { t, inBar, chord, intensity: n, section } = s;
    const drums = n >= 1 && !(section === 3 && n < 2);
    if (inBar === 0) k.pad(chord.tones, t, s.s16 * 16, n === 0 ? 0.008 : 0.005, 'sawtooth', 900 + n * 400);
    // Driving 8th-note bass, octave bounce.
    if (inBar % 2 === 0 && (n > 0 || inBar % 4 === 0)) k.bass(chord.root + (inBar % 4 === 2 ? 12 : 0), t, s.s16 * 1.7, 0.08, 'sawtooth', 380 + n * 160);
    if (drums) {
      if (inBar % 4 === 0) k.kick(t, 0.22);
      if (inBar === 4 || inBar === 12) k.snare(t, 0.075);
      if (inBar % 4 === 2) k.hat(t, 0.02);
      if (n >= 2 && inBar % 2 === 1) k.hat(t, 0.01);
      if (n >= 2 && inBar === 14) k.hat(t, 0.02, true);
    }
    if (n >= 1) {
      const arp = [0, 1, 2, 1, 2, 0, 1, 2];
      k.pluck(chord.tones[arp[inBar % 8]] + 12, t, s.s16 * 0.9, 0.016, 'sawtooth', 2400);
    }
    for (const [, len, m] of s.lead) {
      if (n >= 2) k.lead(m, t, len * s.s16, 0.032, 'sawtooth', 2400);
      else if (n === 1 && section !== 3) k.lead(m - 12, t, len * s.s16, 0.022, 'triangle', 1800);
    }
    if (n >= 2 && s.barOf8 === 0 && inBar === 0) k.crash(t, 0.02);
  },
};

const dnb: StyleDef = {
  bpm: 170,
  swing: 0,
  // Each chord holds for two bars at this tempo.
  prog: {
    major: DREAMY.major.slice(0, 4).flatMap((c) => [c, c]),
    minor: DREAMY.minor.slice(0, 4).flatMap((c) => [c, c]),
  },
  scale: PENTA,
  rhythms: SLOW_RHYTHMS,
  step(k, s) {
    const { t, inBar, chord, intensity: n, section } = s;
    const drums = n >= 1 && !(section === 3 && n < 2);
    // At 170 bpm a chord lasts two bars; pads and bass follow every other bar.
    const chordBar = s.barOf8 % 2 === 0;
    if (inBar === 0 && chordBar) k.pad(chord.tones, t, s.s16 * 32, 0.006, 'sawtooth', 1300, 0.8);
    if (chordBar && inBar === 0) k.bass(chord.root - 12, t, s.s16 * 14, 0.13, 'sine');
    if (!chordBar && inBar === 8) k.bass(chord.root - 12 + 7, t, s.s16 * 6, 0.1, 'sine');
    if (n >= 2 && inBar % 4 === 0) k.bass(chord.root, t, s.s16 * 3, 0.035, 'sawtooth', 300);
    if (drums) {
      if (inBar === 0 || inBar === 10) k.kick(t, 0.24, 140, 45, 0.16);
      if (inBar === 4 || inBar === 12) k.snare(t, 0.09, 0.12);
      if (n >= 2 && (inBar === 7 || inBar === 15)) k.snare(t, 0.025, 0.06);
      if (inBar % 2 === 0) k.hat(t, 0.016 + (inBar % 4 === 2 ? 0.008 : 0));
      if (n >= 2 && inBar % 2 === 1) k.hat(t, 0.009);
    }
    for (const [, len, m] of s.lead) {
      if (n >= 1 && section !== 3) k.mallet(m, t, len * s.s16, 0.05);
      else if (Math.random() < 0.4) k.mallet(m, t, len * s.s16, 0.035);
    }
    if (n >= 2 && s.barOf8 === 0 && inBar === 0) k.crash(t, 0.02);
  },
};

const battle: StyleDef = {
  bpm: 140,
  swing: 0,
  prog: {
    major: [38, 36, 43, 45, 46, 48, 38, 45].map((r) => ({ root: r, tones: voiced(r) })),
    minor: [38, 46, 43, 45, 38, 46, 48, 45].map((r, i) => ({ root: r, tones: voiced(r, i === 0 || i === 2 || i === 4) })),
  },
  scale: { major: [62, 64, 65, 67, 69, 71, 72, 74, 76], minor: [62, 64, 65, 67, 69, 70, 72, 74, 77] },
  rhythms: SLOW_RHYTHMS,
  step(k, s) {
    const { t, inBar, chord, intensity: n, section } = s;
    if (inBar === 0) k.pad(chord.tones.map((m) => m - 12), t, s.s16 * 16, 0.009, 'triangle', 1400, 0.6);
    // Spiccato string ostinato on 8ths: root, root, fifth, root, octave...
    if (inBar % 2 === 0) {
      const pat = [0, 0, 7, 0, 12, 7, 0, 7];
      k.string(chord.root + 12 + pat[inBar / 2], t, s.s16 * 1.2, n === 0 ? 0.02 : 0.03);
    }
    if (n >= 1 && !(section === 3 && n < 2)) {
      const hits: Record<number, number> = { 0: 0.24, 3: 0.12, 6: 0.16, 8: 0.22, 11: 0.12, 14: 0.15 };
      if (hits[inBar] !== undefined) k.taiko(t, hits[inBar]);
      if (n >= 2 && s.bar % 2 === 1 && inBar >= 12) k.snare(t, 0.03 + (inBar - 12) * 0.012, 0.08);
    }
    if (n >= 2) {
      if (inBar === 0 || inBar === 6) k.stab(chord.tones, t, 0.028, inBar === 0 ? 0.45 : 0.25);
      if (s.barOf8 === 0 && inBar === 0) k.crash(t, 0.03);
    }
    for (const [, len, m] of s.lead) {
      if (n >= 2) k.lead(m, t, len * s.s16, 0.03, 'sawtooth', 1700);
      else if (n === 1) k.lead(m - 12, t, len * s.s16, 0.02, 'triangle', 1500);
    }
  },
};

const chip: StyleDef = {
  bpm: 150,
  swing: 0,
  prog: {
    major: [38, 35, 43, 45, 38, 35, 40, 45].map((r, i) => ({ root: r, tones: voiced(r, i === 1 || i === 5 || i === 6) })),
    minor: [38, 46, 36, 45, 38, 46, 43, 45].map((r, i) => ({ root: r, tones: voiced(r, i === 0 || i === 4 || i === 6) })),
  },
  scale: { major: [74, 76, 78, 79, 81, 83, 85, 86, 88], minor: [74, 76, 77, 79, 81, 82, 84, 86, 88] },
  rhythms: FAST_RHYTHMS,
  step(k, s) {
    const { t, inBar, chord, intensity: n, section } = s;
    if (inBar % 2 === 0) k.bass(chord.root + (inBar % 4 === 2 ? 12 : 0), t, s.s16 * 1.6, 0.07, 'triangle');
    if (n >= 1) k.pluck(chord.tones[inBar % 3] + 12, t, s.s16 * 0.8, 0.012, 'square', 6000);
    if (n >= 1 && !(section === 3 && n < 2)) {
      if (inBar % 4 === 0) k.kick(t, 0.18, 180, 50, 0.08);
      if (inBar === 4 || inBar === 12) k.snare(t, 0.06, 0.08);
      if (inBar % 2 === 0 || n >= 2) k.hat(t, 0.012);
    }
    for (const [, len, m] of s.lead) {
      if (n >= 1) k.lead(m, t, len * s.s16 * 0.9, n >= 2 ? 0.026 : 0.018, 'square', 5000);
      else if (inBar % 8 === 0) k.lead(m, t, len * s.s16 * 0.9, 0.012, 'triangle', 3000);
    }
  },
};

const chill: StyleDef = {
  bpm: 96,
  swing: 0.12,
  prog: DREAMY,
  scale: PENTA,
  rhythms: SLOW_RHYTHMS,
  step(k, s) {
    const { t, inBar, chord, intensity: n, section } = s;
    if (inBar === 0) k.pad(chord.tones, t, s.s16 * 16, 0.007, 'sawtooth', 1100, 0.8);
    if (n >= 1 || section > 0) {
      if (inBar === 0) k.bass(chord.root, t, s.s16 * 6, 0.11);
      if (inBar === 8) k.bass(chord.root, t, s.s16 * 5, 0.09);
      if (inBar === 14) k.bass(chord.root + 12, t, s.s16 * 2, 0.05);
    }
    if (n >= 1 && section !== 3) {
      if (inBar === 0 || inBar === 10) k.kick(t, 0.2);
      if (inBar === 4 || inBar === 12) k.snare(t, 0.04, 0.16);
      if (inBar % 2 === 0) k.hat(t, 0.012);
    }
    for (const [, len, m] of s.lead) {
      if (section === 3 && Math.random() < 0.6) continue;
      k.mallet(n === 0 ? m - 12 : m, t, len * s.s16, 0.055);
    }
  },
};

const STYLES: Record<MusicStyle, StyleDef> = { arcade, dnb, battle, chip, chill };

// ------------------------------------------------------------------ engine

function writePhrase(style: StyleDef, mode: Mode, chords: Chord[], endBar: number): Note[] {
  const scale = style.scale[mode];
  const rhythm = style.rhythms[Math.floor(Math.random() * style.rhythms.length)];
  let idx = 3 + Math.floor(Math.random() * 3);
  return rhythm.map(([start, length], i) => {
    if (i === rhythm.length - 1) {
      // End the phrase on a note of the chord underneath.
      const chord = chords[endBar % chords.length];
      const pcs = new Set(chord.tones.map((m) => m % 12));
      const options = scale.map((m, j) => [m, j] as const).filter(([m]) => pcs.has(m % 12));
      if (options.length) idx = options.reduce((a, b) => (Math.abs(b[1] - idx) < Math.abs(a[1] - idx) ? b : a))[1];
    } else {
      const r = Math.random();
      idx += r < 0.38 ? 1 : r < 0.76 ? -1 : r < 0.88 ? 2 : -2;
      idx = Math.max(0, Math.min(scale.length - 1, idx));
    }
    return [start, length, scale[idx]];
  });
}

export function startMusic(
  c: AudioContext,
  out: AudioNode,
  o: { style: MusicStyle; mood: () => Mode; intensity: () => number },
): { stop: () => void } {
  const style = STYLES[o.style];
  const s16 = 60 / style.bpm / 4;
  const kit = new Kit(c, out, s16 * 3);

  let mode: Mode = o.mood();
  let chords = style.prog[mode];
  let phrases: Note[][] = [];
  const rewrite = () => {
    const a = writePhrase(style, mode, chords, 1);
    const b = writePhrase(style, mode, chords, 5);
    const end = writePhrase(style, mode, chords, 7);
    const a2 = a.map((n, i): Note => (i === a.length - 1 ? [n[0], n[1], end[end.length - 1][2]] : n));
    phrases = [a, a, b, a2];
  };
  rewrite();

  let step = 0;
  let next = c.currentTime + 0.12;
  let stopped = false;
  let level = Math.max(0, Math.min(2, Math.round(o.intensity())));
  let calmBeats = 0;

  const schedule = () => {
    if (stopped) return;
    while (next < c.currentTime + 0.25) {
      const inBar = step % 16;
      const bar = Math.floor(step / 16);
      const barOf8 = bar % 8;
      if (inBar === 0 && barOf8 === 0) {
        const m = o.mood();
        if (m !== mode || bar % 32 === 0) {
          mode = m;
          chords = style.prog[mode];
          rewrite();
        }
      }
      // Intensity: rise on the next beat, fall only after 4 calm bars.
      if (inBar % 4 === 0) {
        const want = Math.max(0, Math.min(2, Math.round(o.intensity())));
        if (want > level) {
          level = want;
          calmBeats = 0;
        } else if (want < level) {
          calmBeats++;
          if (calmBeats >= 16) {
            level--;
            calmBeats = 0;
          }
        } else calmBeats = 0;
      }
      const phrase = phrases[Math.floor(barOf8 / 2)];
      const pStep = (barOf8 % 2) * 16 + inBar;
      style.step(kit, {
        t: next + (step % 2 === 1 ? style.swing * s16 : 0),
        s16,
        inBar,
        bar,
        barOf8,
        section: Math.floor(bar / 8) % 4,
        chord: chords[barOf8 % chords.length],
        intensity: level,
        lead: phrase.filter((n) => n[0] === pStep),
      });
      next += s16;
      step++;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 50);
  return {
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
      kit.fadeOut();
    },
  };
}
