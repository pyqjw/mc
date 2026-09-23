// Sound engine: sample playback with 3D positioning, reverb (stronger in caves), an underwater
// muffle filter, looping and one-shot ambience (wind, birds, crickets, caves, water, lava) and music.
import { SOUNDS } from './sounds.js';
import { impulseResponse } from './dsp.js';
import { MusicPlayer } from './music.js';
import { mulberry32 } from '../world/noise.js';

const MAX_VOICES = 48;

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.musicVolume = 0.5;
    this.buffers = new Map();
    this.listener = { x: 0, y: 0, z: 0 };
    this.voices = 0;
    this.env = null;
    this.loops = {};
    this.timers = { bird: 3, cricket: 2, cave: 40, drip: 8, lava: 1 };
    this.pianoWaiting = new Map();
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);

    // World sounds pass through a low-pass filter that closes when the head is under water.
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.ambientBus = ctx.createGain();
    this.sfxBus.connect(this.muffle);
    this.ambientBus.connect(this.muffle);

    const rand = mulberry32(12345);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.toBuffer(impulseResponse(ctx.sampleRate, 2.8, rand, { decay: 2.2, damping: 0.5 }));
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.12;
    this.sfxBus.connect(this.reverbSend);
    this.ambientBus.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.muffle);

    // Music gets its own lush hall reverb and is not muffled.
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * 0.6;
    const hall = ctx.createConvolver();
    hall.buffer = this.toBuffer(impulseResponse(ctx.sampleRate, 4.5, rand, { decay: 1.6, damping: 0.6 }));
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    this.musicBus.connect(this.master);
    this.musicBus.connect(hall);
    hall.connect(wet);
    wet.connect(this.master);

    this.music = new MusicPlayer(this);
    this.worker = new Worker(new URL('./soundWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.worker.postMessage({ type: 'all', sr: ctx.sampleRate });
    this.ambientTimer = setInterval(() => this.updateAmbient(0.1), 100);
    return ctx;
  }

  toBuffer(chans) {
    const b = this.ctx.createBuffer(chans.length, chans[0].length, this.ctx.sampleRate);
    chans.forEach((c, i) => b.copyToChannel(c, i));
    return b;
  }

  onWorker(msg) {
    if (msg.type === 'sound') {
      this.buffers.set(msg.name, msg.variants.map((v) => this.toBuffer(v)));
    } else if (msg.type === 'piano') {
      const b = this.ctx.createBuffer(1, msg.data.length, this.ctx.sampleRate);
      b.copyToChannel(msg.data, 0);
      const cb = this.pianoWaiting.get(msg.midi);
      this.pianoWaiting.delete(msg.midi);
      if (cb) cb(b);
    }
  }

  // Asks the worker for a piano note; `cb(buffer)` is called when ready.
  requestPiano(midi, cb) {
    if (this.pianoWaiting.has(midi)) return;
    this.pianoWaiting.set(midi, cb);
    this.worker.postMessage({ type: 'piano', sr: this.ctx.sampleRate, midi });
  }

  resume() {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    this.music.start(3);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.1);
  }

  // Plays a sound. With a position it is placed in 3D; without one it plays "in your head".
  play(name, x, y, z, vol = 1, pitch = 1) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.volume <= 0) return null;
    const def = SOUNDS[name];
    const variants = this.buffers.get(name);
    if (!def || !variants || this.voices >= MAX_VOICES) return null;
    const positional = x !== undefined && x !== null;
    if (positional) {
      const l = this.listener;
      const d = Math.hypot(x - l.x, y - l.y, z - l.z);
      if (d > def.range) return null;
    }
    const src = ctx.createBufferSource();
    src.buffer = variants[Math.floor(Math.random() * variants.length)];
    src.playbackRate.value = pitch * (def.pitch[0] + Math.random() * (def.pitch[1] - def.pitch[0]));
    const g = ctx.createGain();
    g.gain.value = def.gain * vol;
    src.connect(g);
    const bus = def.bus === 'ambient' ? this.ambientBus : this.sfxBus;
    if (positional) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'linear';
      p.refDistance = 1.5;
      p.maxDistance = def.range;
      p.rolloffFactor = 1;
      if (p.positionX) {
        p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
      } else {
        p.setPosition(x, y, z);
      }
      g.connect(p).connect(bus);
    } else {
      g.connect(bus);
    }
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start();
    return src;
  }

  setListener(pos, fwd, up) {
    this.listener = { x: pos.x, y: pos.y, z: pos.z };
    const l = this.ctx && this.ctx.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t); l.upY.setValueAtTime(up.y, t); l.upZ.setValueAtTime(up.z, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // env: { underwater, cave 0..1, outdoors 0..1, day 0..1, altitude, nearWater 0..1, nearLava 0..1, birds, paused } or null.
  setEnvironment(env) {
    this.env = env;
  }

  loop(name) {
    if (this.loops[name]) return this.loops[name];
    const variants = this.buffers.get(name);
    if (!variants) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = variants[0];
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(name === 'amb.underwater' ? this.master : this.ambientBus);
    src.start();
    this.loops[name] = { src, gain: g };
    return this.loops[name];
  }

  setLoopGain(name, v) {
    const l = v > 0.001 || this.loops[name] ? this.loop(name) : null;
    if (l) l.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
  }

  // Plays an ambient one-shot somewhere around the listener.
  around(name, minD, maxD, dy, vol) {
    const a = Math.random() * Math.PI * 2;
    const d = minD + Math.random() * (maxD - minD);
    const l = this.listener;
    this.play(name, l.x + Math.cos(a) * d, l.y + dy * Math.random(), l.z + Math.sin(a) * d, vol);
  }

  updateAmbient(dt) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const env = this.env;
    const active = env && !env.paused;
    const t = ctx.currentTime;
    const under = active && env.underwater;
    this.muffle.frequency.setTargetAtTime(under ? 650 : 20000, t, 0.08);
    this.reverbSend.gain.setTargetAtTime(active ? 0.1 + env.cave * 0.55 + (under ? 0.25 : 0) : 0.1, t, 0.5);

    const wind = active && !under ? env.outdoors * (0.06 + Math.min(1, Math.max(0, (env.altitude - 70) / 45)) * 0.3) : 0;
    this.setLoopGain('amb.wind', wind);
    this.setLoopGain('amb.underwater', under ? 0.45 : 0);
    this.setLoopGain('amb.water', active && !under ? env.nearWater * 0.35 : 0);
    if (!active) return;

    const tm = this.timers;
    for (const k of Object.keys(tm)) tm[k] -= dt;
    if (tm.bird <= 0) {
      tm.bird = 2 + Math.random() * 7;
      if (env.day > 0.75 && env.outdoors > 0.6 && env.birds && !under) this.around('amb.bird', 6, 22, 8, 1);
    }
    if (tm.cricket <= 0) {
      tm.cricket = 1 + Math.random() * 4;
      if (env.day < 0.45 && env.outdoors > 0.5 && !under) this.around('amb.cricket', 5, 18, 2, 1);
    }
    if (tm.cave <= 0) {
      tm.cave = 50 + Math.random() * 130;
      if (env.cave > 0.6) this.around('amb.cave', 8, 20, 6, 1);
    }
    if (tm.drip <= 0) {
      tm.drip = 3 + Math.random() * 12;
      if (env.cave > 0.6) this.around('amb.drip', 3, 10, 4, 1);
    }
    if (tm.lava <= 0) {
      tm.lava = 0.4 + Math.random() * 2;
      if (env.nearLava > 0.02 && Math.random() < env.nearLava * 6) this.around('amb.lava', 2, 8, 2, 1);
    }
  }
}
