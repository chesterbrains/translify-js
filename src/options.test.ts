import { describe, expect, it } from 'vitest';

import { TranslifyError } from './errors.js';
import { resolveOptions } from './options.js';

const base = { baseUrl: 'https://h/api', project: 'p', environment: 'e', key: 'pk_x' };

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return error instanceof TranslifyError ? error.code : `not a TranslifyError: ${String(error)}`;
  }

  return undefined;
};

describe('resolveOptions', () => {
  it('strips one or more trailing slashes from baseUrl', () => {
    expect(resolveOptions({ ...base, baseUrl: 'https://h/api//' }).baseUrl).toBe('https://h/api');
  });

  it('trims the strings', () => {
    const resolved = resolveOptions({ ...base, project: ' p ', environment: ' e ', key: ' pk_x ' });
    expect(resolved).toMatchObject({ project: 'p', environment: 'e', key: 'pk_x' });
  });

  it.each(['', 'ftp://h', 'h/api', 'https://h/api?x=1', 'https://h/api#f', 'not a url'])('refuses baseUrl %j', (baseUrl) => {
    expect(codeOf(() => resolveOptions({ ...base, baseUrl }))).toBe('INVALID_OPTIONS');
  });

  it('accepts http for local development', () => {
    expect(resolveOptions({ ...base, baseUrl: 'http://localhost:3000/api' }).baseUrl).toBe('http://localhost:3000/api');
  });

  it.each(['project', 'environment', 'key'] as const)('refuses an empty %s', (field) => {
    expect(codeOf(() => resolveOptions({ ...base, [field]: ' ' }))).toBe('INVALID_OPTIONS');
  });

  it('refuses a secret key, names the fix and never echoes the key', () => {
    let error: unknown;
    try {
      resolveOptions({ ...base, key: 'sk_abc' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TranslifyError);
    expect((error as TranslifyError).code).toBe('INVALID_OPTIONS');
    expect((error as Error).message).toMatch(/publishable/);
    expect((error as Error).message).not.toContain('sk_abc');
  });

  it.each(['Cart', 'cart_x', '', 'a.b', 'a b'])('refuses namespace %j', (namespace) => {
    expect(codeOf(() => resolveOptions({ ...base, namespaces: [namespace] }))).toBe('INVALID_OPTIONS');
  });

  it('refuses an empty namespaces array', () => {
    expect(codeOf(() => resolveOptions({ ...base, namespaces: [] }))).toBe('INVALID_OPTIONS');
  });

  it('keeps valid namespaces in order and leaves them undefined when omitted', () => {
    expect(resolveOptions({ ...base, namespaces: ['checkout', 'cart-2'] }).namespaces).toEqual(['checkout', 'cart-2']);
    expect(resolveOptions(base).namespaces).toBeUndefined();
  });

  it('defaults storage, fetch and onError', () => {
    const resolved = resolveOptions(base);
    expect(typeof resolved.fetch).toBe('function');
    expect(typeof resolved.storage.get).toBe('function');
    expect(() => resolved.onError(new TranslifyError('NETWORK', 'x'))).not.toThrow();
  });

  it('keeps a supplied fetch, storage and onError', () => {
    const fetchFn = (() => Promise.reject(new Error('nope'))) as unknown as typeof fetch;
    const storage = { get: () => undefined, set: () => undefined, delete: () => undefined };
    const onError = (): void => undefined;
    const resolved = resolveOptions({ ...base, fetch: fetchFn, storage, onError });
    expect(resolved.fetch).toBe(fetchFn);
    expect(resolved.storage).toBe(storage);
    expect(resolved.onError).toBe(onError);
  });
});
