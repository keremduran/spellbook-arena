/**
 * Generative background music (Web Audio, no files). A relaxed adventure groove at 96 bpm:
 * warm detuned pads, a round bass, a kalimba-like lead that plays real phrases (repeated and
 * varied, not a loop of arpeggios), soft brushed drums with a little swing, all through a
 * shared reverb. Songs move through intro → groove → lift → breakdown sections every 8 bars,
 * and a new melody is written every 32 bars. `mood` flips the harmony to a minor version.
 */

type Mode = 'major' | 'minor';

interface Chord {
  /** Bass note (MIDI). */
  root: number;
  /** Pad voicing (MIDI). */
  tones: number[];
}

const PROG: Record<Mode, Chord[]> = {
  // D: Dmaj7 Bm7 Gmaj7 A6 | Em7 Gmaj7 D/F# A7
  major: [
    { root: 38, tones: [62, 66, 69, 73] }, { root: 35, tones: [62, 66, 69, 71] },
    { root: 43, tones: [62, 66, 67, 71] }, { root: 45, tones: [61, 64, 66, 69] },
    { root: 40, tones: [62, 64, 67, 71] }, { root: 43, tones: [62, 66, 67, 71] },
    { root: 42, tones: [61, 66, 69, 73] }, { root: 45, tones: [61, 64, 67, 69] },
  ],
  // D minor: Dm9 Bbmaj7 Gm7 A7 | Dm7 Fmaj7 Gm7 A7
  minor: [
    { root: 38, tones: [64, 65, 69, 72] }, { root: 34, tones: [62, 65, 69, 70] },
    { root: 43, tones: [62, 65, 67, 70] }, { root: 45, tones: [61, 64, 67, 69] },
    { root: 38, tones: [60, 62, 65, 69] }, { root: 41, tones: [64, 65, 69, 72] },
    { root: 43, tones: [62, 65, 67, 70] }, { root: 45, tones: [61, 64, 67, 69] },
  ],
};
/** Melody scales (pentatonic, so any note sits nicely over the chords). */
const SCALE: Record<Mode, number[]> = {
  major: [69, 71, 74, 76, 78, 81, 83, 86],
  minor: [69, 72, 74, 77, 79, 81, 84, 86],
};
/** Two-bar rhythms for the lead: [start step, length in 16ths]. */
const RHYTHMS: [number, number][][] = [
  [[0, 3], [4, 2], [6, 2], [8, 6], [16, 2], [18, 2], [20, 8]],
  [[0, 2], [2, 2], [4, 4], [10, 2], [12, 4], [16, 6], [24, 6]],
  [[2, 2], [4, 2], [6, 6], [12, 2], [14, 2], [16, 10]],
  [[0, 6], [6, 2], [8, 4], [14, 2], [16, 4], [20, 2], [22, 8]],
];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export function startMusic(c: AudioContext, out: AudioNode, mood: () => Mode): { stop: () => void } {
  const bpm = 96;
  const s16 = 60 / bpm / 4;
  const swing = s16 * 0.12;

  // ---- shared effects: reverb (generated impulse) and a soft echo for the lead
  const dry = c.createGain();
  dry.gain.value = 1;
  dry.connect(out);
  const verb = c.createConvolver();
  const len = Math.floor(c.sampleRate * 2.4);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  verb.buffer = ir;
  const wet = c.createGain();
  wet.gain.value = 0.32;
  verb.connect(wet).connect(out);
  const echo = c.createDelay(1);
  echo.delayTime.value = s16 * 3;
  const fb = c.createGain();
  fb.gain.value = 0.28;
  const echoTone = c.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 2200;
  echo.connect(echoTone).connect(fb).connect(echo);
  const echoOut = c.createGain();
  echoOut.gain.value = 0.35;
  echoTone.connect(echoOut).connect(dry);

  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  /** Connects a voice to the dry mix plus a reverb send. */
  const route = (node: AudioNode, send: number, toEcho = false) => {
    node.connect(dry);
    const g = c.createGain();
    g.gain.value = send;
    node.connect(g).connect(verb);
    if (toEcho) node.connect(echo);
  };

  // ---- instruments
  const pad = (tones: number[], t: number, dur: number, vol: number) => {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1300, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(800, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.8);
    g.gain.setValueAtTime(vol, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    f.connect(g);
    route(g, 0.6);
    for (const m of tones) {
      for (const det of [-8, 8]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur + 0.7);
      }
    }
  };

  const bass = (m: number, t: number, dur: number, vol: number) => {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(vol * 0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    route(g, 0.08);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz(m);
    const o2 = c.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = hz(m) * 2;
    const g2 = c.createGain();
    g2.gain.value = 0.18;
    o.connect(g);
    o2.connect(g2).connect(g);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  };

  /** Kalimba / soft mallet: sine body plus a quick bright partial. */
  const mallet = (m: number, t: number, dur: number, vol: number, echoOn: boolean) => {
    const g = c.createGain();
    const ring = Math.min(1.6, 0.35 + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    route(g, 0.5, echoOn);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz(m);
    o.connect(g);
    const p = c.createOscillator();
    p.type = 'sine';
    p.frequency.value = hz(m) * 4.02;
    const pg = c.createGain();
    pg.gain.setValueAtTime(0.25, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    p.connect(pg).connect(g);
    o.start(t);
    p.start(t);
    o.stop(t + ring + 0.05);
    p.stop(t + 0.15);
  };

  const kick = (t: number, vol: number) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g);
    route(g, 0.05);
    o.start(t);
    o.stop(t + 0.25);
  };

  const brush = (t: number, dur: number, vol: number, freq: number, type: BiquadFilterType) => {
    const src = c.createBufferSource();
    src.buffer = noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g);
    route(g, 0.25);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  };

  // ---- melody writing
  const writePhrase = (mode: Mode, chords: Chord[], bar: number): [number, number, number][] => {
    const scale = SCALE[mode];
    const rhythm = RHYTHMS[Math.floor(Math.random() * RHYTHMS.length)];
    let idx = 2 + Math.floor(Math.random() * 3);
    return rhythm.map(([start, length], i) => {
      const last = i === rhythm.length - 1;
      if (last) {
        // Land on a note of the chord under the phrase ending.
        const chord = chords[(bar + 1) % chords.length];
        const pcs = new Set(chord.tones.map((t) => t % 12));
        const options = scale.map((m, j) => [m, j] as const).filter(([m]) => pcs.has(m % 12));
        if (options.length) idx = options.reduce((a, b) => (Math.abs(b[1] - idx) < Math.abs(a[1] - idx) ? b : a))[1];
      } else {
        const r = Math.random();
        idx += r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : -2;
        idx = Math.max(0, Math.min(scale.length - 1, idx));
      }
      return [start, length, scale[idx]];
    });
  };

  let mode: Mode = mood();
  let chords = PROG[mode];
  let phrases: [number, number, number][][] = [];
  const rewrite = () => {
    const a = writePhrase(mode, chords, 1);
    const b = writePhrase(mode, chords, 5);
    const ending = writePhrase(mode, chords, 7);
    const a2 = a.map((n, i): [number, number, number] => (i === a.length - 1 ? [n[0], n[1], ending[ending.length - 1][2]] : n));
    // A A B A' over 8 bars (each phrase is 2 bars).
    phrases = [a, a, b, a2];
  };
  rewrite();

  let step = 0;
  let next = c.currentTime + 0.15;
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    while (next < c.currentTime + 0.3) {
      const inBar = step % 16;
      const bar = Math.floor(step / 16);
      const barOf8 = bar % 8;
      const section = Math.floor(bar / 8) % 4; // 0 intro, 1 groove, 2 lift, 3 breakdown
      if (inBar === 0 && barOf8 === 0) {
        const m = mood();
        if (m !== mode || bar % 32 === 0) {
          mode = m;
          chords = PROG[mode];
          rewrite();
        }
      }
      const chord = chords[barOf8];
      const t = next + (step % 2 === 1 ? swing : 0);

      if (inBar === 0) pad(chord.tones, t, s16 * 16, section === 3 ? 0.01 : 0.007);
      if (section > 0) {
        if (inBar === 0) bass(chord.root, t, s16 * 6, 0.11);
        if (inBar === 6) bass(chord.root, t, s16 * 2, 0.07);
        if (inBar === 8) bass(chord.root + (section === 2 ? 7 : 0), t, s16 * 5, 0.09);
        if (inBar === 14) bass(chord.root + 12, t, s16 * 2, 0.05);
      }
      if (section === 1 || section === 2) {
        if (inBar === 0 || inBar === 10) kick(t, 0.22);
        if (inBar === 4 || inBar === 12) brush(t, 0.16, 0.05, 1800, 'bandpass');
        if (inBar % 2 === 0) brush(t, 0.04, 0.012 + (inBar % 4 === 2 ? 0.01 : 0), 7500, 'highpass');
      }
      // Lead: written phrases; sparse in the breakdown, an octave lower in the intro.
      const phrase = phrases[Math.floor(barOf8 / 2)];
      const pStep = (barOf8 % 2) * 16 + inBar;
      for (const [start, length, m] of phrase) {
        if (start !== pStep) continue;
        if (section === 3 && Math.random() < 0.6) continue;
        mallet(section === 0 ? m - 12 : m, t, length * s16, section === 2 ? 0.075 : 0.06, true);
      }
      // Lift section: a soft counter-line of chord tones on the off-beats.
      if (section === 2 && inBar % 4 === 2) mallet(chord.tones[(inBar / 2) % chord.tones.length] + 12, t, s16, 0.02, false);

      next += s16;
      step++;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 80);
  return {
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
      const now = c.currentTime;
      dry.gain.setTargetAtTime(0, now, 0.2);
      wet.gain.setTargetAtTime(0, now, 0.2);
      window.setTimeout(() => {
        dry.disconnect();
        wet.disconnect();
      }, 1500);
    },
  };
}
