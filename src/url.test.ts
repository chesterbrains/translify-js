import { describe, expect, it } from 'vitest';

import { STORAGE_PREFIX, entryRef } from './url.js';

const o = { baseUrl: 'https://h.example/api', project: 'acme-ecom', environment: 'production', key: 'pk_abcd1234' };

describe('entryRef', () => {
  it('builds the whole-locale url with the key last', () => {
    expect(entryRef(o, 'it-IT', undefined).url).toBe('https://h.example/api/delivery/acme-ecom/production/it-IT?key=pk_abcd1234');
  });

  it('builds the namespace url', () => {
    expect(entryRef(o, 'it-IT', 'cart').url).toBe(
      'https://h.example/api/delivery/acme-ecom/production/it-IT?namespace=cart&key=pk_abcd1234',
    );
  });

  it('encodes an odd locale in the path', () => {
    expect(entryRef(o, 'x y', undefined).url).toContain('/x%20y?');
  });

  it('carries locale and namespace', () => {
    expect(entryRef(o, 'it-IT', 'cart')).toMatchObject({ locale: 'it-IT', namespace: 'cart' });
  });

  it('storage key has host, path, namespace and the last four of the key, never the whole key', () => {
    const ref = entryRef(o, 'it-IT', 'cart');
    expect(ref.storageKey).toBe(`${STORAGE_PREFIX}h.example/acme-ecom/production/it-IT?namespace=cart#1234`);
    expect(STORAGE_PREFIX).toBe('translify:v1:');
    expect(ref.storageKey).not.toContain('pk_abcd1234');
    expect(entryRef(o, 'it-IT', undefined).storageKey).toBe(`${STORAGE_PREFIX}h.example/acme-ecom/production/it-IT#1234`);
  });

  it('two keys, two hosts or two environments never share a storage key', () => {
    const ref = entryRef(o, 'it-IT', 'cart');
    expect(entryRef({ ...o, key: 'pk_zzzz9999' }, 'it-IT', 'cart').storageKey).not.toBe(ref.storageKey);
    expect(entryRef({ ...o, baseUrl: 'https://other/api' }, 'it-IT', 'cart').storageKey).not.toBe(ref.storageKey);
    expect(entryRef({ ...o, environment: 'staging' }, 'it-IT', 'cart').storageKey).not.toBe(ref.storageKey);
  });
});
