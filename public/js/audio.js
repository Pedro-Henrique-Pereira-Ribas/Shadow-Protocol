// Audio procedural (WebAudio) - sem arquivos externos.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.35;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise(1.2);
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  makeNoise(sec) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  noise(dur, { freq = 1200, q = 1, gain = 0.3, type = 'bandpass', decay = null } = {}) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  tone(freq, dur, { type = 'square', gain = 0.16, slideTo = null, delay = 0 } = {}) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    const t = this.ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  shot(kind = 'pistol') {
    if (!this.enabled) return;
    switch (kind) {
      case 'pistol': this.noise(0.14, { freq: 1800, q: 0.8, gain: 0.30, decay: 0.12 }); this.tone(180, 0.09, { gain: 0.13, slideTo: 60 }); break;
      case 'smg': this.noise(0.10, { freq: 2400, q: 1.1, gain: 0.22, decay: 0.08 }); this.tone(220, 0.06, { gain: 0.10, slideTo: 90 }); break;
      case 'rifle': this.noise(0.20, { freq: 1300, q: 0.7, gain: 0.38, decay: 0.17 }); this.tone(120, 0.13, { gain: 0.18, slideTo: 45 }); break;
      case 'shotgun': this.noise(0.32, { freq: 700, q: 0.5, gain: 0.45, decay: 0.28 }); this.tone(90, 0.2, { gain: 0.2, slideTo: 35 }); break;
      case 'sniper': this.noise(0.42, { freq: 500, q: 0.4, gain: 0.5, decay: 0.38 }); this.tone(70, 0.3, { gain: 0.24, slideTo: 28 }); break;
      case 'heavy': this.noise(0.14, { freq: 1000, q: 0.9, gain: 0.34, decay: 0.12 }); this.tone(140, 0.09, { gain: 0.14, slideTo: 55 }); break;
      default: this.noise(0.14, { freq: 1600, q: 0.8, gain: 0.26, decay: 0.12 });
    }
  }

  hit(head = false) {
    this.tone(head ? 1500 : 700, 0.09, { type: 'sine', gain: 0.16, slideTo: head ? 900 : 380 });
  }

  hurt() {
    this.noise(0.22, { freq: 320, q: 0.6, gain: 0.30, decay: 0.2 });
    this.tone(120, 0.16, { type: 'sawtooth', gain: 0.12, slideTo: 60 });
  }

  reload() {
    this.noise(0.07, { freq: 900, q: 3, gain: 0.16, decay: 0.06 });
    setTimeout(() => this.noise(0.08, { freq: 600, q: 3, gain: 0.18, decay: 0.07 }), 230);
    setTimeout(() => this.noise(0.06, { freq: 1400, q: 4, gain: 0.20, decay: 0.05 }), 520);
  }

  empty() { this.noise(0.05, { freq: 2600, q: 6, gain: 0.13, decay: 0.04 }); }
  step() { this.noise(0.05, { freq: 220, q: 1.2, gain: 0.07, decay: 0.04 }); }
  pickup() { this.tone(700, 0.08, { gain: 0.12 }); this.tone(1050, 0.10, { gain: 0.12, delay: 0.07 }); }
  ui() { this.tone(520, 0.05, { type: 'sine', gain: 0.07 }); }
  kill() { this.tone(880, 0.08, { type: 'square', gain: 0.1 }); this.tone(1320, 0.1, { type: 'square', gain: 0.1, delay: 0.08 }); }
  death() { this.tone(300, 0.5, { type: 'sawtooth', gain: 0.16, slideTo: 60 }); }
  bomb() { this.noise(1.1, { freq: 300, q: 0.4, gain: 0.5, decay: 1.0 }); this.tone(80, 0.9, { gain: 0.2, slideTo: 30 }); }
  plant() { this.tone(900, 0.1, { gain: 0.12 }); this.tone(1200, 0.14, { gain: 0.12, delay: 0.1 }); }
  round() { this.tone(440, 0.16, { gain: 0.1 }); this.tone(660, 0.22, { gain: 0.1, delay: 0.16 }); }
}
