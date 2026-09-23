// IndexedDB persistence for worlds and modified chunks.
const DB_NAME = 'webcraft';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class Storage {
  constructor() {
    this.db = null;
    this.memory = null; // fallback when IndexedDB is unavailable
  }

  async open() {
    if (typeof indexedDB === 'undefined') {
      this.memory = { worlds: new Map(), chunks: new Map() };
      return this;
    }
    try {
      this.db = await new Promise((resolve, reject) => {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } catch (e) {
      console.warn('IndexedDB unavailable, worlds will not be saved', e);
      this.memory = { worlds: new Map(), chunks: new Map() };
    }
    return this;
  }

  store(name, mode) {
    return this.db.transaction(name, mode).objectStore(name);
  }

  async listWorlds() {
    if (this.memory) return [...this.memory.worlds.values()];
    const all = await req(this.store('worlds', 'readonly').getAll());
    return all.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  }

  async getWorld(id) {
    if (this.memory) return this.memory.worlds.get(id) || null;
    return (await req(this.store('worlds', 'readonly').get(id))) || null;
  }

  async putWorld(world) {
    if (this.memory) { this.memory.worlds.set(world.id, world); return; }
    await req(this.store('worlds', 'readwrite').put(world));
  }

  async deleteWorld(id) {
    if (this.memory) {
      this.memory.worlds.delete(id);
      for (const k of [...this.memory.chunks.keys()]) if (k.startsWith(id + ':')) this.memory.chunks.delete(k);
      return;
    }
    await req(this.store('worlds', 'readwrite').delete(id));
    await req(this.store('chunks', 'readwrite').delete(IDBKeyRange.bound(id + ':', id + ':￿')));
  }

  async chunkKeys(worldId) {
    if (this.memory) {
      return [...this.memory.chunks.keys()].filter((k) => k.startsWith(worldId + ':')).map((k) => k.slice(worldId.length + 1));
    }
    const keys = await req(this.store('chunks', 'readonly').getAllKeys(IDBKeyRange.bound(worldId + ':', worldId + ':￿')));
    return keys.map((k) => k.slice(worldId.length + 1));
  }

  async getChunk(worldId, key) {
    if (this.memory) return this.memory.chunks.get(worldId + ':' + key) || null;
    return (await req(this.store('chunks', 'readonly').get(worldId + ':' + key))) || null;
  }

  async putChunks(worldId, records) {
    if (records.length === 0) return;
    if (this.memory) {
      for (const r of records) this.memory.chunks.set(worldId + ':' + r.key, r);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('chunks', 'readwrite');
      const st = tx.objectStore('chunks');
      for (const r of records) st.put(r, worldId + ':' + r.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
