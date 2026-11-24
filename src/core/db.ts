// IndexedDB 封装：石料库 stones、方案 projects、设置 settings（单例）
import { AppSettings, DEFAULT_SETTINGS, ProjectDoc, StoneDef } from './types';

const DB_NAME = 'rockery-studio-db';
const DB_VERSION = 1;
const STORE_STONES = 'stones';
const STORE_PROJECTS = 'projects';
const STORE_KV = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STONES)) {
        const s = db.createObjectStore(STORE_STONES, { keyPath: 'id' });
        s.createIndex('species', 'species', { unique: false });
        s.createIndex('code', 'code', { unique: true });
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode,
                fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// ---------- 石料 ----------
export async function putStone(stone: StoneDef): Promise<void> {
  await tx(STORE_STONES, 'readwrite', s => s.put(stone));
}
export async function putStones(stones: StoneDef[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE_STONES, 'readwrite');
    const s = t.objectStore(STORE_STONES);
    for (const st of stones) s.put(st);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
export async function getAllStones(): Promise<StoneDef[]> {
  return tx(STORE_STONES, 'readonly', s => s.getAll() as IDBRequest<StoneDef[]>);
}
export async function deleteStone(id: string): Promise<void> {
  await tx(STORE_STONES, 'readwrite', s => s.delete(id));
}

// ---------- 方案 ----------
export async function putProject(p: ProjectDoc): Promise<void> {
  await tx(STORE_PROJECTS, 'readwrite', s => s.put(p));
}
export async function getAllProjects(): Promise<ProjectDoc[]> {
  return tx(STORE_PROJECTS, 'readonly', s => s.getAll() as IDBRequest<ProjectDoc[]>);
}
export async function deleteProject(id: string): Promise<void> {
  await tx(STORE_PROJECTS, 'readwrite', s => s.delete(id));
}

// ---------- 设置 ----------
export async function loadSettings(): Promise<AppSettings> {
  const v = await tx(STORE_KV, 'readonly', s => s.get('settings') as IDBRequest<AppSettings | undefined>);
  // 合并默认值，兼容后续新增字段
  return v ? { ...DEFAULT_SETTINGS, ...v, density: { ...DEFAULT_SETTINGS.density, ...v.density } }
           : structuredClone(DEFAULT_SETTINGS);
}
export async function saveSettings(s: AppSettings): Promise<void> {
  await tx(STORE_KV, 'readwrite', kv => kv.put(s, 'settings'));
}
