// Generative ambient piano music in the spirit of Minecraft's soundtrack: slow, sparse and calm.
// Piano notes are synthesised (inharmonic partials, per-partial decay, hammer noise) and cached.
import { buf, Biquad, TAU } from './dsp.js';
import { mulberry32 } from '../world/noise.js';

const midiFreq = (m) => 440 * 2 ** ((m - 69) / 12);

// Renders one piano note (mono). Duration scales with pitch: low notes ring longer.
export function pianoNote(sr, midi, rand) {
  const f = midiFreq(midi);
  const dur = Math.min(7, Math.max(2.5, 5.5 * (261 / f) ** 0.45));
  const o = buf(sr, dur);
  const B = 0.00035 * (f / 261) ** 0.5; // string inharmonicity
  const partials = Math.min(14, Math.floor((sr * 0.45) / f));
  for (let n = 1; n <= partials; n++) {
    const fn = f * n * Math.sqrt(1 + B * n * n);
    if (fn > sr * 0.45) break;
    const amp = (1 / n ** 1.15) * (n === 1 ? 1 : 0.9) * Math.exp(-(fn / 5000));
    const fast = 0.18 / (1 + n * 0.25);
    const slow = (dur * 0.55) / (1 + n * 0.35);
    const kf = Math.exp(-1 / (fast * sr));
    const ks = Math.exp(-1 / (slow * sr));
    // Low partials use two slightly detuned strings for the gentle beating of a real piano.
    const strings = n <= 4 ? [-0.0007, 0.0007] : [0];
    for (const det of strings) {
      // Recursive oscillator: rotate (c, s) by the phase increment each sample.
      const w = (TAU * fn * (1 + det)) / sr;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      const ph = rand() * TAU;
      let c = Math.cos(ph);
      let sn = Math.sin(ph);
      let e1 = 0.55 * amp / strings.length;
      let e2 = 0.45 * amp / strings.length;
      for (let i = 0; i < o.length; i++) {
        o[i] += sn * (e1 + e2);
        const nc = c * cw - sn * sw;
        sn = c * sw + sn * cw;
        c = nc;
        e1 *= kf;
        e2 *= ks;
        if (e1 + e2 < 1e-5) break;
      }
    }
  }
  // Hammer thump.
  const hp = new Biquad('bandpass', Math.min(4000, f * 4), 0.8, sr);
  for (let i = 0; i < sr * 0.02; i++) o[i] += hp.tick(rand() * 2 - 1) * Math.exp(-i / (sr * 0.004)) * 0.25;
  // Attack and release fades.
  const a = Math.floor(sr * 0.003);
  for (let i = 0; i < a; i++) o[i] *= i / a;
  const r = Math.floor(sr * 0.4);
  for (let i = 0; i < r; i++) o[o.length - 1 - i] *= i / r;
  let max = 0;
  for (let i = 0; i < o.length; i++) max = Math.max(max, Math.abs(o[i]));
  for (let i = 0; i < o.length; i++) o[i] *= 0.5 / max;
  return o;
}

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// Chord progressions as scale degrees (0 = tonic).
const PROGRESSIONS = [
  [0, 5, 3, 4], [0, 3, 0, 4], [5, 3, 0, 4], [0, 2, 3, 3], [0, 4, 5, 3], [3, 0, 3, 4], [0, 5, 1, 4],
];

// Plans one piece: a list of { time (s), midi, vel } events.
export function composePiece(seed) {
  const rand = mulberry32(seed);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const scaleName = pick(['major', 'major', 'lydian', 'minor', 'dorian']);
  const scale = SCALES[scaleName];
  const root = 48 + pick([0, 2, 3, 5, 7, 8, 10]); // tonic in the 3rd octave
  const bpm = 56 + Math.floor(rand() * 20);
  const beat = 60 / bpm;
  const prog = pick(PROGRESSIONS);
  const deg = (d, oct = 0) => {
    const o = Math.floor(d / 7);
    const i = ((d % 7) + 7) % 7;
    return root + scale[i] + 12 * (o + oct);
  };
  const events = [];
  const sections = 2 + Math.floor(rand() * 2); // how many times the progression repeats
  const barsPerChord = 2;
  // A short motif (scale degrees relative to chord root, or null for rest) reused with variation.
  const motif = [];
  for (let i = 0; i < 8; i++) motif.push(rand() < 0.3 ? null : pick([0, 2, 4, 4, 2, 7, 5, 1]));
  let t = 1;
  for (let s = 0; s < sections; s++) {
    const withMelody = s > 0 || rand() < 0.5;
    for (const chord of prog) {
      for (let bar = 0; bar < barsPerChord; bar++) {
        // Left hand: slow broken chord.
        const pattern = pick([[0, 4, 7, 9], [0, 4, 2, 4], [0, 7, 4, 7], [0, 4, 9, 7]]);
        pattern.forEach((p, i) => {
          if (i > 0 && rand() < 0.15) return;
          events.push({ time: t + i * beat, midi: deg(chord + p, -1), vel: i === 0 ? 0.55 : 0.35 });
        });
        // Right hand melody over the upper octave.
        if (withMelody) {
          const len = pick([2, 2, 4]);
          for (let i = 0; i < 4; i += len / 2) {
            const m = motif[(bar * 4 + i) % motif.length];
            if (m === null || rand() < 0.25) continue;
            const vary = rand() < 0.3 ? pick([-1, 1, 2]) : 0;
            events.push({ time: t + i * beat + (rand() - 0.5) * 0.05, midi: deg(chord + m + vary, 1), vel: 0.35 + rand() * 0.2 });
          }
        } else if (rand() < 0.5) {
          events.push({ time: t + 2 * beat, midi: deg(chord + pick([2, 4]), 1), vel: 0.3 });
        }
        t += 4 * beat;
      }
    }
  }
  // Final resolving chord.
  for (const p of [0, 4, 7]) events.push({ time: t, midi: deg(p, p === 0 ? -1 : 0), vel: 0.45 });
  events.push({ time: t + beat * 0.5, midi: deg(0, 1), vel: 0.35 });
  return { events, length: t + 7, scale: scaleName };
}

// Streams pieces through the Web Audio API with a look-ahead scheduler.
export class MusicPlayer {
  constructor(engine) {
    this.engine = engine;
    this.cache = new Map();
    this.queue = [];
    this.pieceEnd = 0;
    this.nextStart = 0;
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.timer = null;
    this.rand = mulberry32(this.seed ^ 0x9e37);
  }

  start(delaySeconds = 4) {
    const ctx = this.engine.ctx;
    if (!ctx || this.timer) return;
    this.nextStart = ctx.currentTime + delaySeconds;
    this.timer = setInterval(() => this.pump(), 250);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
  }

  // Plays the next piece soon (e.g. when entering a world).
  soon(seconds) {
    const ctx = this.engine.ctx;
    if (ctx && this.queue.length === 0 && ctx.currentTime < this.nextStart) this.nextStart = Math.min(this.nextStart, ctx.currentTime + seconds);
  }

  // Note samples are rendered by the sound worker; notes that are not ready yet are skipped.
  prerender(notes) {
    for (const m of notes) {
      if (!this.cache.has(m)) this.engine.requestPiano(m, (b) => this.cache.set(m, b));
    }
  }

  pump() {
    const ctx = this.engine.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (this.queue.length === 0 && now >= this.nextStart) {
      const piece = composePiece(this.seed++);
      // Start two seconds later so the worker has time to render the notes.
      this.queue = piece.events.map((e) => ({ ...e, time: e.time + now + 2 }));
      this.pieceEnd = now + piece.length + 2;
      this.prerender([...new Set(piece.events.map((e) => e.midi))]);
      // Silence between pieces, like Minecraft (shorter so it is actually heard).
      this.nextStart = this.pieceEnd + 60 + this.rand() * 150;
    }
    // Schedule every note within the next 1.5 s.
    while (this.queue.length && this.queue[0].time < now + 1.5) {
      const e = this.queue.shift();
      const buffer = this.cache.get(e.midi);
      if (!buffer) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = e.vel;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      src.connect(g);
      if (pan) {
        pan.pan.value = Math.max(-0.6, Math.min(0.6, (e.midi - 60) / 30));
        g.connect(pan).connect(this.engine.musicBus);
      } else {
        g.connect(this.engine.musicBus);
      }
      src.start(Math.max(now, e.time));
    }
  }
}
