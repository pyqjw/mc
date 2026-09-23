// Web worker: terrain generation and chunk meshing off the main thread.
import { TerrainGenerator } from './generator.js';
import { buildChunkMesh } from './mesher.js';

let generator = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    generator = new TerrainGenerator(msg.seed);
    return;
  }
  if (msg.type === 'generate') {
    const { blocks, meta } = generator.generateChunk(msg.cx, msg.cz);
    self.postMessage({ type: 'generated', id: msg.id, cx: msg.cx, cz: msg.cz, blocks, meta }, [blocks.buffer, meta.buffer]);
    return;
  }
  if (msg.type === 'mesh') {
    const r = buildChunkMesh(msg.chunks);
    const transfer = [r.skyLight.buffer, r.blockLight.buffer];
    for (const k of ['solid', 'cutout', 'translucent']) {
      const g = r[k];
      transfer.push(g.positions.buffer, g.uvs.buffer, g.light.buffer, g.indices.buffer);
    }
    self.postMessage({ type: 'meshed', id: msg.id, cx: msg.cx, cz: msg.cz, version: msg.version, ...r }, transfer);
  }
};
