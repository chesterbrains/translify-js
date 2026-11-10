/** Where entries persist between page loads. Values are JSON strings the package serialises itself. */
export interface BundleStorage {
  get(key: string): Promise<string | undefined> | string | undefined;
  set(key: string, value: string): Promise<void> | void;
  delete(key: string): Promise<void> | void;
}

/** A delivery bundle as served: flat `<namespace>.<keyName>` → value. */
export type Bundle = Readonly<Record<string, string>>;

/** What is held per (locale, namespace): the bundle, its validator and when it was last confirmed. */
export interface Entry {
  etag: string | undefined;
  bundle: Bundle;
  fetchedAt: number;
}

/** The default: lives as long as the client does. */
export const memoryStorage = (): BundleStorage => {
  const map = new Map<string, string>();

  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
  };
};

/**
 * `localStorage` when the page has one. Every access is guarded: private mode, a disabled
 * store or a full quota turn the adapter into a no-op rather than an error.
 */
export const localStorageStorage = (): BundleStorage => {
  const store = (): Storage | undefined => {
    try {
      const candidate = (globalThis as { localStorage?: Storage }).localStorage;

      return candidate === undefined || candidate === null ? undefined : candidate;
    } catch {
      return undefined;
    }
  };

  return {
    get: (key) => {
      try {
        return store()?.getItem(key) ?? undefined;
      } catch {
        return undefined;
      }
    },
    set: (key, value) => {
      try {
        store()?.setItem(key, value);
      } catch {
        // quota, private mode: the cache is a convenience, never a failure
      }
    },
    delete: (key) => {
      try {
        store()?.removeItem(key);
      } catch {
        // same
      }
    },
  };
};

const ENTRY_VERSION = 1;

/** A delivery body or a stored bundle: a flat object whose values are all strings. */
export const isBundle = (value: unknown): value is Bundle =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string');

const parseEntry = (text: string): Entry | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (record.v !== ENTRY_VERSION || !isBundle(record.bundle) || typeof record.fetchedAt !== 'number') return undefined;
  if (record.etag !== undefined && typeof record.etag !== 'string') return undefined;

  return { etag: record.etag, bundle: record.bundle, fetchedAt: record.fetchedAt };
};

/** Swallows every storage failure. */
export const deleteEntry = async (storage: BundleStorage, key: string): Promise<void> => {
  try {
    await storage.delete(key);
  } catch {
    // a storage that cannot delete is treated as empty on the next read anyway
  }
};

/** A corrupt or out-of-date entry is deleted and read as a miss; a throwing storage is a miss. */
export const readEntry = async (storage: BundleStorage, key: string): Promise<Entry | undefined> => {
  let text: string | undefined;
  try {
    text = await storage.get(key);
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;

  const entry = parseEntry(text);
  if (entry === undefined) await deleteEntry(storage, key);

  return entry;
};

/** Writes `{ v: 1, etag, bundle, fetchedAt }`; a throwing storage is ignored. */
export const writeEntry = async (storage: BundleStorage, key: string, entry: Entry): Promise<void> => {
  try {
    await storage.set(key, JSON.stringify({ v: ENTRY_VERSION, etag: entry.etag, bundle: entry.bundle, fetchedAt: entry.fetchedAt }));
  } catch {
    // quota or disabled storage: the in-memory copy still serves this session
  }
};
