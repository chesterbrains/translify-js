import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BundleStorage, Entry } from './storage.js';

import { deleteEntry, localStorageStorage, memoryStorage, readEntry, writeEntry } from './storage.js';

const entry: Entry = { etag: '"x"', bundle: { 'a.b': 'c' }, fetchedAt: 5 };

const throwing: BundleStorage = {
  get() {
    throw new Error('q');
  },
  set() {
    throw new Error('q');
  },
  delete() {
    throw new Error('q');
  },
};

const fakeLocalStorage = () => {
  const map = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('memoryStorage', () => {
  it('round-trips and deletes', async () => {
    const storage = memoryStorage();
    await storage.set('a', '1');
    expect(await storage.get('a')).toBe('1');
    await storage.delete('a');
    expect(await storage.get('a')).toBeUndefined();
  });
});

describe('entries', () => {
  it('writeEntry then readEntry returns an equal entry', async () => {
    const storage = memoryStorage();
    await writeEntry(storage, 'k', entry);
    expect(await readEntry(storage, 'k')).toEqual(entry);
  });

  it('writes the versioned shape', async () => {
    const storage = memoryStorage();
    await writeEntry(storage, 'k', entry);
    expect(JSON.parse((await storage.get('k')) as string)).toEqual({ v: 1, etag: '"x"', bundle: { 'a.b': 'c' }, fetchedAt: 5 });
  });

  it('keeps an undefined etag', async () => {
    const storage = memoryStorage();
    await writeEntry(storage, 'k', { ...entry, etag: undefined });
    expect((await readEntry(storage, 'k'))?.etag).toBeUndefined();
  });

  it('readEntry misses on an absent key', async () => {
    expect(await readEntry(memoryStorage(), 'k')).toBeUndefined();
  });

  it('readEntry deletes and misses on corrupt json', async () => {
    const storage = memoryStorage();
    await storage.set('k', '{nope');
    expect(await readEntry(storage, 'k')).toBeUndefined();
    expect(await storage.get('k')).toBeUndefined();
  });

  it('readEntry deletes and misses on an older shape', async () => {
    const storage = memoryStorage();
    await storage.set('k', JSON.stringify({ etag: '"x"', bundle: {} }));
    expect(await readEntry(storage, 'k')).toBeUndefined();
    expect(await storage.get('k')).toBeUndefined();
  });

  it('readEntry rejects a bundle whose values are not all strings', async () => {
    const storage = memoryStorage();
    await storage.set('k', JSON.stringify({ v: 1, etag: '"x"', bundle: { a: 1 }, fetchedAt: 1 }));
    expect(await readEntry(storage, 'k')).toBeUndefined();
    expect(await storage.get('k')).toBeUndefined();
  });

  it('deleteEntry removes the key', async () => {
    const storage = memoryStorage();
    await writeEntry(storage, 'k', entry);
    await deleteEntry(storage, 'k');
    expect(await storage.get('k')).toBeUndefined();
  });

  it('a storage that throws never propagates', async () => {
    await expect(readEntry(throwing, 'k')).resolves.toBeUndefined();
    await expect(writeEntry(throwing, 'k', entry)).resolves.toBeUndefined();
    await expect(deleteEntry(throwing, 'k')).resolves.toBeUndefined();
  });

  it('a storage that rejects never propagates', async () => {
    const rejecting: BundleStorage = {
      get: () => Promise.reject(new Error('q')),
      set: () => Promise.reject(new Error('q')),
      delete: () => Promise.reject(new Error('q')),
    };
    await expect(readEntry(rejecting, 'k')).resolves.toBeUndefined();
    await expect(writeEntry(rejecting, 'k', entry)).resolves.toBeUndefined();
  });
});

describe('localStorageStorage', () => {
  it('is a no-op without localStorage', async () => {
    vi.stubGlobal('localStorage', undefined);
    const storage = localStorageStorage();
    await storage.set('a', '1');
    expect(await storage.get('a')).toBeUndefined();
    expect(await storage.delete('a')).toBeUndefined();
  });

  it('uses globalThis.localStorage when present', async () => {
    const fake = fakeLocalStorage();
    vi.stubGlobal('localStorage', fake);
    const storage = localStorageStorage();
    await storage.set('a', '1');
    expect(fake.setItem).toHaveBeenCalledWith('a', '1');
    expect(await storage.get('a')).toBe('1');
    await storage.delete('a');
    expect(fake.removeItem).toHaveBeenCalledWith('a');
    expect(await storage.get('a')).toBeUndefined();
  });

  it('swallows a quota error on set', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('q', 'QuotaExceededError');
      },
      removeItem() {},
    });
    expect(await localStorageStorage().set('a', '1')).toBeUndefined();
  });

  it('swallows an accessor that throws (private mode)', async () => {
    const globalObject = globalThis as { localStorage?: unknown };
    const descriptor = Object.getOwnPropertyDescriptor(globalObject, 'localStorage');
    Object.defineProperty(globalObject, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      const storage = localStorageStorage();
      expect(await storage.get('a')).toBeUndefined();
      expect(await storage.set('a', '1')).toBeUndefined();
    } finally {
      if (descriptor === undefined) delete globalObject.localStorage;
      else Object.defineProperty(globalObject, 'localStorage', descriptor);
    }
  });
});
