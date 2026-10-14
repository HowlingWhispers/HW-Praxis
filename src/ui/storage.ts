// Saves in the browser's IndexedDB, with each module stored beside them so a save can always
// be reopened. Clearing the site's data clears these; exporting a save is the backup.
import { loadModule, parseSave, type PraxisModule, type Save } from '../engine';

const DB_NAME = 'praxis';
const DB_VERSION = 1;

export interface SaveRecord {
  id: string;
  name: string;
  moduleKey: string;
  moduleName: string;
  updatedAt: number;
  // A summary for the list, so it can be shown without opening the save.
  place: string;
  stamp: string;
  turns: number;
  save: Save;
}

export const moduleKey = (module: PraxisModule) => `${module.id}@${module.version}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('This browser cannot store saves.')); return; }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('modules')) db.createObjectStore('modules', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open saved games.'));
  });
}

async function run<T>(store: 'saves' | 'modules', mode: IDBTransactionMode, work: (objects: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = work(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Saving failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving was interrupted.'));
    });
  } finally {
    db.close();
  }
}

export async function listSaves(): Promise<SaveRecord[]> {
  const records = await run<SaveRecord[]>('saves', 'readonly', (store) => store.getAll() as IDBRequest<SaveRecord[]>);
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function putSave(record: SaveRecord): Promise<IDBValidKey> {
  return run('saves', 'readwrite', (store) => store.put(record));
}

export function deleteSave(id: string): Promise<undefined> {
  return run('saves', 'readwrite', (store) => store.delete(id));
}

export function putModule(module: PraxisModule): Promise<IDBValidKey> {
  return run('modules', 'readwrite', (store) => store.put({ key: moduleKey(module), module }));
}

// Reopens a save, validating both the stored module and the save against it.
export async function openSave(record: SaveRecord): Promise<{ ok: true; module: PraxisModule; save: Save } | { ok: false; errors: string[] }> {
  const stored = await run<{ module: unknown } | undefined>('modules', 'readonly', (store) => store.get(record.moduleKey) as IDBRequest<{ module: unknown } | undefined>);
  if (!stored) return { ok: false, errors: [`The module for this save (${record.moduleName}) is missing from this browser.`] };
  const loaded = loadModule(stored.module);
  if (!loaded.ok) return loaded;
  const save = parseSave(loaded.module, record.save);
  if (!save.ok) return save;
  return { ok: true, module: loaded.module, save: save.save };
}
