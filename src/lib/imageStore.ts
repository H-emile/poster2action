/**
 * 上传海报的图片存哪：localStorage 只放字段 JSON（几 KB），图片走 IndexedDB。
 *
 * 为什么不用 dataURL 塞进 localStorage：一张手机拍的海报 2–5MB，base64 之后更大，
 * 5MB 配额一两次就撑爆，而且每次保存都要重写整串。
 *
 * 浏览器不支持 IndexedDB（或隐私模式禁用）时退化成内存 Map：
 * 这一轮能正常用，刷新后原图就没了 —— 界面会如实说明「这张图只在这一轮里」。
 */

const DB_NAME = 'p2a-img';
const STORE = 'posters';
const VERSION = 1;

const memory = new Map<string, Blob>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

export async function putPoster(id: string, blob: Blob): Promise<'idb' | 'memory'> {
  const ok = await tx('readwrite', (store) => store.put(blob, id));
  if (ok === null) {
    memory.set(id, blob);
    return 'memory';
  }
  return 'idb';
}

export async function getPoster(id: string): Promise<Blob | null> {
  const blob = await tx<Blob>('readonly', (store) => store.get(id));
  if (blob instanceof Blob) return blob;
  return memory.get(id) ?? null;
}

export async function delPoster(id: string): Promise<void> {
  memory.delete(id);
  await tx('readwrite', (store) => store.delete(id));
}
