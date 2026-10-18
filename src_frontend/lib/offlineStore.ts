import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface TheySyncedDBSchema extends DBSchema {
  assets: {
    key: string; // asset_id
    value: {
      id: string;
      company_id: string;
      title: string;
      asset_type: 'excalidraw' | 'spreadsheet' | 'document' | 'pdf';
      content: string;
      updated_at: string;
      synced: boolean;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<TheySyncedDBSchema>> | null = null;

function getDB() {
  if (typeof window === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB<TheySyncedDBSchema>('TheySyncedOfflineDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveAssetOffline(asset: {
  id: string;
  company_id: string;
  title: string;
  asset_type: 'excalidraw' | 'spreadsheet' | 'document' | 'pdf';
  content: string;
}) {
  const item = {
    ...asset,
    updated_at: new Date().toISOString(),
    synced: typeof navigator !== 'undefined' ? navigator.onLine : true,
  };

  // LocalStorage fallback
  try {
    localStorage.setItem(`theysynced_asset_${asset.id}`, JSON.stringify(item));
  } catch (e) {
    console.warn('LocalStorage save warning:', e);
  }

  // IndexedDB primary storage
  const db = await getDB();
  if (db) {
    await db.put('assets', item);
  }
  return item;
}

export async function getAssetOffline(id: string) {
  const db = await getDB();
  if (db) {
    const item = await db.get('assets', id);
    if (item) return item;
  }
  try {
    const raw = localStorage.getItem(`theysynced_asset_${id}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  return null;
}

export async function getAllOfflineAssets(companyId: string) {
  const db = await getDB();
  if (db) {
    const all = await db.getAll('assets');
    return all.filter((a) => a.company_id === companyId);
  }
  return [];
}
