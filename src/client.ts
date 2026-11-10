import type { TranslifyBundle, TranslifyKey } from './keys.js';
import type { ResolvedOptions, TranslifyOptions } from './options.js';
import type { Entry } from './storage.js';
import type { EntryRef } from './url.js';

import { TranslifyError } from './errors.js';
import { fetchEntry } from './fetcher.js';
import { resolveOptions } from './options.js';
import { writeEntry } from './storage.js';
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

  const fetchFresh = (ref: EntryRef): Promise<Entry> => {
    const pending = inflight.get(ref.storageKey);
    if (pending !== undefined) return pending;

    const request = (async (): Promise<Entry> => {
      const outcome = await fetchEntry(resolved.fetch, ref.url, undefined, controller.signal);
      if (outcome.kind !== 'fresh') throw new TranslifyError('SERVER', '304 without a validator', 304);
      entries.set(ref.storageKey, outcome.entry);
      await writeEntry(resolved.storage, ref.storageKey, outcome.entry);

      return outcome.entry;
    })().finally(() => inflight.delete(ref.storageKey));
    inflight.set(ref.storageKey, request);

    return request;
  };

  const load = async (locale: string): Promise<TranslifyBundle> => {
    if (disposed) throw new TranslifyError('INVALID_OPTIONS', 'client disposed');
    const results = await Promise.allSettled(refs(locale).map(fetchFresh));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed !== undefined) throw failed.reason;

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
    refresh: load,
    dispose: () => {
      disposed = true;
      controller.abort();
      listeners.clear();
    },
  };
};
