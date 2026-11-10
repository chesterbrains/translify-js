import { describe, expect, it, vi } from 'vitest';

import type { TranslifyClient } from './client.js';
import type { BundleStorage } from './storage.js';

import { createTranslify } from './client.js';
import { TranslifyError } from './errors.js';
import { memoryStorage } from './storage.js';
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
