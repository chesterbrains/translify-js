import type { TranslifyBundle, TranslifyKey } from './keys.js';
import type { ResolvedOptions, TranslifyOptions } from './options.js';
import type { Entry } from './storage.js';
import type { EntryRef } from './url.js';

import { TranslifyError, isDefinitive } from './errors.js';
import { fetchEntry } from './fetcher.js';
import { resolveOptions } from './options.js';
import { deleteEntry, readEntry, writeEntry } from './storage.js';
import { entryRef } from './url.js';

export interface TranslifyClient {
  /** Resolves with the locale's bundle once one is usable (cache or network). */
  load(locale: string): Promise<TranslifyBundle>;
  /** Sync read of a loaded bundle. Never fetches. */
  get(locale: string, key: TranslifyKey): string | undefined;
  /** The loaded bundle, same object until it changes (safe for `useSyncExternalStore`). */
  bundle(locale: string): TranslifyBundle | undefined;
  /** Called after any bundle changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Revalidate now; rejects on failure since the caller asked. */
  refresh(locale: string): Promise<TranslifyBundle>;
  /** Abort in-flight requests and drop listeners. */
  dispose(): void;
}

const sameBundle = (a: TranslifyBundle, b: Readonly<Record<string, string>>): boolean => {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;

  return keysA.every((key) => (a as Record<string, string>)[key] === b[key]);
};

const asTranslifyError = (reason: unknown): TranslifyError =>
  reason instanceof TranslifyError ? reason : new TranslifyError('NETWORK', `network error: ${String(reason)}`);

export const createTranslify = (options: TranslifyOptions): TranslifyClient => {
  const resolved: ResolvedOptions = resolveOptions(options);
  const entries = new Map<string, Entry>();
  const bundles = new Map<string, TranslifyBundle>();
  const inflight = new Map<string, Promise<Entry>>();
  const listeners = new Set<() => void>();
  const controller = new AbortController();
  let disposed = false;

  const refs = (locale: string): EntryRef[] =>
    (resolved.namespaces ?? [undefined]).map((namespace) => entryRef(resolved, locale, namespace));

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // a listener's failure is its own
      }
    }
  };

  /** Merge the locale's entries into one frozen bundle; keep identity when nothing changed. */
  const publish = (locale: string): TranslifyBundle => {
    const merged: Record<string, string> = {};
    for (const ref of refs(locale)) Object.assign(merged, entries.get(ref.storageKey)?.bundle);
    const previous = bundles.get(locale);
    if (previous !== undefined && sameBundle(previous, merged)) return previous;

    const next = Object.freeze(merged) as TranslifyBundle;
    bundles.set(locale, next);
    notify();

    return next;
  };

  const store = async (ref: EntryRef, entry: Entry): Promise<void> => {
    entries.set(ref.storageKey, entry);
    await writeEntry(resolved.storage, ref.storageKey, entry);
  };

  /** One request per entry at a time; concurrent callers share it. */
  const request = (ref: EntryRef, etag: string | undefined): Promise<Entry> => {
    const pending = inflight.get(ref.storageKey);
    if (pending !== undefined) return pending;

    const held = entries.get(ref.storageKey);
    const run = (async (): Promise<Entry> => {
      const outcome = await fetchEntry(resolved.fetch, ref.url, etag, controller.signal);
      if (outcome.kind === 'notModified') {
        if (held === undefined) throw new TranslifyError('SERVER', '304 without a validator', 304);
        const confirmed: Entry = { ...held, fetchedAt: Date.now() };
        await store(ref, confirmed);

        return confirmed;
      }
      await store(ref, outcome.entry);

      return outcome.entry;
    })().finally(() => inflight.delete(ref.storageKey));
    inflight.set(ref.storageKey, run);

    return run;
  };

  /** Revalidate a held entry and apply the failure policy (spec §6 step 3). Rethrows after reporting. */
  const revalidate = async (ref: EntryRef): Promise<void> => {
    const held = entries.get(ref.storageKey);
    try {
      await request(ref, held?.etag);
    } catch (reason) {
      const error = asTranslifyError(reason);
      if (isDefinitive(error.code)) await deleteEntry(resolved.storage, ref.storageKey);
      resolved.onError(error);
      throw error;
    }
  };

  /** Memory, then storage. */
  const held = async (ref: EntryRef): Promise<Entry | undefined> => {
    const inMemory = entries.get(ref.storageKey);
    if (inMemory !== undefined) return inMemory;
    const stored = await readEntry(resolved.storage, ref.storageKey);
    if (stored !== undefined) entries.set(ref.storageKey, stored);

    return stored;
  };

  const assertLive = (): void => {
    if (disposed) throw new TranslifyError('INVALID_OPTIONS', 'client disposed');
  };

  const background = (ref: EntryRef, locale: string): void => {
    void revalidate(ref)
      .then(() => publish(locale))
      .catch(() => undefined);
  };

  const load = async (locale: string): Promise<TranslifyBundle> => {
    assertLive();
    const locus = refs(locale);
    const presence = await Promise.all(locus.map(held));
    const missing = locus.filter((_, index) => presence[index] === undefined);

    if (missing.length === 0) {
      const bundle = publish(locale);
      for (const ref of locus) background(ref, locale);

      return bundle;
    }

    for (const ref of locus) if (!missing.includes(ref)) background(ref, locale);
    const results = await Promise.allSettled(missing.map((ref) => request(ref, undefined)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed !== undefined) throw asTranslifyError(failed.reason);

    return publish(locale);
  };

  const refresh = async (locale: string): Promise<TranslifyBundle> => {
    assertLive();
    const locus = refs(locale);
    const presence = await Promise.all(locus.map(held));
    if (presence.some((entry) => entry === undefined)) return load(locale);

    const results = await Promise.allSettled(locus.map(revalidate));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed !== undefined) throw asTranslifyError(failed.reason);

    return publish(locale);
  };

  return {
    load,
    get: (locale, key) => bundles.get(locale)?.[key],
    bundle: (locale) => bundles.get(locale),
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    dispose: () => {
      disposed = true;
      controller.abort();
      listeners.clear();
    },
  };
};
