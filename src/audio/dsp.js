// Small offline DSP toolkit used to synthesise all game sounds into sample buffers.
export const TAU = Math.PI * 2;

// RBJ cookbook biquad filter (direct form I).
export class Biquad {
  constructor(type, freq, q = 0.707, sr = 44100, gainDb = 0) {
    this.type = type;
    this.sr = sr;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    this.set(freq, q, gainDb);
  }

  set(freq, q = this.q, gainDb = this.gainDb || 0) {
    this.q = q;
    this.gainDb = gainDb;
    const f = Math.max(10, Math.min(freq, this.sr * 0.45));
    const w0 = (TAU * f) / this.sr;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const A = 10 ** (gainDb / 40);
    let b0; let b1; let b2; let a0; let a1; let a2;
    switch (this.type) {
      case 'lowpass':
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'highpass':
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; break;
      case 'peaking':
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; break;
      default:
        throw new Error('unknown filter ' + this.type);
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  tick(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  run(buf, from = 0, to = buf.length) {
    for (let i = from; i < to; i++) buf[i] = this.tick(buf[i]);
    return buf;
  }
}

export function buf(sr, seconds) {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

// Pink noise (Paul Kellet's refined method).
export class Pink {
  constructor(rand) {
    this.rand = rand;
    this.b = [0, 0, 0, 0, 0, 0, 0];
  }

  next() {
    const w = this.rand() * 2 - 1;
    const b = this.b;
    b[0] = 0.99886 * b[0] + w * 0.0555179;
    b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.969 * b[2] + w * 0.153852;
    b[3] = 0.8665 * b[3] + w * 0.3104856;
    b[4] = 0.55 * b[4] + w * 0.5329522;
    b[5] = -0.7616 * b[5] - w * 0.016898;
    const out = b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362;
    b[6] = w * 0.115926;
    return out * 0.11;
  }
}

export class Brown {
  constructor(rand) {
    this.rand = rand;
    this.y = 0;
  }

  next() {
    this.y = (this.y + (this.rand() * 2 - 1) * 0.02) * 0.998;
    return this.y * 3.5;
  }
}

// Band-limited sawtooth (polyBLEP) with a variable frequency.
export class Saw {
  constructor(sr, phase = 0) {
    this.sr = sr;
    this.phase = phase;
  }

  next(freq) {
    const dt = freq / this.sr;
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    const t = this.phase;
    let v = 2 * t - 1;
    if (t < dt) {
      const x = t / dt;
      v -= x + x - x * x - 1;
    } else if (t > 1 - dt) {
      const x = (t - 1) / dt;
      v -= x * x + x + x + 1;
    }
    return v;
  }
}

// A short burst of filtered noise ("grain") mixed into `out`. Used for crunches, rustles, crackles.
export function grain(out, sr, t0, dur, freq, q, amp, rand, type = 'bandpass', attack = 0.0008) {
  const start = Math.floor(t0 * sr);
  const n = Math.floor(dur * sr);
  const f = new Biquad(type, freq, q, sr);
  const a = Math.max(1, Math.floor(attack * sr));
  for (let i = 0; i < n && start + i < out.length; i++) {
    const env = i < a ? i / a : Math.exp(-((i - a) / n) * 5);
    out[start + i] += f.tick(rand() * 2 - 1) * env * amp;
  }
}

// Exponentially decaying sine, optionally gliding in pitch.
export function ping(out, sr, t0, freq, decay, amp, freqEnd = freq, attack = 0.001) {
  const start = Math.floor(t0 * sr);
  const n = Math.min(out.length - start, Math.floor(decay * 7 * sr));
  let phase = 0;
  const a = Math.max(1, Math.floor(attack * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = freq * (freqEnd / freq) ** Math.min(1, t / (decay * 2));
    phase += (TAU * f) / sr;
    const env = (i < a ? i / a : 1) * Math.exp(-t / decay);
    out[start + i] += Math.sin(phase) * env * amp;
  }
}

// Noise shaped by an envelope and passed through a (possibly sweeping) filter.
export function noiseShape(out, sr, rand, { from = 0, dur, attack = 0.002, decay = 0.1, type = 'bandpass', freq = 1000, freqEnd = freq, q = 1, amp = 1, color = 'white', hold = 0 }) {
  const start = Math.floor(from * sr);
  const n = Math.min(out.length - start, Math.floor((dur ?? attack + hold + decay * 6) * sr));
  const f = new Biquad(type, freq, q, sr);
  const src = color === 'pink' ? new Pink(rand) : color === 'brown' ? new Brown(rand) : null;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if ((i & 31) === 0 && freqEnd !== freq) f.set(freq * (freqEnd / freq) ** Math.min(1, t / (dur ?? decay * 3)), q);
    let env;
    if (t < attack) env = t / attack;
    else if (t < attack + hold) env = 1;
    else env = Math.exp(-(t - attack - hold) / decay);
    const s = src ? src.next() : rand() * 2 - 1;
    out[start + i] += f.tick(s) * env * amp;
  }
}

// Vowel formant table (F1, F2, F3 in Hz).
export const VOWELS = {
  a: [800, 1200, 2500],
  e: [500, 1850, 2500],
  i: [320, 2300, 3000],
  o: [480, 850, 2400],
  u: [350, 750, 2300],
  uh: [600, 1100, 2400],
  m: [250, 1100, 2300],
  n: [300, 1500, 2600],
};

function lerpV(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Formant voice synthesiser: glottal saw + breath through three resonances.
// f0(t), vowel(t) -> [F1,F2,F3], amp(t) are functions of time in seconds (0..dur).
export function voice(sr, dur, rand, { f0, vowel, amp, breath = 0.1, jitter = 0.01, rough = 0, bw = [80, 110, 160], nasal = 0 }) {
  const out = buf(sr, dur);
  const saw = new Saw(sr, rand());
  const f1 = new Biquad('bandpass', 500, 5, sr);
  const f2 = new Biquad('bandpass', 1500, 8, sr);
  const f3 = new Biquad('bandpass', 2500, 10, sr);
  const body = new Biquad('lowpass', 900, 0.7, sr);
  const nas = new Biquad('peaking', 250, 1.5, sr, 8);
  let jit = 0;
  let roughPhase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    if ((i & 63) === 0) {
      const v = vowel(t);
      f1.set(v[0], v[0] / bw[0]);
      f2.set(v[1], v[1] / bw[1]);
      f3.set(v[2], v[2] / bw[2]);
      jit += (rand() * 2 - 1) * jitter;
      jit *= 0.9;
    }
    const f = f0(t) * (1 + jit);
    let s = saw.next(f) * (1 - breath) + (rand() * 2 - 1) * breath;
    if (rough > 0) {
      roughPhase += (TAU * f * 0.5) / sr;
      s *= 1 - rough * (0.5 + 0.5 * Math.sin(roughPhase));
    }
    let y = f1.tick(s) * 1.0 + f2.tick(s) * 0.55 + f3.tick(s) * 0.22 + body.tick(s) * 0.25;
    if (nasal > 0) y = y * (1 - nasal) + nas.tick(y) * nasal;
    out[i] = y * amp(t);
  }
  return out;
}

export { lerpV };

export function highpass(out, sr, freq) {
  return new Biquad('highpass', freq, 0.707, sr).run(out);
}

export function lowpass(out, sr, freq, q = 0.707) {
  return new Biquad('lowpass', freq, q, sr).run(out);
}

// Scales to the given peak and applies tiny fades to avoid clicks.
export function finish(out, sr, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < out.length; i++) {
    const v = Math.abs(out[i]);
    if (v > max) max = v;
  }
  const g = max > 0 ? peak / max : 0;
  const fin = Math.min(out.length, Math.floor(sr * 0.002));
  const fout = Math.min(out.length, Math.floor(sr * 0.01));
  for (let i = 0; i < out.length; i++) {
    let e = 1;
    if (i < fin) e = i / fin;
    const j = out.length - 1 - i;
    if (j < fout) e *= j / fout;
    out[i] *= g * e;
  }
  return out;
}

// Soft saturation.
export function saturate(out, drive = 1.5) {
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * drive);
  return out;
}

// Makes a buffer loop seamlessly by cross-fading its tail into its head. Returns the shortened buffer.
export function makeLoop(src, sr, fade = 0.5) {
  const n = Math.floor(fade * sr);
  const len = src.length - n;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = src[i];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = src[i] * Math.sqrt(t) + src[len + i] * Math.sqrt(1 - t);
  }
  return out;
}

// Stereo reverb impulse response: early reflections + exponentially decaying, darkening noise tail.
export function impulseResponse(sr, seconds, rand, { decay = 3, damping = 0.4, early = 6 } = {}) {
  const ch = [buf(sr, seconds), buf(sr, seconds)];
  for (const c of ch) {
    let lp = 0;
    for (let i = 0; i < c.length; i++) {
      const t = i / sr;
      const k = Math.min(0.97, damping * 0.1 + (t / seconds) * damping);
      lp = lp * k + (rand() * 2 - 1) * (1 - k);
      c[i] = lp * Math.exp((-t * decay) / seconds * 2) * (t < 0.01 ? t / 0.01 : 1);
    }
    for (let e = 0; e < early; e++) {
      const at = Math.floor((0.008 + rand() * 0.06) * sr);
      c[at] += (rand() < 0.5 ? -1 : 1) * (0.5 - e * 0.05);
    }
  }
  return ch;
}
