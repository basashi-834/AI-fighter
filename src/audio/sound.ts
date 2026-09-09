/**
 * 効果音と音楽。すべて Web Audio でその場で合成しています。
 *
 * 音のファイルを 1 つも置かないので、読み込み待ちがありません。
 * 「打撃は短いノイズ + 低い音」「ガードは高い金属音」のように、
 * 波形の組み合わせで作り分けています。
 */

export type Sfx =
  | 'hit_light'
  | 'hit_medium'
  | 'hit_heavy'
  | 'block'
  | 'swing_l'
  | 'swing_m'
  | 'swing_h'
  | 'fire'
  | 'shout'
  | 'grab'
  | 'jump'
  | 'land'
  | 'dash'
  | 'ko'
  | 'super'
  | 'menu'
  | 'select'
  | 'counter';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  enabled = true;
  masterVolume = 0.7;
  musicVolume = 0.34;
  sfxVolume = 0.85;

  /** 音は「ユーザーが何か操作したあと」でないと鳴らせない決まりがある。 */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(this.master);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);

    // ノイズ（打撃音の芯に使う）。
    const len = this.ctx.sampleRate * 0.4;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.masterVolume = master;
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (this.master) this.master.gain.value = master;
    if (this.musicGain) this.musicGain.gain.value = music;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slideTo?: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterFreq: number, q = 1, delay = 0): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  play(sfx: Sfx): void {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    switch (sfx) {
      case 'hit_light':
        this.noise(0.07, 0.5, 1800, 1.2);
        this.tone(220, 0.07, 'square', 0.16, 120);
        break;
      case 'hit_medium':
        this.noise(0.11, 0.6, 1100, 1.0);
        this.tone(150, 0.12, 'square', 0.2, 70);
        break;
      case 'hit_heavy':
        this.noise(0.2, 0.7, 700, 0.9);
        this.tone(90, 0.24, 'sawtooth', 0.26, 42);
        this.tone(58, 0.3, 'sine', 0.3, 30);
        break;
      case 'counter':
        this.tone(880, 0.1, 'square', 0.18, 1500);
        this.noise(0.16, 0.5, 2600, 2);
        break;
      case 'block':
        this.noise(0.09, 0.35, 3600, 3);
        this.tone(1300, 0.07, 'square', 0.1, 900);
        break;
      case 'swing_l':
        this.noise(0.06, 0.16, 2600, 2.4);
        break;
      case 'swing_m':
        this.noise(0.09, 0.2, 1700, 2);
        break;
      case 'swing_h':
        this.noise(0.13, 0.24, 1100, 1.6);
        break;
      case 'fire':
        this.tone(320, 0.35, 'sawtooth', 0.16, 90);
        this.noise(0.34, 0.3, 800, 0.8);
        break;
      case 'shout':
        this.tone(420, 0.16, 'square', 0.13, 260);
        this.tone(630, 0.12, 'triangle', 0.09, 400, 0.02);
        break;
      case 'grab':
        this.tone(120, 0.16, 'square', 0.2, 60);
        this.noise(0.14, 0.4, 500, 1);
        break;
      case 'jump':
        this.tone(300, 0.11, 'sine', 0.11, 620);
        break;
      case 'land':
        this.noise(0.1, 0.3, 380, 1);
        break;
      case 'dash':
        this.noise(0.13, 0.22, 1500, 1.4);
        break;
      case 'ko':
        this.tone(180, 0.7, 'sawtooth', 0.3, 44);
        this.noise(0.6, 0.5, 500, 0.6);
        break;
      case 'super':
        this.tone(180, 0.9, 'sawtooth', 0.24, 900);
        this.tone(90, 0.9, 'square', 0.18, 420);
        this.noise(0.7, 0.35, 1600, 0.8);
        break;
      case 'menu':
        this.tone(680, 0.05, 'square', 0.1, 780);
        break;
      case 'select':
        this.tone(520, 0.08, 'square', 0.13, 1040);
        this.tone(1040, 0.1, 'square', 0.08, 1560, 0.05);
        break;
    }
  }

  /* ---- BGM ---- */

  /** 単純な 4 小節ループ。戦っている最中の緊張感だけ出せればよい。 */
  startMusic(kind: 'battle' | 'menu' = 'battle'): void {
    this.ensure();
    if (!this.ctx || !this.musicGain || this.musicTimer != null) return;
    const bass = kind === 'battle'
      ? [55, 55, 65.4, 55, 49, 49, 58.3, 49]
      : [65.4, 0, 82.4, 0, 73.4, 0, 61.7, 0];
    const lead = kind === 'battle'
      ? [440, 523, 587, 523, 392, 440, 349, 392, 440, 523, 659, 587, 523, 494, 440, 392]
      : [523, 0, 659, 0, 587, 0, 494, 0, 523, 0, 440, 0, 392, 0, 440, 0];
    const stepMs = kind === 'battle' ? 145 : 210;

    const tickFn = () => {
      if (!this.ctx || !this.musicGain) return;
      const t = this.ctx.currentTime;
      const s = this.musicStep;
      const b = bass[s % bass.length];
      if (b > 0) this.musicNote(b, 0.24, 'square', 0.16, t);
      const l = lead[s % lead.length];
      if (l > 0) this.musicNote(l, 0.16, 'triangle', 0.075, t);
      if (kind === 'battle' && s % 2 === 0) this.musicDrum(t, s % 4 === 0);
      this.musicStep++;
    };
    tickFn();
    this.musicTimer = window.setInterval(tickFn, stepMs);
  }

  stopMusic(): void {
    if (this.musicTimer != null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicStep = 0;
  }

  private musicNote(freq: number, dur: number, type: OscillatorType, gain: number, t: number): void {
    if (!this.ctx || !this.musicGain) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.musicGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private musicDrum(t: number, kick: boolean): void {
    if (!this.ctx || !this.musicGain || !this.noiseBuffer) return;
    if (kick) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      g.gain.setValueAtTime(0.28, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g);
      g.connect(this.musicGain);
      o.start(t);
      o.stop(t + 0.16);
    } else {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 5000;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(f);
      f.connect(g);
      g.connect(this.musicGain);
      src.start(t);
      src.stop(t + 0.07);
    }
  }
}

export const sound = new Sound();
