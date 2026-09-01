// Tiny WebAudio synth — no samples, just the bleeps a vector cabinet would make.

export class Audio {
  constructor() { this.ctx = null; this.master = null; this.enabled = true; }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise();
    // engine bed
    this.rumble = this.ctx.createOscillator();
    this.rumbleGain = this.ctx.createGain();
    this.rumble.type = 'sawtooth';
    this.rumble.frequency.value = 46;
    this.rumbleGain.gain.value = 0;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 240;
    this.rumble.connect(this.rumbleGain).connect(lp).connect(this.master);
    this.rumble.start();
  }

  makeNoise() {
    const n = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  resume() { this.ctx?.resume?.(); }

  tone(freq, dur, type = 'square', gain = 0.2, sweep = 0) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, gain = 0.3, freq = 900, q = 1) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  laser() { this.tone(760, 0.11, 'square', 0.10, 0.25); }
  turret() { this.tone(430, 0.09, 'square', 0.055, 0.4); }
  rail() { this.tone(180, 0.35, 'sawtooth', 0.16, 0.15); this.noise(0.2, 0.15, 1800); }
  hit() { this.noise(0.12, 0.16, 1500, 2); }
  explode() { this.noise(0.75, 0.42, 700, 0.7); this.tone(70, 0.5, 'sawtooth', 0.14, 0.3); }
  scoop() { this.tone(880, 0.07, 'sine', 0.10, 1.6); this.tone(1320, 0.09, 'sine', 0.07, 1.4); }
  beep(up = true) { this.tone(up ? 1200 : 500, 0.05, 'square', 0.06, up ? 1.4 : 0.7); }
  alarm() { this.tone(300, 0.3, 'square', 0.09, 0.6); }
  dock() { this.tone(300, 0.16, 'sine', 0.12, 1.6); setTimeout(() => this.tone(600, 0.22, 'sine', 0.12, 1.4), 130); }

  setThrust(v) {
    if (!this.rumbleGain) return;
    const t = this.ctx.currentTime;
    this.rumbleGain.gain.setTargetAtTime(Math.abs(v) * 0.10, t, 0.12);
    this.rumble.frequency.setTargetAtTime(40 + Math.abs(v) * 34, t, 0.2);
  }

  toggle() { this.enabled = !this.enabled; if (this.master) this.master.gain.value = this.enabled ? 0.32 : 0; return this.enabled; }
}
