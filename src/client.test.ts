import { describe, expect, it, vi } from 'vitest';

import type { TranslifyClient } from './client.js';
import type { BundleStorage } from './storage.js';

import { createTranslify } from './client.js';
import { TranslifyError } from './errors.js';
import { memoryStorage, writeEntry } from './storage.js';
import { entryRef } from './url.js';

const base = { baseUrl: 'https://h/api', project: 'acme-ecom', environment: 'production', key: 'pk_abcd1234' };

const okResponse = (bundle: Record<string, string>, etag: string): Response =>
  new Response(JSON.stringify(bundle), { status: 200, headers: { etag } });
const res = (status: number): Response => new Response(null, { status });

interface Harness {
  client: TranslifyClient;
  fetchFn: ReturnType<typeof vi.fn>;
  storage: BundleStorage;
  onError: ReturnType<typeof vi.fn>;
}

const harness = (extra: Partial<Parameters<typeof createTranslify>[0]> = {}): Harness => {
  const fetchFn = vi.fn();
  const storage = extra.storage ?? memoryStorage();
  const onError = vi.fn();
  const client = createTranslify({ ...base, fetch: fetchFn as unknown as typeof fetch, storage, onError, ...extra });

  return { client, fetchFn, storage, onError };
};

describe('createTranslify', () => {
  it('throws INVALID_OPTIONS synchronously', () => {
    expect(() => createTranslify({ ...base, key: 'sk_x' })).toThrow(TranslifyError);
  });
});

describe('load (nothing cached)', () => {
  it('fetches once, resolves the bundle, and get/bundle read it synchronously', async () => {
    const { client, fetchFn } = harness();
    fetchFn.mockResolvedValueOnce(okResponse({ 'cart.title': 'Carrello' }, '"e1"'));

    const bundle = await client.load('it-IT');

    expect(bundle).toEqual({ 'cart.title': 'Carrello' });
    expect(client.get('it-IT', 'cart.title')).toBe('Carrello');
    expect(client.bundle('it-IT')).toBe(bundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://h/api/delivery/acme-ecom/production/it-IT?key=pk_abcd1234');
  });

  it('get and bundle return undefined before load and for an unknown key', async () => {
    const { client, fetchFn } = harness();
    expect(client.bundle('it-IT')).toBeUndefined();
    expect(client.get('it-IT', 'cart.title')).toBeUndefined();
    fetchFn.mockResolvedValueOnce(okResponse({ 'cart.title': 'Carrello' }, '"e1"'));
    await client.load('it-IT');
    expect(client.get('it-IT', 'cart.nope')).toBeUndefined();
  });

  it('writes the entry to storage under the entry key', async () => {
    const { client, fetchFn, storage } = harness();
    fetchFn.mockResolvedValueOnce(okResponse({ 'cart.title': 'Carrello' }, '"e1"'));
    await client.load('it-IT');

    const stored = await storage.get(entryRef(base, 'it-IT', undefined).storageKey);
    expect(JSON.parse(stored as string)).toMatchObject({ v: 1, etag: '"e1"', bundle: { 'cart.title': 'Carrello' } });
  });

  it('rejects with the TranslifyError on 404 and leaves bundle undefined', async () => {
    const { client, fetchFn, onError } = harness();
    fetchFn.mockResolvedValueOnce(res(404));

    await expect(client.load('it-IT')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(client.bundle('it-IT')).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it('two concurrent loads of one locale share one request', async () => {
    const { client, fetchFn } = harness();
    fetchFn.mockResolvedValueOnce(okResponse({ a: 'b' }, '"e1"'));

    const [first, second] = await Promise.all([client.load('it-IT'), client.load('it-IT')]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('different locales are separate requests and bundles', async () => {
    const { client, fetchFn } = harness();
    fetchFn.mockResolvedValueOnce(okResponse({ a: 'it' }, '"e1"')).mockResolvedValueOnce(okResponse({ a: 'fr' }, '"e2"'));
    await client.load('it-IT');
    await client.load('fr-FR');
    expect(client.get('it-IT', 'a')).toBe('it');
    expect(client.get('fr-FR', 'a')).toBe('fr');
  });
});

describe('subscribe', () => {
  it('fires once per bundle change and unsubscribe stops it', async () => {
    const { client, fetchFn } = harness();
    fetchFn.mockImplementation(() => Promise.resolve(okResponse({ a: 'b' }, '"e1"')));
    const listener = vi.fn();
    const unsubscribe = client.subscribe(listener);

    await client.load('it-IT');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith();

    unsubscribe();
    await client.load('fr-FR');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a throwing listener does not break the others', async () => {
    const { client, fetchFn } = harness();
    fetchFn.mockResolvedValueOnce(okResponse({ a: 'b' }, '"e1"'));
    const second = vi.fn();
    client.subscribe(() => {
      throw new Error('boom');
    });
    client.subscribe(second);

    await expect(client.load('it-IT')).resolves.toBeDefined();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('load (stored entry)', () => {
  const ref = entryRef(base, 'it-IT', undefined);
  const stored = async (storage: BundleStorage): Promise<void> => {
    await writeEntry(storage, ref.storageKey, { etag: '"e1"', bundle: { 'cart.title': 'Old' }, fetchedAt: 1 });
  };

  it('resolves without waiting for the network, then revalidates with If-None-Match', async () => {
    const { client, fetchFn, storage } = harness();
    await stored(storage);
    let release!: () => void;
    fetchFn.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(res(304));
      }),
    );

    const bundle = await client.load('it-IT');

    expect(bundle).toEqual({ 'cart.title': 'Old' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ headers: { 'If-None-Match': '"e1"' } });

    release();
    await flush();
    expect(client.bundle('it-IT')).toBe(bundle);
  });

  it('a 304 refreshes fetchedAt in storage', async () => {
    const { client, fetchFn, storage } = harness();
    await stored(storage);
    fetchFn.mockResolvedValueOnce(res(304));
    await client.load('it-IT');
    await flush();
    const after = JSON.parse((await storage.get(ref.storageKey)) as string) as { fetchedAt: number };
    expect(after.fetchedAt).toBeGreaterThan(1);
  });

  it('a 200 on revalidation replaces the bundle, stores it and notifies', async () => {
    const { client, fetchFn, storage } = harness();
    await stored(storage);
    fetchFn.mockResolvedValueOnce(okResponse({ 'cart.title': 'New' }, '"e2"'));
    const listener = vi.fn();
    client.subscribe(listener);

    const first = await client.load('it-IT');
    await flush();

    expect(first).toEqual({ 'cart.title': 'Old' });
    expect(client.bundle('it-IT')).toEqual({ 'cart.title': 'New' });
    expect(client.bundle('it-IT')).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(JSON.parse((await storage.get(ref.storageKey)) as string)).toMatchObject({ etag: '"e2"' });
  });

  it.each([503, 429])('a %i on revalidation keeps the entry in memory and storage and calls onError', async (status) => {
    const { client, fetchFn, storage, onError } = harness();
    await stored(storage);
    fetchFn.mockResolvedValueOnce(res(status));

    const bundle = await client.load('it-IT');
    await flush();

    expect(client.bundle('it-IT')).toBe(bundle);
    expect(await storage.get(ref.storageKey)).toBeDefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ status });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a network failure on revalidation is reported and load still resolves', async () => {
    const { client, fetchFn, storage, onError } = harness();
    await stored(storage);
    fetchFn.mockRejectedValueOnce(new TypeError('offline'));

    await expect(client.load('it-IT')).resolves.toEqual({ 'cart.title': 'Old' });
    await flush();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: 'NETWORK' });
  });

  it.each([401, 404, 400])(
    'a %i on revalidation deletes the stored entry, keeps the in-memory bundle and calls onError',
    async (status) => {
      const { client, fetchFn, storage, onError } = harness();
      await stored(storage);
      fetchFn.mockResolvedValueOnce(res(status));

      const bundle = await client.load('it-IT');
      await flush();

      expect(client.bundle('it-IT')).toBe(bundle);
      expect(client.get('it-IT', 'cart.title')).toBe('Old');
      expect(await storage.get(ref.storageKey)).toBeUndefined();
      expect(onError.mock.calls[0]?.[0]).toMatchObject({ status });
    },
  );

  it('after a definitive failure a fresh client on the same storage fails loudly', async () => {
    const storage = memoryStorage();
    await stored(storage);
    const first = harness({ storage });
    first.fetchFn.mockResolvedValueOnce(res(404));
    await first.client.load('it-IT');
    await flush();

    const second = harness({ storage });
    second.fetchFn.mockResolvedValueOnce(res(404));
    await expect(second.client.load('it-IT')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('refresh', () => {
  const ref = entryRef(base, 'it-IT', undefined);

  it('on a held locale awaits the revalidation and returns the new bundle', async () => {
    const { client, fetchFn, storage } = harness();
    await writeEntry(storage, ref.storageKey, { etag: '"e1"', bundle: { a: 'old' }, fetchedAt: 1 });
    fetchFn.mockResolvedValueOnce(res(304)).mockResolvedValueOnce(okResponse({ a: 'new' }, '"e2"'));
    await client.load('it-IT');
    await flush();

    const bundle = await client.refresh('it-IT');

    expect(bundle).toEqual({ a: 'new' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]?.[1]).toMatchObject({ headers: { 'If-None-Match': '"e1"' } });
  });

  it('on a held locale rejects on failure and still applies the failure policy', async () => {
    const { client, fetchFn, storage, onError } = harness();
    await writeEntry(storage, ref.storageKey, { etag: '"e1"', bundle: { a: 'old' }, fetchedAt: 1 });
    fetchFn.mockResolvedValueOnce(res(304)).mockResolvedValueOnce(res(401));
    await client.load('it-IT');
    await flush();

    await expect(client.refresh('it-IT')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await storage.get(ref.storageKey)).toBeUndefined();
    expect(client.get('it-IT', 'a')).toBe('old');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('redacts the key when a failure is not a TranslifyError (an onError that throws)', async () => {
    const onError = vi.fn(() => {
      throw new Error('handler failed for pk_abcd1234');
    });
    const storage = memoryStorage();
    await writeEntry(storage, ref.storageKey, { etag: '"e1"', bundle: { 'cart.title': 'Old' }, fetchedAt: 1 });
    const { client, fetchFn } = harness({ storage, onError });
    fetchFn.mockResolvedValueOnce(res(500));
    const error = (await client.refresh('it-IT').catch((reason: unknown) => reason)) as TranslifyError;
    expect(error).toBeInstanceOf(TranslifyError);
    expect(error.code).toBe('NETWORK');
    expect(error.message).toBe('network error: handler failed for [key]');
  });

  it('on an unknown locale behaves as load', async () => {
    const { client, fetchFn } = harness();
    fetchFn.mockResolvedValueOnce(okResponse({ a: 'b' }, '"e1"'));
    await expect(client.refresh('it-IT')).resolves.toEqual({ a: 'b' });
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ headers: undefined });
  });
});

describe('namespaces', () => {
  const ns = { namespaces: ['cart', 'checkout'] };
  const cartRef = entryRef(base, 'it-IT', 'cart');
  const checkoutRef = entryRef(base, 'it-IT', 'checkout');
  const byUrl = (fetchFn: ReturnType<typeof vi.fn>, answers: Record<string, () => Response | Promise<Response>>): void => {
    fetchFn.mockImplementation((url: string) => {
      const namespace = new URL(url).searchParams.get('namespace') ?? '';
      const answer = answers[namespace];
      if (answer === undefined) throw new Error(`unexpected namespace ${namespace}`);

      return Promise.resolve(answer());
    });
  };

  it('loads one request per namespace and merges them in order', async () => {
    const { client, fetchFn } = harness(ns);
    byUrl(fetchFn, { cart: () => okResponse({ 'cart.title': 'C' }, '"c1"'), checkout: () => okResponse({ 'checkout.pay': 'P' }, '"k1"') });

    const bundle = await client.load('it-IT');

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls.map((call) => new URL(call[0] as string).searchParams.get('namespace'))).toEqual(['cart', 'checkout']);
    expect(bundle).toEqual({ 'cart.title': 'C', 'checkout.pay': 'P' });
  });

  it('resolves immediately only when every namespace is stored', async () => {
    const { client, fetchFn, storage } = harness(ns);
    await writeEntry(storage, cartRef.storageKey, { etag: '"c1"', bundle: { 'cart.title': 'C' }, fetchedAt: 1 });
    byUrl(fetchFn, { cart: () => res(304), checkout: () => okResponse({ 'checkout.pay': 'P' }, '"k1"') });

    const bundle = await client.load('it-IT');

    expect(bundle).toEqual({ 'cart.title': 'C', 'checkout.pay': 'P' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await flush();
    expect(client.bundle('it-IT')).toBe(bundle);
  });

  it('rejects the whole load when one namespace fails and publishes nothing', async () => {
    const { client, fetchFn, storage } = harness(ns);
    byUrl(fetchFn, { cart: () => okResponse({ 'cart.title': 'C' }, '"c1"'), checkout: () => res(404) });
    const listener = vi.fn();
    client.subscribe(listener);

    await expect(client.load('it-IT')).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(client.bundle('it-IT')).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(await storage.get(cartRef.storageKey)).toBeDefined();
    expect(await storage.get(checkoutRef.storageKey)).toBeUndefined();
  });

  it('a background 200 on one namespace republishes the merged bundle', async () => {
    const { client, fetchFn, storage } = harness(ns);
    await writeEntry(storage, cartRef.storageKey, { etag: '"c1"', bundle: { 'cart.title': 'Old' }, fetchedAt: 1 });
    await writeEntry(storage, checkoutRef.storageKey, { etag: '"k1"', bundle: { 'checkout.pay': 'P' }, fetchedAt: 1 });
    byUrl(fetchFn, { cart: () => okResponse({ 'cart.title': 'New' }, '"c2"'), checkout: () => res(304) });

    const first = await client.load('it-IT');
    await flush();

    expect(first).toEqual({ 'cart.title': 'Old', 'checkout.pay': 'P' });
    expect(client.bundle('it-IT')).toEqual({ 'cart.title': 'New', 'checkout.pay': 'P' });
  });
});

describe('dispose', () => {
  it('aborts an in-flight load, which rejects NETWORK "client disposed", and silences listeners', async () => {
    const { client, fetchFn } = harness();
    fetchFn.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const listener = vi.fn();
    client.subscribe(listener);

    const pending = client.load('it-IT');
    client.dispose();

    await expect(pending).rejects.toMatchObject({ code: 'NETWORK', message: 'client disposed' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('load after dispose rejects INVALID_OPTIONS and bundle still reads memory', async () => {
    const { client, fetchFn } = harness();
    fetchFn.mockResolvedValueOnce(okResponse({ a: 'b' }, '"e1"'));
    await client.load('it-IT');

    client.dispose();

    await expect(client.load('it-IT')).rejects.toMatchObject({ code: 'INVALID_OPTIONS', message: 'client disposed' });
    await expect(client.refresh('it-IT')).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    expect(client.get('it-IT', 'a')).toBe('b');
  });
});

describe('review fixes', () => {
  it('never publishes a partial bundle while a namespace is still loading', async () => {
    const { client, fetchFn, storage } = harness({ namespaces: ['cart', 'checkout'] });
    await writeEntry(storage, entryRef(base, 'it-IT', 'cart').storageKey, { etag: '"c1"', bundle: { 'cart.title': 'C' }, fetchedAt: 1 });
    let releaseCheckout!: () => void;
    fetchFn.mockImplementation((url: string) => {
      if (url.includes('namespace=cart')) return Promise.resolve(okResponse({ 'cart.title': 'C2' }, '"c2"'));

      return new Promise((resolve) => {
        releaseCheckout = () => resolve(okResponse({ 'checkout.pay': 'P' }, '"k1"'));
      });
    });
    const listener = vi.fn();
    client.subscribe(listener);

    const pending = client.load('it-IT');
    await flush();
    expect(client.bundle('it-IT')).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();

    releaseCheckout();
    const bundle = await pending;
    expect(bundle).toEqual({ 'cart.title': 'C2', 'checkout.pay': 'P' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('leaves bundle undefined after a namespace fails even when another was held', async () => {
    const { client, fetchFn, storage } = harness({ namespaces: ['cart', 'checkout'] });
    await writeEntry(storage, entryRef(base, 'it-IT', 'cart').storageKey, { etag: '"c1"', bundle: { 'cart.title': 'C' }, fetchedAt: 1 });
    fetchFn.mockImplementation((url: string) => Promise.resolve(url.includes('namespace=cart') ? res(304) : res(404)));

    await expect(client.load('it-IT')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await flush();
    expect(client.bundle('it-IT')).toBeUndefined();
  });

  it('reports one failed response once even when a refresh shares the request', async () => {
    const { client, fetchFn, storage, onError } = harness();
    const ref = entryRef(base, 'it-IT', undefined);
    await writeEntry(storage, ref.storageKey, { etag: '"e1"', bundle: { a: 'old' }, fetchedAt: 1 });
    let release!: () => void;
    fetchFn.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(res(503));
      }),
    );

    await client.load('it-IT'); // background revalidation in flight
    const refreshing = client.refresh('it-IT'); // shares it
    release();
    await expect(refreshing).rejects.toMatchObject({ status: 503 });
    await flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
