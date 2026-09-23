// Global world constants shared by the main thread and workers.
export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 128;
export const SEA_LEVEL = 62;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * WORLD_HEIGHT;

export const TICKS_PER_SECOND = 20;
export const TICK_TIME = 1 / TICKS_PER_SECOND;
export const DAY_LENGTH = 24000; // ticks, same as Minecraft (20 minutes)

// Index of a block inside a chunk's flat array. x,z in [0,16), y in [0,128).
export function blockIndex(x, y, z) {
  return x | (z << 4) | (y << 8);
}

export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

export function floorDiv(a, b) {
  return Math.floor(a / b);
}

export function mod(a, b) {
  return ((a % b) + b) % b;
}
