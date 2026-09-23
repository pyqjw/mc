import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUNDS, blockSound } from '../src/audio/sounds.js';
import { composePiece, pianoNote } from '../src/audio/music.js';
import { mulberry32 } from '../src/world/noise.js';
import { BLOCKS } from '../src/world/blocks.js';

test('every sound renders clean, audible samples', () => {
  const sr = 22050;
  for (const [name, def] of Object.entries(SOUNDS)) {
    const out = def.gen(sr, mulberry32(1));
    const chans = Array.isArray(out) ? out : [out];
    for (const c of chans) {
      let peak = 0;
      for (const v of c) {
        assert.ok(Number.isFinite(v), `${name} produced a non-finite sample`);
        peak = Math.max(peak, Math.abs(v));
      }
      assert.ok(peak > 0.05 && peak <= 1, `${name} peak ${peak}`);
    }
  }
});

test('every block material has step, dig and place sounds', () => {
  for (const b of BLOCKS) {
    if (!b || !b.sound) continue;
    for (const action of ['step', 'hit', 'break', 'place']) {
      assert.ok(SOUNDS[blockSound(b.sound, action)], `${b.key} ${action}`);
    }
  }
});

test('music pieces are playable note sequences', () => {
  for (let seed = 0; seed < 20; seed++) {
    const p = composePiece(seed);
    assert.ok(p.events.length > 20);
    for (const e of p.events) {
      assert.ok(e.midi >= 24 && e.midi <= 96, `note ${e.midi}`);
      assert.ok(e.time >= 0 && e.time <= p.length);
    }
  }
  const n = pianoNote(22050, 60, mulberry32(3));
  assert.ok(n.every(Number.isFinite));
});
