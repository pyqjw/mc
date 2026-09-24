// Every game sound, synthesised offline into sample buffers. Each entry renders one variant;
// the engine renders several variants per sound (different random seeds) like Minecraft's sound sets.
import {
  buf, grain, ping, noiseShape, voice, VOWELS, lerpV, finish, highpass, lowpass, saturate, makeLoop, Pink, Brown, Biquad, TAU,
} from './dsp.js';

const rr = (rand, a, b) => a + rand() * (b - a);

// ------------------------------------------------------------------ materials
// "step" is a short footstep (also used quietly for mining hits), "dig" is block break / place.
const MATERIALS = {
  stone(sr, rand, long) {
    const o = buf(sr, long ? 0.42 : 0.16);
    noiseShape(o, sr, rand, { attack: 0.001, decay: long ? 0.03 : 0.018, type: 'bandpass', freq: rr(rand, 1500, 2300), q: 0.8, amp: 1 });
    noiseShape(o, sr, rand, { attack: 0.001, decay: 0.02, type: 'lowpass', freq: 260, q: 1, amp: 1.4 });
    const n = long ? 28 : 6;
    for (let i = 0; i < n; i++) {
      const t = long ? 0.01 + (rand() ** 1.6) * 0.3 : rand() * 0.05;
      grain(o, sr, t, rr(rand, 0.003, 0.012), rr(rand, 1200, 4500), rr(rand, 1, 3), rr(rand, 0.2, 0.7) * (long ? 1 - t * 2 : 1), rand);
    }
    return finish(highpass(o, sr, 90), sr);
  },
  wood(sr, rand, long) {
    const o = buf(sr, long ? 0.4 : 0.16);
    const base = rr(rand, 150, 230);
    ping(o, sr, 0, base, 0.045, 0.9, base * 0.92);
    ping(o, sr, 0, base * 2.31, 0.028, 0.5);
    ping(o, sr, 0, base * 3.93, 0.016, 0.3);
    noiseShape(o, sr, rand, { attack: 0.001, decay: 0.012, type: 'bandpass', freq: rr(rand, 700, 1100), q: 1.5, amp: 0.9 });
    if (long) {
      for (let i = 0; i < 18; i++) {
        const t = 0.02 + rand() * 0.25;
        grain(o, sr, t, rr(rand, 0.004, 0.015), rr(rand, 900, 3200), rr(rand, 2, 5), rr(rand, 0.15, 0.5) * (1 - t * 2.5), rand);
      }
      ping(o, sr, 0.03, base * 1.5, 0.05, 0.4, base * 1.3);
    }
    return finish(highpass(o, sr, 70), sr);
  },
  grass(sr, rand, long) {
    const o = buf(sr, long ? 0.34 : 0.2);
    const n = long ? 70 : 35;
    const span = long ? 0.26 : 0.13;
    for (let i = 0; i < n; i++) {
      const t = (rand() ** 1.3) * span;
      grain(o, sr, t, rr(rand, 0.003, 0.01), rr(rand, 2500, 7000), rr(rand, 0.8, 2), rr(rand, 0.2, 0.8) * (1 - (t / span) * 0.7), rand);
    }
    noiseShape(o, sr, rand, { attack: 0.004, decay: 0.03, type: 'lowpass', freq: 700, amp: 0.5 });
    return finish(highpass(o, sr, 200), sr);
  },
  gravel(sr, rand, long) {
    const o = buf(sr, long ? 0.4 : 0.2);
    const n = long ? 90 : 40;
    const span = long ? 0.3 : 0.14;
    for (let i = 0; i < n; i++) {
      const t = (rand() ** 1.4) * span;
      grain(o, sr, t, rr(rand, 0.002, 0.007), rr(rand, 700, 3500), rr(rand, 1, 3), rr(rand, 0.3, 1) * (1 - (t / span) * 0.6), rand);
    }
    noiseShape(o, sr, rand, { attack: 0.002, decay: 0.03, type: 'lowpass', freq: 350, amp: 1 });
    return finish(highpass(o, sr, 80), sr);
  },
  sand(sr, rand, long) {
    const o = buf(sr, long ? 0.38 : 0.22);
    noiseShape(o, sr, rand, { attack: 0.012, decay: long ? 0.08 : 0.045, type: 'bandpass', freq: rr(rand, 2500, 3500), q: 0.5, amp: 0.8, color: 'pink' });
    const n = long ? 50 : 25;
    for (let i = 0; i < n; i++) {
      const t = rand() * (long ? 0.25 : 0.12);
      grain(o, sr, t, rr(rand, 0.002, 0.006), rr(rand, 3000, 7000), 1, rr(rand, 0.1, 0.35), rand);
    }
    return finish(lowpass(highpass(o, sr, 400), sr, 7000), sr, 0.75);
  },
  snow(sr, rand, long) {
    const o = buf(sr, long ? 0.36 : 0.22);
    const n = long ? 60 : 30;
    const span = long ? 0.24 : 0.12;
    for (let i = 0; i < n; i++) {
      const t = (rand() ** 1.2) * span;
      grain(o, sr, t, rr(rand, 0.004, 0.012), rr(rand, 1500, 4000), rr(rand, 1.5, 4), rr(rand, 0.3, 0.8), rand);
    }
    noiseShape(o, sr, rand, { attack: 0.006, decay: 0.04, type: 'lowpass', freq: 500, amp: 0.6 });
    return finish(lowpass(o, sr, 5000), sr, 0.75);
  },
  wool(sr, rand, long) {
    const o = buf(sr, long ? 0.3 : 0.18);
    noiseShape(o, sr, rand, { attack: 0.008, decay: long ? 0.06 : 0.035, type: 'lowpass', freq: rr(rand, 900, 1400), q: 0.6, amp: 1, color: 'pink' });
    for (let i = 0; i < 8; i++) grain(o, sr, rand() * 0.08, 0.01, rr(rand, 600, 1600), 0.8, 0.3, rand, 'lowpass');
    return finish(highpass(o, sr, 80), sr, 0.6);
  },
  metal(sr, rand, long) {
    const o = buf(sr, long ? 0.7 : 0.3);
    const base = rr(rand, 380, 520);
    const partials = [1, 2.76, 5.4, 8.93, 13.3];
    partials.forEach((p, i) => ping(o, sr, 0, base * p, (long ? 0.25 : 0.1) / (1 + i * 0.6), 0.6 / (1 + i * 0.5)));
    noiseShape(o, sr, rand, { attack: 0.001, decay: 0.01, type: 'highpass', freq: 3000, amp: 0.8 });
    return finish(o, sr, 0.8);
  },
};

function glassBreak(sr, rand) {
  const o = buf(sr, 0.9);
  noiseShape(o, sr, rand, { attack: 0.001, decay: 0.04, type: 'highpass', freq: 3000, amp: 1 });
  for (let i = 0; i < 80; i++) {
    const t = (rand() ** 2) * 0.45;
    grain(o, sr, t, rr(rand, 0.002, 0.01), rr(rand, 3500, 9000), rr(rand, 2, 6), rr(rand, 0.2, 0.8) * (1 - t), rand);
  }
  for (let i = 0; i < 16; i++) {
    const t = (rand() ** 1.5) * 0.5;
    ping(o, sr, t, rr(rand, 2500, 7500), rr(rand, 0.03, 0.12), rr(rand, 0.15, 0.4) * (1 - t));
  }
  return finish(o, sr, 0.85);
}

// ------------------------------------------------------------------ creatures
function playerHurt(sr, rand) {
  const d = 0.28;
  const s = rr(rand, 0.95, 1.08);
  return finish(highpass(voice(sr, d, rand, {
    f0: (t) => (175 - t * 220) * s,
    vowel: (t) => lerpV(VOWELS.u, VOWELS.o, Math.min(1, t / 0.12)),
    amp: (t) => Math.min(1, t / 0.012) * Math.exp(-t / 0.09),
    breath: 0.18,
    rough: 0.25,
  }), sr, 90), sr);
}

function pigGrunt(sr, rand, out, t0, f, dur) {
  const v = voice(sr, dur, rand, {
    f0: (t) => f * (1 - 0.25 * (t / dur)),
    vowel: (t) => lerpV(VOWELS.n, VOWELS.uh, Math.min(1, t / (dur * 0.5))),
    amp: (t) => Math.min(1, t / 0.015) * Math.exp(-t / (dur * 0.4)) * (0.7 + 0.3 * Math.sin(TAU * 38 * t)),
    breath: 0.25,
    rough: 0.5,
    nasal: 0.6,
  });
  const s = Math.floor(t0 * sr);
  for (let i = 0; i < v.length && s + i < out.length; i++) out[s + i] += v[i];
}

function pig(sr, rand) {
  const o = buf(sr, 0.55);
  const f = rr(rand, 150, 190);
  pigGrunt(sr, rand, o, 0, f, rr(rand, 0.12, 0.18));
  if (rand() < 0.7) pigGrunt(sr, rand, o, rr(rand, 0.2, 0.28), f * 0.92, rr(rand, 0.1, 0.16));
  return finish(highpass(o, sr, 120), sr);
}

function pigHurt(sr, rand) {
  const d = rr(rand, 0.28, 0.36);
  const f = rr(rand, 380, 460);
  return finish(highpass(voice(sr, d, rand, {
    f0: (t) => f * (1 + 0.35 * Math.sin(Math.PI * t / d)),
    vowel: () => VOWELS.i,
    amp: (t) => Math.min(1, t / 0.02) * Math.min(1, (d - t) / 0.06),
    breath: 0.12,
    rough: 0.2,
    nasal: 0.3,
  }), sr, 200), sr);
}

function cow(sr, rand) {
  const d = rr(rand, 0.9, 1.25);
  const f = rr(rand, 88, 105);
  return finish(highpass(voice(sr, d, rand, {
    f0: (t) => f * (1 + 0.3 * Math.sin(Math.PI * Math.min(1, t / (d * 0.8)))) * (1 + 0.012 * Math.sin(TAU * 5 * t)),
    vowel: (t) => (t < 0.18 ? lerpV(VOWELS.m, VOWELS.u, t / 0.18) : lerpV(VOWELS.u, VOWELS.o, Math.min(1, (t - 0.18) / (d * 0.6)))),
    amp: (t) => Math.min(1, t / 0.15) * Math.min(1, (d - t) / 0.25),
    breath: 0.15,
    rough: 0.15,
    bw: [60, 90, 140],
  }), sr, 60), sr);
}

function cowHurt(sr, rand) {
  const d = rr(rand, 0.35, 0.45);
  const f = rr(rand, 140, 160);
  return finish(highpass(voice(sr, d, rand, {
    f0: (t) => f * (1 - 0.3 * (t / d)),
    vowel: () => VOWELS.o,
    amp: (t) => Math.min(1, t / 0.02) * Math.min(1, (d - t) / 0.1),
    breath: 0.2,
    rough: 0.35,
  }), sr, 70), sr);
}

function sheep(sr, rand, hurt = false) {
  const d = hurt ? rr(rand, 0.3, 0.4) : rr(rand, 0.55, 0.8);
  const f = hurt ? rr(rand, 330, 380) : rr(rand, 240, 290);
  const bleat = rr(rand, 18, 24);
  return finish(highpass(voice(sr, d, rand, {
    f0: (t) => f * (1 + 0.04 * Math.sin(TAU * 6.5 * t)) * (1 - 0.08 * (t / d)),
    vowel: (t) => lerpV(VOWELS.a, VOWELS.e, Math.min(1, t / d)),
    amp: (t) => Math.min(1, t / 0.04) * Math.min(1, (d - t) / 0.12) * (0.55 + 0.45 * Math.sin(TAU * bleat * t)),
    breath: 0.12,
    rough: 0.1,
  }), sr, 150), sr);
}

function zombie(sr, rand, kind = 'idle') {
  const d = kind === 'idle' ? rr(rand, 1.0, 1.5) : kind === 'hurt' ? rr(rand, 0.3, 0.4) : rr(rand, 0.9, 1.1);
  const f = kind === 'hurt' ? rr(rand, 120, 140) : rr(rand, 80, 98);
  const o = voice(sr, d, rand, {
    f0: (t) => {
      if (kind === 'death') return f * (1 - 0.45 * (t / d));
      if (kind === 'hurt') return f * (1 - 0.25 * (t / d));
      return f * (1 + 0.15 * Math.sin(Math.PI * t / d) + 0.05 * Math.sin(TAU * 1.7 * t));
    },
    vowel: (t) => lerpV(VOWELS.uh, VOWELS.o, Math.min(1, t / d)),
    amp: (t) => Math.min(1, t / (kind === 'hurt' ? 0.015 : 0.12)) * Math.min(1, (d - t) / 0.2) * (0.8 + 0.2 * Math.sin(TAU * 3 * t)),
    breath: 0.35,
    jitter: 0.05,
    rough: 0.6,
    bw: [70, 100, 150],
  });
  return finish(highpass(saturate(o, 2), sr, 60), sr);
}

function creeperHurt(sr, rand) {
  const o = buf(sr, 0.35);
  for (let i = 0; i < 50; i++) {
    const t = (rand() ** 1.3) * 0.25;
    grain(o, sr, t, rr(rand, 0.003, 0.01), rr(rand, 1500, 6000), rr(rand, 1, 3), rr(rand, 0.3, 0.9) * (1 - t * 3), rand);
  }
  noiseShape(o, sr, rand, { attack: 0.005, decay: 0.08, type: 'highpass', freq: 3000, amp: 0.5 });
  return finish(o, sr, 0.8);
}

// ------------------------------------------------------------------ effects
function pop(sr, rand) {
  const o = buf(sr, 0.12);
  const f = rr(rand, 600, 800);
  ping(o, sr, 0, f, 0.025, 1, f * 1.9, 0.002);
  noiseShape(o, sr, rand, { attack: 0.0005, decay: 0.004, type: 'bandpass', freq: 3000, q: 1, amp: 0.25 });
  return finish(o, sr, 0.8);
}

function click(sr, rand) {
  const o = buf(sr, 0.06);
  noiseShape(o, sr, rand, { attack: 0.0003, decay: 0.003, type: 'bandpass', freq: 3500, q: 1.2, amp: 1 });
  ping(o, sr, 0, 1800, 0.008, 0.6);
  ping(o, sr, 0, 700, 0.01, 0.4);
  return finish(o, sr, 0.7);
}

function eat(sr, rand) {
  const o = buf(sr, 0.18);
  for (let i = 0; i < 30; i++) {
    const t = (rand() ** 1.5) * 0.1;
    grain(o, sr, t, rr(rand, 0.002, 0.008), rr(rand, 1200, 4500), rr(rand, 1, 3), rr(rand, 0.3, 1) * (1 - t * 6), rand);
  }
  noiseShape(o, sr, rand, { attack: 0.003, decay: 0.02, type: 'lowpass', freq: 400, amp: 1.2 });
  return finish(highpass(o, sr, 120), sr, 0.8);
}

function burp(sr, rand) {
  const d = rr(rand, 0.4, 0.55);
  return finish(highpass(voice(sr, d, rand, {
    f0: (t) => 90 * (1 - 0.2 * t / d),
    vowel: (t) => lerpV(VOWELS.uh, VOWELS.o, t / d),
    amp: (t) => Math.min(1, t / 0.03) * Math.min(1, (d - t) / 0.1) * (0.6 + 0.4 * Math.sin(TAU * 28 * t)),
    breath: 0.15,
    jitter: 0.08,
    rough: 0.7,
  }), sr, 60), sr, 0.8);
}

function fallThud(sr, rand, big) {
  const o = buf(sr, big ? 0.4 : 0.2);
  ping(o, sr, 0, big ? 70 : 95, big ? 0.09 : 0.05, 1, big ? 45 : 70, 0.002);
  noiseShape(o, sr, rand, { attack: 0.002, decay: big ? 0.06 : 0.03, type: 'lowpass', freq: 400, amp: 1.2, color: 'brown' });
  if (big) for (let i = 0; i < 8; i++) grain(o, sr, 0.005 + rand() * 0.04, 0.006, rr(rand, 1500, 3000), 2, 0.4, rand);
  return finish(o, sr, 0.9);
}

function explosion(sr, rand) {
  const d = 3.2;
  const o = buf(sr, d);
  ping(o, sr, 0, 62, 0.35, 1.3, 26, 0.004);
  const brown = new Brown(rand);
  const lp = new Biquad('lowpass', 3000, 0.6, sr);
  for (let i = 0; i < o.length; i++) {
    const t = i / sr;
    if ((i & 63) === 0) lp.set(3500 * Math.exp(-t * 2.2) + 120);
    const env = Math.min(1, t / 0.006) * (Math.exp(-t / 0.35) * 0.7 + Math.exp(-t / 1.2) * 0.3);
    o[i] += lp.tick(brown.next() * 1.6 + (rand() * 2 - 1) * 0.4) * env * 1.2;
  }
  for (let i = 0; i < 140; i++) {
    const t = (rand() ** 2.2) * 1.4;
    grain(o, sr, t, rr(rand, 0.003, 0.02), rr(rand, 400, 4000), rr(rand, 0.8, 2.5), rr(rand, 0.1, 0.5) * Math.exp(-t * 1.5), rand);
  }
  for (let i = 0; i < 10; i++) {
    const t = 0.3 + rand() * 1.6;
    ping(o, sr, t, rr(rand, 70, 140), 0.04, rr(rand, 0.1, 0.3), 50);
  }
  return finish(saturate(o, 1.3), sr, 0.95);
}

function fuse(sr, rand) {
  const d = 1.6;
  const o = buf(sr, d);
  const hp = new Biquad('highpass', 2500, 0.7, sr);
  const bp = new Biquad('bandpass', 6000, 1.2, sr);
  for (let i = 0; i < o.length; i++) {
    const t = i / sr;
    const n = rand() * 2 - 1;
    const env = Math.min(1, t / 0.3) * (0.6 + 0.4 * (t / d)) * Math.min(1, (d - t) / 0.08);
    const crackle = rand() < 0.004 ? rr(rand, 1, 3) : 1;
    o[i] = (hp.tick(n) * 0.7 + bp.tick(n) * 0.5) * env * crackle;
  }
  return finish(o, sr, 0.8);
}

function fizz(sr, rand) {
  const o = buf(sr, 0.7);
  noiseShape(o, sr, rand, { attack: 0.005, decay: 0.15, type: 'highpass', freq: 2500, amp: 0.8 });
  for (let i = 0; i < 40; i++) grain(o, sr, (rand() ** 1.5) * 0.5, 0.004, rr(rand, 2000, 8000), 2, rr(rand, 0.2, 0.6), rand);
  return finish(o, sr, 0.8);
}

function bubbles(o, sr, rand, count, span, from = 0, amp = 0.35) {
  for (let i = 0; i < count; i++) {
    const t = from + rand() * span;
    const f = rr(rand, 350, 1300);
    ping(o, sr, t, f, rr(rand, 0.012, 0.03), amp * rr(rand, 0.4, 1), f * rr(rand, 1.5, 2.4), 0.002);
  }
}

function splash(sr, rand, small) {
  const o = buf(sr, small ? 0.45 : 0.9);
  noiseShape(o, sr, rand, { attack: 0.004, decay: small ? 0.06 : 0.12, dur: small ? 0.3 : 0.6, type: 'bandpass', freq: 2800, freqEnd: 500, q: 0.7, amp: 1 });
  noiseShape(o, sr, rand, { attack: 0.01, decay: small ? 0.08 : 0.2, type: 'highpass', freq: 4000, amp: 0.35 });
  bubbles(o, sr, rand, small ? 5 : 14, small ? 0.3 : 0.6, 0.05);
  return finish(o, sr, small ? 0.6 : 0.85);
}

function bucket(sr, rand, fill) {
  const o = buf(sr, 0.7);
  const bp = new Biquad('bandpass', 800, 1.5, sr);
  for (let i = 0; i < o.length; i++) {
    const t = i / sr;
    if ((i & 63) === 0) bp.set(fill ? 500 + t * 900 : 1300 - t * 800, 1.5);
    const slosh = 0.6 + 0.4 * Math.sin(TAU * 7 * t + Math.sin(TAU * 3 * t));
    o[i] = bp.tick(rand() * 2 - 1) * Math.min(1, t / 0.03) * Math.exp(-t / 0.3) * slosh;
  }
  bubbles(o, sr, rand, 10, 0.45, 0.02, 0.3);
  return finish(o, sr, 0.75);
}

function toolBreak(sr, rand) {
  const o = buf(sr, 0.6);
  noiseShape(o, sr, rand, { attack: 0.0005, decay: 0.01, type: 'highpass', freq: 2000, amp: 1 });
  [1, 2.6, 4.9, 7.3].forEach((p, i) => ping(o, sr, 0, 1400 * p, 0.12 / (1 + i), 0.5));
  for (let i = 0; i < 6; i++) ping(o, sr, 0.05 + rand() * 0.3, rr(rand, 3000, 6000), 0.03, 0.25);
  return finish(o, sr, 0.8);
}

function swim(sr, rand) {
  const o = buf(sr, 0.45);
  noiseShape(o, sr, rand, { attack: 0.03, decay: 0.08, dur: 0.35, type: 'bandpass', freq: 1500, freqEnd: 700, q: 0.8, amp: 0.8 });
  bubbles(o, sr, rand, 4, 0.25, 0.05, 0.2);
  return finish(o, sr, 0.5);
}

// ------------------------------------------------------------------ more creatures
function chickenCluck(sr, rand) {
  const o = buf(sr, 0.5);
  const n = 1 + Math.floor(rand() * 3);
  let t = 0;
  for (let k = 0; k < n; k++) {
    const d = rr(rand, 0.06, 0.1);
    const f = rr(rand, 520, 700) * (k === n - 1 ? 1.15 : 1);
    const v = voice(sr, d, rand, {
      f0: (tt) => f * (1 + 0.25 * Math.sin(Math.PI * tt / d)),
      vowel: (tt) => lerpV(VOWELS.a, VOWELS.uh, tt / d),
      amp: (tt) => Math.min(1, tt / 0.006) * Math.min(1, (d - tt) / 0.02),
      breath: 0.2,
      rough: 0.35,
      nasal: 0.3,
    });
    const s0 = Math.floor(t * sr);
    for (let i = 0; i < v.length && s0 + i < o.length; i++) o[s0 + i] += v[i];
    t += d + rr(rand, 0.04, 0.09);
  }
  return finish(highpass(o, sr, 300), sr, 0.8);
}

function chickenHurt(sr, rand) {
  const d = rr(rand, 0.16, 0.22);
  const f = rr(rand, 900, 1100);
  return finish(highpass(voice(sr, d, rand, {
    f0: (t) => f * (1 + 0.3 * Math.sin(Math.PI * t / d)),
    vowel: () => VOWELS.a,
    amp: (t) => Math.min(1, t / 0.005) * Math.min(1, (d - t) / 0.04),
    breath: 0.3,
    rough: 0.5,
  }), sr, 400), sr, 0.8);
}

// Rattling bones: dry, woody clicks.
function boneRattle(sr, rand, dur, count) {
  const o = buf(sr, dur + 0.1);
  for (let i = 0; i < count; i++) {
    const t = rand() * dur;
    const f = rr(rand, 900, 2600);
    ping(o, sr, t, f, rr(rand, 0.004, 0.012), rr(rand, 0.3, 0.9), f * 0.9, 0.0005);
    grain(o, sr, t, 0.004, rr(rand, 2500, 5000), 3, rr(rand, 0.2, 0.5), rand);
  }
  return o;
}

function skeletonIdle(sr, rand) {
  return finish(highpass(boneRattle(sr, rand, rr(rand, 0.3, 0.55), 26), sr, 400), sr, 0.7);
}

function skeletonHurt(sr, rand) {
  const o = boneRattle(sr, rand, 0.18, 18);
  noiseShape(o, sr, rand, { attack: 0.002, decay: 0.03, type: 'bandpass', freq: 1400, q: 1.5, amp: 0.8 });
  return finish(highpass(o, sr, 300), sr, 0.8);
}

function skeletonDeath(sr, rand) {
  const o = boneRattle(sr, rand, 0.7, 60);
  for (let i = 0; i < 6; i++) ping(o, sr, 0.3 + rand() * 0.4, rr(rand, 250, 500), 0.03, 0.5, 200);
  return finish(highpass(o, sr, 150), sr, 0.8);
}

// Spider hiss / chitter: bursts of noise chopped at a fast rate.
function spiderSay(sr, rand, death = false) {
  const d = death ? rr(rand, 0.8, 1.1) : rr(rand, 0.35, 0.6);
  const o = buf(sr, d);
  const bp = new Biquad('bandpass', 3000, 1.2, sr);
  const rate = rr(rand, 28, 40);
  for (let i = 0; i < o.length; i++) {
    const t = i / sr;
    if ((i & 63) === 0) bp.set((death ? 3200 - 2200 * (t / d) : 2600 + 800 * Math.sin(TAU * 3 * t)), 1.2);
    const chop = 0.35 + 0.65 * Math.max(0, Math.sin(TAU * rate * t)) ** 2;
    const env = Math.min(1, t / 0.03) * Math.min(1, (d - t) / 0.1);
    o[i] = bp.tick(rand() * 2 - 1) * chop * env;
  }
  noiseShape(o, sr, rand, { attack: 0.01, decay: d * 0.25, type: 'highpass', freq: 5000, amp: 0.25 });
  return finish(o, sr, 0.8);
}

// ------------------------------------------------------------------ combat & items
function bowShoot(sr, rand) {
  const o = buf(sr, 0.45);
  const f = rr(rand, 140, 180);
  ping(o, sr, 0, f, 0.05, 0.9, f * 0.94, 0.001);
  ping(o, sr, 0, f * 3.1, 0.02, 0.4);
  noiseShape(o, sr, rand, { from: 0.005, attack: 0.01, decay: 0.05, dur: 0.3, type: 'bandpass', freq: 2500, freqEnd: 900, q: 1.2, amp: 0.8 });
  return finish(highpass(o, sr, 90), sr, 0.8);
}

function arrowHit(sr, rand) {
  const o = buf(sr, 0.25);
  ping(o, sr, 0, rr(rand, 300, 420), 0.03, 1, 250, 0.0005);
  noiseShape(o, sr, rand, { attack: 0.0005, decay: 0.008, type: 'bandpass', freq: 2000, q: 1, amp: 0.8 });
  for (let i = 0; i < 4; i++) ping(o, sr, 0.01 + i * 0.012, rr(rand, 180, 260), 0.012, 0.3 * (1 - i / 4));
  return finish(o, sr, 0.75);
}

// Experience orb: a small bright bell.
function orbDing(sr, rand) {
  const o = buf(sr, 0.5);
  const f = rr(rand, 1500, 1700);
  [1, 2.01, 3.03, 4.6].forEach((m, i) => ping(o, sr, 0, f * m, 0.12 / (1 + i), 0.7 / (1 + i * 1.3)));
  return finish(o, sr, 0.7);
}

// Level up: a rising sparkly arpeggio.
function levelUp(sr, rand) {
  const o = buf(sr, 1.4);
  const base = 523.25;
  [1, 1.26, 1.5, 2, 2.52].forEach((m, i) => {
    const t = i * 0.07;
    [1, 2.01, 3.02].forEach((h, j) => ping(o, sr, t, base * m * h, 0.35 / (1 + j), 0.5 / (1 + j * 1.5)));
  });
  for (let i = 0; i < 12; i++) ping(o, sr, 0.3 + rand() * 0.6, rr(rand, 3000, 6000), 0.05, 0.12);
  return finish(o, sr, 0.8);
}

function equipLeather(sr, rand) {
  const o = buf(sr, 0.35);
  for (let i = 0; i < 3; i++) noiseShape(o, sr, rand, { from: i * 0.07, attack: 0.01, decay: 0.03, type: 'bandpass', freq: rr(rand, 700, 1300), q: 0.8, amp: 0.7, color: 'pink' });
  return finish(highpass(o, sr, 120), sr, 0.6);
}

function equipIron(sr, rand) {
  const o = buf(sr, 0.5);
  for (let i = 0; i < 3; i++) {
    const t = i * 0.06 + rand() * 0.02;
    const f = rr(rand, 1600, 2600);
    [1, 2.4, 4.1].forEach((m, j) => ping(o, sr, t, f * m, 0.05 / (1 + j), 0.5 / (1 + j)));
    grain(o, sr, t, 0.006, 5000, 2, 0.3, rand);
  }
  noiseShape(o, sr, rand, { attack: 0.005, decay: 0.03, type: 'lowpass', freq: 600, amp: 0.5 });
  return finish(o, sr, 0.65);
}

function boneMeal(sr, rand) {
  const o = buf(sr, 0.3);
  for (let i = 0; i < 45; i++) {
    const t = (rand() ** 1.3) * 0.2;
    grain(o, sr, t, rr(rand, 0.002, 0.006), rr(rand, 3000, 8000), rr(rand, 1, 3), rr(rand, 0.2, 0.7) * (1 - t * 4), rand);
  }
  return finish(highpass(o, sr, 800), sr, 0.6);
}

function whoosh(sr, rand, dur, f0, f1, amp = 1) {
  const o = buf(sr, dur + 0.05);
  noiseShape(o, sr, rand, { attack: dur * 0.3, decay: dur * 0.12, dur, type: 'bandpass', freq: f0, freqEnd: f1, q: 1.4, amp, color: 'pink' });
  return o;
}

function attackStrong(sr, rand) {
  const o = whoosh(sr, rand, 0.16, 1800, 700);
  const s0 = Math.floor(0.05 * sr);
  const thump = buf(sr, 0.2);
  ping(thump, sr, 0, rr(rand, 90, 120), 0.04, 1, 60, 0.001);
  noiseShape(thump, sr, rand, { attack: 0.001, decay: 0.012, type: 'lowpass', freq: 900, amp: 0.8 });
  for (let i = 0; i < thump.length && s0 + i < o.length; i++) o[s0 + i] += thump[i];
  return finish(o, sr, 0.85);
}

function attackWeak(sr, rand) {
  const o = whoosh(sr, rand, 0.1, 1400, 900, 0.6);
  ping(o, sr, 0.03, rr(rand, 130, 170), 0.02, 0.5, 100);
  return finish(o, sr, 0.5);
}

function attackSweep(sr, rand) {
  const o = whoosh(sr, rand, 0.32, 3200, 600);
  noiseShape(o, sr, rand, { from: 0.02, attack: 0.05, decay: 0.05, dur: 0.28, type: 'highpass', freq: 4000, amp: 0.3 });
  return finish(o, sr, 0.8);
}

function attackCrit(sr, rand) {
  const o = attackStrong(sr, rand);
  const c = buf(sr, 0.1);
  noiseShape(c, sr, rand, { attack: 0.0005, decay: 0.006, type: 'highpass', freq: 3000, amp: 1 });
  ping(c, sr, 0, 2400, 0.01, 0.5);
  const s0 = Math.floor(0.05 * sr);
  for (let i = 0; i < c.length && s0 + i < o.length; i++) o[s0 + i] += c[i];
  return finish(o, sr, 0.9);
}

function throwSound(sr, rand) {
  return finish(whoosh(sr, rand, 0.2, 1200, 2400, 0.8), sr, 0.6);
}

function eggPlop(sr, rand) {
  const o = buf(sr, 0.15);
  ping(o, sr, 0, rr(rand, 550, 650), 0.03, 1, 200, 0.001);
  return finish(o, sr, 0.6);
}

// ------------------------------------------------------------------ doors, gates & chests
// Wooden creak: a train of resonant stick-slip clicks whose rate glides.
function creak(o, sr, rand, t0, dur, rate0, rate1, freq, amp = 1) {
  let t = t0;
  while (t < t0 + dur) {
    const u = (t - t0) / dur;
    const f = rr(rand, freq * 0.85, freq * 1.15) * (1 + 0.3 * u);
    ping(o, sr, t, f, 0.006, amp * (0.5 + 0.5 * Math.sin(Math.PI * u)) * rr(rand, 0.6, 1), f * 0.97, 0.0005);
    t += 1 / (rate0 + (rate1 - rate0) * u) * rr(rand, 0.8, 1.2);
  }
}

function doorSound(sr, rand, open) {
  const o = buf(sr, 0.6);
  if (open) {
    creak(o, sr, rand, 0.02, 0.32, 40, 90, rr(rand, 700, 1000), 0.6);
    grain(o, sr, 0, 0.01, 2500, 2, 0.4, rand);
  } else {
    creak(o, sr, rand, 0.0, 0.15, 90, 50, rr(rand, 700, 900), 0.4);
    ping(o, sr, 0.16, rr(rand, 110, 140), 0.05, 1, 80, 0.001);
    noiseShape(o, sr, rand, { from: 0.16, attack: 0.001, decay: 0.02, type: 'lowpass', freq: 900, amp: 0.8 });
    grain(o, sr, 0.17, 0.01, 3000, 2, 0.5, rand);
  }
  return finish(highpass(o, sr, 80), sr, 0.8);
}

function gateSound(sr, rand, open) {
  const o = buf(sr, 0.4);
  creak(o, sr, rand, 0, open ? 0.2 : 0.1, 70, 110, rr(rand, 1000, 1400), 0.5);
  ping(o, sr, open ? 0.18 : 0.1, rr(rand, 220, 300), 0.02, 0.8, 180, 0.001);
  grain(o, sr, open ? 0.18 : 0.1, 0.008, 3500, 2, 0.4, rand);
  return finish(highpass(o, sr, 120), sr, 0.7);
}

function chestSound(sr, rand, open) {
  const o = buf(sr, 0.8);
  if (open) {
    creak(o, sr, rand, 0.02, 0.45, 35, 70, rr(rand, 500, 700), 0.7);
  } else {
    creak(o, sr, rand, 0, 0.2, 70, 40, rr(rand, 500, 650), 0.5);
    ping(o, sr, 0.22, rr(rand, 90, 120), 0.06, 1, 70, 0.001);
    noiseShape(o, sr, rand, { from: 0.22, attack: 0.001, decay: 0.03, type: 'lowpass', freq: 700, amp: 0.9 });
  }
  return finish(highpass(o, sr, 60), sr, 0.8);
}

// ------------------------------------------------------------------ ambience

function windLoop(sr, rand) {
  const d = 10;
  const render = () => {
    const o = buf(sr, d + 1);
    const pink = new Pink(rand);
    const bp = new Biquad('bandpass', 500, 0.9, sr);
    const ph = rand() * TAU;
    const ph2 = rand() * TAU;
    for (let i = 0; i < o.length; i++) {
      const t = i / sr;
      if ((i & 63) === 0) bp.set(380 + 260 * Math.sin(TAU * t / 5.5 + ph) + 120 * Math.sin(TAU * t / 2.3 + ph2), 0.9);
      const gust = 0.55 + 0.3 * Math.sin(TAU * t / 11 * 2 + ph) + 0.15 * Math.sin(TAU * t / 3.7 + ph2);
      o[i] = bp.tick(pink.next()) * gust;
    }
    return finish(makeLoop(o, sr, 1), sr, 0.8);
  };
  return [render(), render()];
}

function underwaterLoop(sr, rand) {
  const render = () => {
    const o = buf(sr, 7);
    const brown = new Brown(rand);
    const lp = new Biquad('lowpass', 350, 0.8, sr);
    for (let i = 0; i < o.length; i++) o[i] = lp.tick(brown.next()) * (0.8 + 0.2 * Math.sin(TAU * i / sr / 3));
    bubbles(o, sr, rand, 10, 5.5, 0.2, 0.08);
    return finish(makeLoop(o, sr, 1), sr, 0.8);
  };
  return [render(), render()];
}

function waterLoop(sr, rand) {
  const render = () => {
    const o = buf(sr, 6);
    const pink = new Pink(rand);
    const bp = new Biquad('bandpass', 1100, 0.7, sr);
    for (let i = 0; i < o.length; i++) {
      const t = i / sr;
      if ((i & 127) === 0) bp.set(900 + 400 * Math.sin(TAU * t * 0.7) + rand() * 300, 0.7);
      o[i] = bp.tick(pink.next()) * 0.5;
    }
    bubbles(o, sr, rand, 90, 4.8, 0.1, 0.12);
    return finish(makeLoop(o, sr, 1), sr, 0.7);
  };
  return [render(), render()];
}

function bird(sr, rand) {
  const o = buf(sr, 1.6);
  const kind = Math.floor(rand() * 3);
  const base = rr(rand, 2600, 4200);
  const n = 2 + Math.floor(rand() * 5);
  let t = 0;
  for (let k = 0; k < n; k++) {
    const len = kind === 0 ? rr(rand, 0.05, 0.1) : kind === 1 ? rr(rand, 0.08, 0.16) : rr(rand, 0.03, 0.06);
    const s = Math.floor(t * sr);
    let phase = 0;
    for (let i = 0; i < len * sr && s + i < o.length; i++) {
      const u = i / (len * sr);
      let f;
      if (kind === 0) f = base * (1.3 - 0.5 * u); // falling chirp
      else if (kind === 1) f = base * (0.8 + 0.4 * u) * (1 + 0.1 * Math.sin(TAU * 60 * i / sr)); // rising trill
      else f = base * (1 + 0.25 * Math.sin(Math.PI * u)); // short tweet
      phase += (TAU * f) / sr;
      o[s + i] += Math.sin(phase) * Math.sin(Math.PI * u) ** 2 * 0.8;
    }
    t += len + (kind === 1 ? rr(rand, 0.02, 0.06) : rr(rand, 0.06, 0.18));
  }
  return finish(o, sr, 0.5);
}

function cricket(sr, rand) {
  const o = buf(sr, 1.4);
  const f = rr(rand, 4200, 4800);
  const chirps = 2 + Math.floor(rand() * 3);
  let t = 0;
  for (let c = 0; c < chirps; c++) {
    const pulses = 3 + Math.floor(rand() * 3);
    for (let p = 0; p < pulses; p++) {
      ping(o, sr, t, f, 0.006, 0.6, f, 0.002);
      t += 0.028;
    }
    t += rr(rand, 0.18, 0.32);
  }
  return finish(o, sr, 0.35);
}

function caveSound(sr, rand) {
  const d = rr(rand, 4, 6.5);
  const o = buf(sr, d);
  const kind = Math.floor(rand() * 4);
  if (kind === 0) {
    // Low eerie drone that bends in pitch.
    for (const det of [1, 1.007, 1.5]) {
      let ph = 0;
      const f0 = rr(rand, 55, 90) * det;
      for (let i = 0; i < o.length; i++) {
        const t = i / sr;
        ph += (TAU * f0 * (1 - 0.15 * t / d)) / sr;
        o[i] += Math.sin(ph) * Math.sin(Math.PI * t / d) ** 2 * 0.4;
      }
    }
    noiseShape(o, sr, rand, { attack: d * 0.4, decay: d * 0.2, type: 'bandpass', freq: 300, q: 2, amp: 0.3, color: 'brown' });
  } else if (kind === 1) {
    // Distant knocks and falling pebbles.
    for (let k = 0; k < 5; k++) {
      const t = rand() * (d - 1);
      ping(o, sr, t, rr(rand, 90, 180), 0.06, 0.8, 60);
      for (let j = 0; j < 6; j++) grain(o, sr, t + 0.05 + rand() * 0.4, 0.01, rr(rand, 800, 2000), 2, 0.2, rand);
    }
    lowpass(o, sr, 1500);
  } else if (kind === 2) {
    // A thin, wavering whine.
    let ph = 0;
    const f0 = rr(rand, 380, 620);
    for (let i = 0; i < o.length; i++) {
      const t = i / sr;
      ph += (TAU * f0 * (1 - 0.3 * t / d) * (1 + 0.02 * Math.sin(TAU * 4 * t))) / sr;
      o[i] += Math.sin(ph) * Math.sin(Math.PI * t / d) ** 3 * 0.35;
    }
  } else {
    // Deep rumble swell.
    noiseShape(o, sr, rand, { attack: d * 0.35, hold: d * 0.1, decay: d * 0.15, type: 'lowpass', freq: 160, q: 1, amp: 1, color: 'brown' });
  }
  return finish(o, sr, 0.7);
}

function drip(sr, rand) {
  const o = buf(sr, 0.5);
  const f = rr(rand, 1200, 2200);
  ping(o, sr, 0, f * 0.7, 0.02, 0.9, f * 1.4, 0.001);
  ping(o, sr, 0.09, f * 0.7, 0.02, 0.3, f * 1.4, 0.001);
  return finish(o, sr, 0.5);
}

function lavaPop(sr, rand) {
  const o = buf(sr, 0.4);
  const f = rr(rand, 90, 160);
  ping(o, sr, 0, f, 0.05, 1, f * 0.6, 0.004);
  noiseShape(o, sr, rand, { attack: 0.001, decay: 0.02, type: 'bandpass', freq: 600, q: 1, amp: 0.6 });
  for (let i = 0; i < 12; i++) grain(o, sr, rand() * 0.2, 0.004, rr(rand, 2000, 6000), 2, 0.25, rand);
  return finish(o, sr, 0.6);
}

// ------------------------------------------------------------------ registry
// gen(sr, rand) -> Float32Array (mono) or [L, R].
// gain: base volume, pitch: [min, max] random playback rate, range: audible distance in blocks,
// bus: 'sfx' | 'ambient', variants: how many different renders.
export const SOUNDS = {};

function def(name, gen, opts = {}) {
  SOUNDS[name] = { gen, gain: 1, pitch: [0.92, 1.08], range: 16, bus: 'sfx', variants: 4, ...opts };
}

for (const [mat, fn] of Object.entries(MATERIALS)) {
  def(`step.${mat}`, (sr, r) => fn(sr, r, false), { gain: 0.5 });
  def(`dig.${mat}`, (sr, r) => fn(sr, r, true), { gain: 0.9 });
}
def('break.glass', glassBreak, { gain: 0.9, variants: 3 });
def('hurt', playerHurt, { gain: 0.9, variants: 3, pitch: [0.9, 1.1] });
def('fall.small', (sr, r) => fallThud(sr, r, false), { gain: 0.8, variants: 2 });
def('fall.big', (sr, r) => fallThud(sr, r, true), { gain: 1, variants: 2 });
def('pop', pop, { gain: 0.35, variants: 2, pitch: [0.75, 1.5] });
def('click', click, { gain: 0.5, variants: 1, pitch: [1, 1] });
def('eat', eat, { gain: 0.6, variants: 3, pitch: [0.85, 1.15] });
def('burp', burp, { gain: 0.55, variants: 2 });
def('explode', explosion, { gain: 1.3, variants: 3, range: 48, pitch: [0.85, 1.05] });
def('fuse', fuse, { gain: 0.7, variants: 1, pitch: [0.95, 1.05] });
def('fizz', fizz, { gain: 0.6, variants: 2 });
def('splash', (sr, r) => splash(sr, r, false), { gain: 0.8, variants: 3 });
def('swim', swim, { gain: 0.4, variants: 4 });
def('bucket.fill', (sr, r) => bucket(sr, r, true), { gain: 0.7, variants: 2 });
def('bucket.empty', (sr, r) => bucket(sr, r, false), { gain: 0.7, variants: 2 });
def('break_tool', toolBreak, { gain: 0.8, variants: 2 });
def('pig', pig, { gain: 0.7, variants: 4 });
def('pig_hurt', pigHurt, { gain: 0.8, variants: 3 });
def('pig_death', (sr, r) => pigHurt(sr, r), { gain: 0.8, variants: 2, pitch: [0.75, 0.85] });
def('cow', cow, { gain: 0.75, variants: 4 });
def('cow_hurt', cowHurt, { gain: 0.8, variants: 3 });
def('cow_death', cowHurt, { gain: 0.8, variants: 2, pitch: [0.75, 0.85] });
def('sheep', (sr, r) => sheep(sr, r, false), { gain: 0.65, variants: 4 });
def('sheep_hurt', (sr, r) => sheep(sr, r, true), { gain: 0.75, variants: 3 });
def('sheep_death', (sr, r) => sheep(sr, r, true), { gain: 0.75, variants: 2, pitch: [0.75, 0.85] });
def('zombie', (sr, r) => zombie(sr, r, 'idle'), { gain: 0.75, variants: 4, pitch: [0.85, 1.1] });
def('zombie_hurt', (sr, r) => zombie(sr, r, 'hurt'), { gain: 0.8, variants: 3 });
def('zombie_death', (sr, r) => zombie(sr, r, 'death'), { gain: 0.85, variants: 2 });
def('creeper_hurt', creeperHurt, { gain: 0.7, variants: 3 });
def('creeper_death', creeperHurt, { gain: 0.8, variants: 2, pitch: [0.7, 0.8] });

def('chicken', chickenCluck, { gain: 0.55, variants: 4, pitch: [0.9, 1.15] });
def('chicken_hurt', chickenHurt, { gain: 0.6, variants: 3 });
def('chicken_death', chickenHurt, { gain: 0.6, variants: 2, pitch: [0.8, 0.9] });
def('skeleton', skeletonIdle, { gain: 0.6, variants: 4 });
def('skeleton_hurt', skeletonHurt, { gain: 0.75, variants: 3 });
def('skeleton_death', skeletonDeath, { gain: 0.8, variants: 2 });
def('spider', (sr, r) => spiderSay(sr, r, false), { gain: 0.55, variants: 4 });
def('spider_hurt', (sr, r) => spiderSay(sr, r, false), { gain: 0.65, variants: 2, pitch: [1.1, 1.3] });
def('spider_death', (sr, r) => spiderSay(sr, r, true), { gain: 0.7, variants: 2 });
def('bow', bowShoot, { gain: 0.7, variants: 3, pitch: [1, 1] });
def('arrow.hit', arrowHit, { gain: 0.6, variants: 3, pitch: [0.9, 1.2] });
def('orb', orbDing, { gain: 0.35, variants: 2, pitch: [1, 1] });
def('levelup', levelUp, { gain: 0.6, variants: 1, pitch: [1, 1] });
def('equip.leather', equipLeather, { gain: 0.7, variants: 2 });
def('equip.iron', equipIron, { gain: 0.6, variants: 2 });
def('bone_meal', boneMeal, { gain: 0.6, variants: 2 });
def('attack.strong', attackStrong, { gain: 0.6, variants: 3 });
def('attack.weak', attackWeak, { gain: 0.45, variants: 3 });
def('attack.sweep', attackSweep, { gain: 0.6, variants: 2 });
def('attack.crit', attackCrit, { gain: 0.65, variants: 2 });
def('attack.knockback', attackStrong, { gain: 0.7, variants: 2, pitch: [0.75, 0.85] });
def('throw', throwSound, { gain: 0.5, variants: 2, pitch: [1, 1] });
def('egg', eggPlop, { gain: 0.6, variants: 2 });

def('door.open', (sr, r) => doorSound(sr, r, true), { gain: 0.7, variants: 3 });
def('door.close', (sr, r) => doorSound(sr, r, false), { gain: 0.75, variants: 3 });
def('gate.open', (sr, r) => gateSound(sr, r, true), { gain: 0.6, variants: 2 });
def('gate.close', (sr, r) => gateSound(sr, r, false), { gain: 0.6, variants: 2 });
def('chest.open', (sr, r) => chestSound(sr, r, true), { gain: 0.6, variants: 2 });
def('chest.close', (sr, r) => chestSound(sr, r, false), { gain: 0.65, variants: 2 });

def('amb.wind', windLoop, { bus: 'ambient', variants: 1, loop: true, pitch: [1, 1] });
def('amb.underwater', underwaterLoop, { bus: 'ambient', variants: 1, loop: true, pitch: [1, 1] });
def('amb.water', waterLoop, { bus: 'ambient', variants: 1, loop: true, pitch: [1, 1] });
def('amb.bird', bird, { bus: 'ambient', gain: 0.35, variants: 6, range: 40, pitch: [0.9, 1.15] });
def('amb.cricket', cricket, { bus: 'ambient', gain: 0.25, variants: 3, range: 40 });
def('amb.cave', caveSound, { bus: 'ambient', gain: 0.6, variants: 6, range: 64, pitch: [0.8, 1.05] });
def('amb.drip', drip, { bus: 'ambient', gain: 0.35, variants: 3, range: 24 });
def('amb.lava', lavaPop, { bus: 'ambient', gain: 0.5, variants: 3, range: 20 });

// Sound names for each block material and action.
export function blockSound(material, action) {
  if (!material) return null;
  if (action === 'break' && material === 'glass') return 'break.glass';
  const m = material === 'glass' ? 'stone' : material;
  return action === 'step' || action === 'hit' ? `step.${m}` : `dig.${m}`;
}

