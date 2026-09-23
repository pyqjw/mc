// Renders sound samples off the main thread.
import { SOUNDS } from './sounds.js';
import { pianoNote } from './music.js';
import { mulberry32 } from '../world/noise.js';

// Sounds needed right away are rendered first.
const PRIORITY = ['click', 'pop', 'hurt', 'step.', 'dig.', 'fall.', 'eat', 'burp', 'amb.wind'];

function order(names) {
  const rank = (n) => {
    const i = PRIORITY.findIndex((p) => n === p || (p.endsWith('.') && n.startsWith(p)));
    return i < 0 ? PRIORITY.length : i;
  };
  return [...names].sort((a, b) => rank(a) - rank(b));
}

function hash(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'all') {
    for (const name of order(Object.keys(SOUNDS))) {
      const def = SOUNDS[name];
      const variants = [];
      const transfer = [];
      for (let v = 0; v < def.variants; v++) {
        const out = def.gen(msg.sr, mulberry32(hash(name) + v * 7919));
        const chans = Array.isArray(out) ? out : [out];
        variants.push(chans);
        for (const c of chans) transfer.push(c.buffer);
      }
      self.postMessage({ type: 'sound', name, variants }, transfer);
    }
    self.postMessage({ type: 'done' });
  } else if (msg.type === 'piano') {
    const data = pianoNote(msg.sr, msg.midi, mulberry32(msg.midi * 7919));
    self.postMessage({ type: 'piano', midi: msg.midi, data }, [data.buffer]);
  }
};
