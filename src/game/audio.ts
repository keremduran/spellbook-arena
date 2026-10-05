/**
 * Synthesized sound effects (Web Audio, no asset files). Every sound is built from
 * oscillators and filtered noise so the game ships with zero audio downloads.
 */

export type SfxName =
  | 'swing' | 'shoot' | 'towerShot' | 'towerShotAlly' | 'towerHitMe' | 'hit' | 'crit'
  | 'bolt' | 'zap' | 'boom' | 'bigBoom' | 'whoosh' | 'blink' | 'heal' | 'shield' | 'buff' | 'stun' | 'ult'
  | 'death' | 'kill' | 'allyDown' | 'levelUp' | 'boon' | 'structure' | 'click' | 'victory' | 'defeat' | 'announce' | 'rune';

const PREFS_KEY = 'spellbook-audio';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<string, number>();
  private music: { stop: () => void } | null = null;
  sfxOn = true;
  musicOn = true;

  constructor() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
      if (typeof p.sfx === 'boolean') this.sfxOn = p.sfx;
      if (typeof p.music === 'boolean') this.musicOn = p.music;
    } catch {
      // storage blocked; keep defaults
    }
  }

  /** Must be called from a user gesture (browsers block audio before one). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.5 : 0;
    this.musicBus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private save() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sfx: this.sfxOn, music: this.musicOn }));
    } catch {
      // ignore
    }
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.05);
    this.save();
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.2);
    this.save();
  }

  // ------------------------------------------------------------------ building blocks

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; to?: number; delay?: number; attack?: number } = {}) {
    const c = this.ctx!;
    const t = c.currentTime + (opts.delay ?? 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t + dur);
    const vol = opts.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(dur: number, opts: { filter?: BiquadFilterType; freq?: number; to?: number; q?: number; vol?: number; delay?: number } = {}) {
    const c = this.ctx!;
    const t = c.currentTime + (opts.delay ?? 0);
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = opts.filter ?? 'lowpass';
    f.frequency.setValueAtTime(opts.freq ?? 1200, t);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.to), t + dur);
    f.Q.value = opts.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(opts.vol ?? 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Current output for the sound being built (lets play() scale volume by distance). */
  private out!: AudioNode;

  /**
   * Plays a sound. `gain` scales it (use it for distance falloff). Each sound has a short
   * cooldown so 10 heroes casting at once doesn't turn into noise.
   */
  play(name: SfxName, gain = 1) {
    if (!this.ctx || !this.sfxOn || gain < 0.04) return;
    const now = this.ctx.currentTime;
    const minGap: Partial<Record<SfxName, number>> = { swing: 0.06, shoot: 0.06, hit: 0.05, towerShot: 0.12, towerShotAlly: 0.12, towerHitMe: 0.3, bolt: 0.05, zap: 0.08, boom: 0.08, death: 0.1 };
    if (now - (this.last.get(name) ?? -1) < (minGap[name] ?? 0.03)) return;
    this.last.set(name, now);
    const bus = this.ctx.createGain();
    bus.gain.value = Math.min(1, gain);
    bus.connect(this.sfxBus);
    this.out = bus;
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    switch (name) {
      case 'swing':
        this.hiss(0.12, { filter: 'bandpass', freq: r(1800, 2600), to: 500, q: 2, vol: 0.35 });
        break;
      case 'shoot':
        this.tone(r(900, 1100), 0.09, { type: 'triangle', to: 380, vol: 0.12 });
        break;
      case 'towerShot':
        // Enemy tower: low, growling thump.
        this.tone(160, 0.3, { type: 'sawtooth', to: 45, vol: 0.14 });
        this.tone(110, 0.3, { type: 'square', to: 40, vol: 0.06 });
        this.hiss(0.22, { freq: 700, to: 150, vol: 0.15 });
        break;
      case 'towerShotAlly':
        // Allied tower: bright, rising zing.
        this.tone(660, 0.16, { type: 'triangle', to: 1320, vol: 0.1 });
        this.tone(990, 0.12, { type: 'sine', to: 1760, vol: 0.06, delay: 0.03 });
        this.hiss(0.1, { filter: 'highpass', freq: 3000, vol: 0.08 });
        break;
      case 'towerHitMe':
        // An enemy tower is shooting you: short warning beeps.
        this.tone(880, 0.07, { type: 'square', vol: 0.09 });
        this.tone(660, 0.09, { type: 'square', vol: 0.09, delay: 0.09 });
        break;
      case 'hit':
        this.hiss(0.06, { filter: 'bandpass', freq: r(500, 900), q: 1.5, vol: 0.35 });
        this.tone(140, 0.08, { to: 60, vol: 0.2 });
        break;
      case 'crit':
        this.hiss(0.1, { filter: 'highpass', freq: 2500, vol: 0.3 });
        this.tone(180, 0.16, { type: 'square', to: 50, vol: 0.18 });
        break;
      case 'bolt':
        this.hiss(0.35, { filter: 'bandpass', freq: 600, to: 2400, q: 1.2, vol: 0.3 });
        this.tone(320, 0.25, { type: 'sawtooth', to: 140, vol: 0.06 });
        break;
      case 'zap':
        for (let i = 0; i < 3; i++) this.tone(r(1500, 2600), 0.05, { type: 'square', to: r(300, 600), vol: 0.07, delay: i * 0.035 });
        this.hiss(0.15, { filter: 'highpass', freq: 3000, vol: 0.12 });
        break;
      case 'boom':
        this.hiss(0.45, { freq: 1400, to: 90, vol: 0.5 });
        this.tone(110, 0.35, { to: 38, vol: 0.4 });
        break;
      case 'bigBoom':
        this.hiss(1.1, { freq: 1800, to: 60, vol: 0.6 });
        this.tone(80, 0.9, { to: 28, vol: 0.55 });
        this.tone(55, 1.1, { type: 'triangle', to: 25, vol: 0.4, delay: 0.05 });
        break;
      case 'whoosh':
        this.hiss(0.3, { filter: 'bandpass', freq: 400, to: 3000, q: 0.8, vol: 0.35 });
        break;
      case 'blink':
        this.tone(600, 0.18, { type: 'sine', to: 2400, vol: 0.15 });
        this.tone(1200, 0.2, { type: 'triangle', to: 300, vol: 0.08, delay: 0.08 });
        break;
      case 'heal':
        [523, 659, 784].forEach((f, i) => this.tone(f, 0.45, { type: 'sine', vol: 0.12, delay: i * 0.06, attack: 0.04 }));
        break;
      case 'shield':
        this.tone(330, 0.5, { type: 'triangle', to: 660, vol: 0.12, attack: 0.05 });
        this.tone(495, 0.5, { type: 'sine', vol: 0.08, attack: 0.08 });
        break;
      case 'buff':
        this.tone(220, 0.3, { type: 'sawtooth', to: 440, vol: 0.09, attack: 0.03 });
        this.tone(330, 0.3, { type: 'square', to: 660, vol: 0.05, attack: 0.03 });
        break;
      case 'stun':
        this.tone(90, 0.3, { type: 'square', to: 45, vol: 0.25 });
        this.hiss(0.25, { freq: 500, to: 120, vol: 0.35 });
        break;
      case 'ult':
        this.tone(110, 0.9, { type: 'sawtooth', to: 220, vol: 0.12, attack: 0.1 });
        this.tone(165, 0.9, { type: 'sawtooth', to: 330, vol: 0.08, attack: 0.1 });
        this.hiss(0.9, { filter: 'bandpass', freq: 300, to: 2500, vol: 0.2 });
        break;
      case 'death':
        this.tone(300, 0.5, { type: 'triangle', to: 70, vol: 0.18 });
        this.hiss(0.3, { freq: 800, to: 100, vol: 0.2 });
        break;
      case 'kill':
        this.tone(659, 0.12, { type: 'square', vol: 0.1 });
        this.tone(988, 0.25, { type: 'square', vol: 0.1, delay: 0.1 });
        break;
      case 'allyDown':
        this.tone(392, 0.2, { type: 'triangle', vol: 0.14 });
        this.tone(262, 0.4, { type: 'triangle', vol: 0.14, delay: 0.16 });
        break;
      case 'levelUp':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.25, { type: 'triangle', vol: 0.13, delay: i * 0.07 }));
        break;
      case 'boon':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.4, { type: 'sine', vol: 0.1, delay: i * 0.05, attack: 0.02 }));
        this.hiss(0.6, { filter: 'highpass', freq: 5000, vol: 0.06 });
        break;
      case 'structure':
        this.play('bigBoom', gain);
        [196, 147, 98].forEach((f, i) => this.tone(f, 0.5, { type: 'sawtooth', vol: 0.08, delay: 0.2 + i * 0.18 }));
        break;
      case 'announce':
        this.tone(196, 0.5, { type: 'sawtooth', vol: 0.1 });
        [392, 494, 587, 784].forEach((f, i) => this.tone(f, i === 3 ? 0.6 : 0.16, { type: 'square', vol: 0.09, delay: 0.05 + i * 0.09 }));
        this.hiss(0.5, { filter: 'highpass', freq: 4000, vol: 0.08, delay: 0.3 });
        break;
      case 'rune':
        [523, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.5, { type: 'sine', vol: 0.09, delay: i * 0.04, attack: 0.02 }));
        this.tone(130, 0.7, { type: 'triangle', to: 260, vol: 0.15 });
        break;
      case 'click':
        this.tone(1200, 0.04, { type: 'square', vol: 0.05 });
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i === 3 ? 0.9 : 0.25, { type: 'triangle', vol: 0.16, delay: i * 0.14 }));
        break;
      case 'defeat':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, i === 3 ? 0.9 : 0.3, { type: 'triangle', vol: 0.15, delay: i * 0.2 }));
        break;
    }
  }

  // ------------------------------------------------------------------ music

  /** A slow generative pad with a soft pulse: unobtrusive background for long matches. */
  startMusic() {
    if (!this.ctx || this.music) return;
    const c = this.ctx;
    const chords = [[110, 164.8, 220, 261.6], [98, 146.8, 196, 246.9], [87.3, 130.8, 174.6, 220], [98, 146.8, 196, 233.1]];
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.connect(this.musicBus);
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 300;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    let step = 0;
    let stopped = false;
    const bar = 4.8;
    const playChord = () => {
      if (stopped) return;
      const t = c.currentTime;
      const notes = chords[step % chords.length];
      for (const f of notes) {
        for (const detune of [-6, 6]) {
          const o = c.createOscillator();
          const g = c.createGain();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = detune;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.022, t + 1.2);
          g.gain.exponentialRampToValueAtTime(0.0001, t + bar + 0.8);
          o.connect(g).connect(filter);
          o.start(t);
          o.stop(t + bar + 1);
        }
      }
      // Soft heartbeat pulse on the root.
      for (let i = 0; i < 4; i++) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.frequency.value = notes[0] / 2;
        const tt = t + i * (bar / 4);
        g.gain.setValueAtTime(0.0001, tt);
        g.gain.exponentialRampToValueAtTime(0.09, tt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.5);
        o.connect(g).connect(this.musicBus);
        o.start(tt);
        o.stop(tt + 0.6);
      }
      step++;
    };
    playChord();
    const timer = window.setInterval(playChord, bar * 1000);
    this.music = {
      stop: () => {
        stopped = true;
        window.clearInterval(timer);
        lfo.stop();
        filter.disconnect();
      },
    };
  }

  stopMusic() {
    this.music?.stop();
    this.music = null;
  }
}

export const sfx = new Sfx();

/** Which sound an ability makes when cast. */
export function castSound(abilityId: string, tags: string[], kind: string): SfxName {
  if (kind === 'ult') {
    if (['inferno', 'meteor_shower', 'earthquake'].includes(abilityId)) return 'ult';
    if (abilityId === 'time_warp' || abilityId === 'resurgence') return 'shield';
    return 'ult';
  }
  if (abilityId === 'chain_lightning') return 'zap';
  if (abilityId === 'blink' || abilityId === 'shadow_veil') return 'blink';
  if (tags.includes('heal')) return 'heal';
  if (tags.includes('shield')) return 'shield';
  if (tags.includes('mobility')) return 'whoosh';
  if (tags.includes('attack speed') || tags.includes('movement speed') || tags.includes('on-hit')) return 'buff';
  if (tags.includes('stun')) return 'stun';
  if (tags.includes('area')) return 'whoosh';
  return 'bolt';
}
