// Tiny procedural sound effects using WebAudio (no audio files needed).
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.listener = { x: 0, y: 0, z: 0 };
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  gainFor(x, y, z, base) {
    if (x === undefined) return base;
    const d = Math.hypot(x - this.listener.x, y - this.listener.y, z - this.listener.z);
    return base * Math.max(0, 1 - d / 20);
  }

  noise(dur, { freq = 1000, q = 1, type = 'bandpass', gain = 0.3, attack = 0.005, freqEnd = null } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const t = ctx.currentTime;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(dur, { freq = 440, freqEnd = null, type = 'sine', gain = 0.2, attack = 0.005, vibrato = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    if (vibrato) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = vibrato;
      lg.gain.value = freq * 0.06;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name, x, y, z, vol = 1) {
    const ctx = this.ensure();
    if (!ctx || ctx.state !== 'running' || this.volume <= 0) return;
    this.master.gain.value = this.volume;
    const g = this.gainFor(x, y, z, vol);
    if (g <= 0.01) return;
    const p = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'stone': this.noise(0.12, { freq: 900 * p, q: 1.5, gain: 0.35 * g }); break;
      case 'wood': this.noise(0.12, { freq: 500 * p, q: 3, gain: 0.35 * g }); this.tone(0.08, { freq: 180 * p, gain: 0.1 * g, type: 'triangle' }); break;
      case 'grass': this.noise(0.14, { freq: 2400 * p, q: 0.7, gain: 0.22 * g, type: 'highpass' }); break;
      case 'gravel': this.noise(0.16, { freq: 1300 * p, q: 0.8, gain: 0.3 * g }); break;
      case 'sand': this.noise(0.16, { freq: 3000 * p, q: 0.5, gain: 0.18 * g, type: 'highpass' }); break;
      case 'snow': this.noise(0.15, { freq: 3500 * p, q: 0.6, gain: 0.15 * g, type: 'highpass' }); break;
      case 'wool': this.noise(0.14, { freq: 400 * p, q: 0.8, gain: 0.25 * g, type: 'lowpass' }); break;
      case 'metal': this.noise(0.1, { freq: 2500 * p, q: 8, gain: 0.25 * g }); break;
      case 'glass':
        this.noise(0.25, { freq: 5000 * p, q: 4, gain: 0.3 * g });
        this.tone(0.2, { freq: 2200 * p, freqEnd: 1800, gain: 0.08 * g });
        break;
      case 'pop': this.tone(0.08, { freq: 900 * p, freqEnd: 1600, gain: 0.12 * g }); break;
      case 'click': this.tone(0.04, { freq: 1200, gain: 0.08 * g, type: 'square' }); break;
      case 'hurt':
        this.tone(0.18, { freq: 260 * p, freqEnd: 140, type: 'sawtooth', gain: 0.18 * g });
        this.noise(0.12, { freq: 600, q: 1, gain: 0.15 * g });
        break;
      case 'fall_small': this.noise(0.15, { freq: 300, q: 1, gain: 0.3 * g, type: 'lowpass' }); break;
      case 'fall_big': this.noise(0.3, { freq: 250, q: 1, gain: 0.45 * g, type: 'lowpass' }); break;
      case 'eat': this.noise(0.09, { freq: 1800 * p, q: 2, gain: 0.25 * g }); break;
      case 'burp': this.tone(0.3, { freq: 110, freqEnd: 80, type: 'sawtooth', gain: 0.12 * g, vibrato: 30 }); break;
      case 'break_tool': this.noise(0.25, { freq: 3000, q: 6, gain: 0.3 * g }); this.tone(0.2, { freq: 1500, freqEnd: 400, gain: 0.1 * g, type: 'square' }); break;
      case 'explode':
        this.noise(1.6, { freq: 900, freqEnd: 60, type: 'lowpass', q: 0.7, gain: 0.9 * g, attack: 0.01 });
        this.tone(0.8, { freq: 70, freqEnd: 30, type: 'sine', gain: 0.5 * g });
        break;
      case 'fuse': this.noise(1.4, { freq: 4000, q: 0.8, gain: 0.15 * g, type: 'highpass', attack: 0.2 }); break;
      case 'fizz': this.noise(0.6, { freq: 5000, q: 1, gain: 0.2 * g, type: 'highpass' }); break;
      case 'splash': this.noise(0.4, { freq: 1500, freqEnd: 400, q: 0.6, gain: 0.25 * g }); break;
      case 'bucket': this.noise(0.25, { freq: 900, freqEnd: 500, q: 2, gain: 0.2 * g }); break;
      case 'zombie': this.tone(0.9, { freq: 95 * p, freqEnd: 70, type: 'sawtooth', gain: 0.12 * g, vibrato: 7, attack: 0.1 }); break;
      case 'zombie_hurt': this.tone(0.25, { freq: 140 * p, freqEnd: 90, type: 'sawtooth', gain: 0.16 * g }); break;
      case 'pig': this.tone(0.2, { freq: 260 * p, freqEnd: 200, type: 'square', gain: 0.07 * g, vibrato: 40 }); break;
      case 'pig_hurt': this.tone(0.2, { freq: 380 * p, freqEnd: 300, type: 'square', gain: 0.08 * g, vibrato: 50 }); break;
      case 'cow': this.tone(0.8, { freq: 130 * p, freqEnd: 110, type: 'sawtooth', gain: 0.09 * g, attack: 0.15 }); break;
      case 'cow_hurt': this.tone(0.3, { freq: 170 * p, freqEnd: 130, type: 'sawtooth', gain: 0.1 * g }); break;
      case 'sheep': this.tone(0.5, { freq: 330 * p, freqEnd: 300, type: 'sawtooth', gain: 0.06 * g, vibrato: 22 }); break;
      case 'sheep_hurt': this.tone(0.25, { freq: 420 * p, freqEnd: 330, type: 'sawtooth', gain: 0.07 * g, vibrato: 25 }); break;
      case 'creeper':
        break;
      case 'creeper_hurt': this.noise(0.2, { freq: 700, q: 1, gain: 0.2 * g }); break;
      case 'door': this.noise(0.2, { freq: 400, q: 2, gain: 0.25 * g }); break;
      default:
    }
  }
}
