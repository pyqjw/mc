// Weather cycle like Minecraft: rain and thunder toggle on their own random timers and fade in and
// out; snow instead of rain in cold places.
import { SNOW_TEMP } from './generator.js';

const rand = Math.random;

export class Weather {
  constructor(state = null) {
    this.raining = false;
    this.thundering = false;
    // Ticks until the next change. A new world gets its first rain within the first few days.
    this.rainTime = 6000 + Math.floor(rand() * 42000);
    this.thunderTime = 12000 + Math.floor(rand() * 168000);
    this.rain = 0; // 0..1 strength
    this.thunder = 0;
    if (state) Object.assign(this, state);
  }

  tick() {
    if (--this.thunderTime <= 0) {
      this.thundering = !this.thundering;
      this.thunderTime = this.thundering ? 3600 + Math.floor(rand() * 12000) : 12000 + Math.floor(rand() * 168000);
    }
    if (--this.rainTime <= 0) {
      this.raining = !this.raining;
      this.rainTime = this.raining ? 12000 + Math.floor(rand() * 12000) : 12000 + Math.floor(rand() * 168000);
    }
    const step = 0.01;
    this.rain = Math.max(0, Math.min(1, this.rain + (this.raining ? step : -step)));
    this.thunder = Math.max(0, Math.min(1, this.thunder + (this.raining && this.thundering ? step : -step)));
  }

  get storming() {
    return this.thunder > 0.9;
  }

  // Sleeping through the night clears the weather.
  clear() {
    this.raining = false;
    this.thundering = false;
    this.rainTime = 12000 + Math.floor(rand() * 168000);
    this.thunderTime = 12000 + Math.floor(rand() * 168000);
  }

  set(kind) {
    this.raining = kind !== 'clear';
    this.thundering = kind === 'thunder';
    this.rainTime = 12000 + Math.floor(rand() * 12000);
    this.thunderTime = this.thundering ? 3600 + Math.floor(rand() * 12000) : 12000 + Math.floor(rand() * 168000);
  }

  toJSON() {
    const { raining, thundering, rainTime, thunderTime, rain, thunder } = this;
    return { raining, thundering, rainTime, thunderTime, rain, thunder };
  }
}

// Is it cold enough to snow at this column/height? (Minecraft: biome temperature below 0.15.)
export function snowsAt(generator, x, z, y) {
  const c = generator.column(x, z);
  return c.temp < SNOW_TEMP || y > 100;
}
