import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { TranslifyError } from './errors.js';
import { asTranslifyError, fetchEntry } from './fetcher.js';

const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/delivery-headers.json', import.meta.url), 'utf8')) as {
  identity: Record<string, string>;
  gzip: Record<string, string>;
};

const url = 'https://h/api/delivery/p/e/it-IT?key=pk_secret1234';
const bundle = { 'cart.title': 'Carrello', 'cart.empty': 'Vuoto' };
const res = (status: number, body?: string, headers?: Record<string, string>): Response =>
  new Response(body, { status, headers });
const fetchOf = (response: Response | Error): typeof fetch =>
  vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))) as unknown as typeof fetch;
const signal = new AbortController().signal;

const failure = async (response: Response | Error, etag?: string): Promise<TranslifyError> => {
  try {
    await fetchEntry(fetchOf(response), url, etag, signal);
  } catch (error) {
    if (error instanceof TranslifyError) return error;
    throw new Error(`not a TranslifyError: ${String(error)}`, { cause: error });
  }
  throw new Error('did not reject');
};

describe('fetchEntry', () => {
  it('200 → fresh entry with the fixture etag, parsed body and fetchedAt from now', async () => {
    const outcome = await fetchEntry(fetchOf(res(200, JSON.stringify(bundle), fixture.identity)), url, undefined, signal, () => 42);
    expect(outcome).toEqual({ kind: 'fresh', entry: { etag: fixture.identity.etag, bundle, fetchedAt: 42 } });
  });

  it('keeps the -gz etag verbatim', async () => {
    const outcome = await fetchEntry(fetchOf(res(200, '{}', fixture.gzip)), url, undefined, signal);
    expect(outcome.kind === 'fresh' && outcome.entry.etag).toBe(fixture.gzip.etag);
    expect(fixture.gzip.etag?.endsWith('-gz"')).toBe(true);
  });

  it('sends If-None-Match exactly when an etag is held, and no other header', async () => {
    const fetchFn = fetchOf(res(304));
    await fetchEntry(fetchFn, url, '"a"', signal);
    expect(fetchFn).toHaveBeenCalledWith(url, { signal, headers: { 'If-None-Match': '"a"' } });

    const plain = fetchOf(res(200, '{}', fixture.identity));
    await fetchEntry(plain, url, undefined, signal);
    expect(plain).toHaveBeenCalledWith(url, { signal, headers: undefined });
  });

  it('304 with a held etag → notModified', async () => {
    expect(await fetchEntry(fetchOf(res(304)), url, '"a"', signal, () => 42)).toEqual({ kind: 'notModified', fetchedAt: 42 });
  });

  it('304 without a held etag → SERVER', async () => {
    const error = await failure(res(304));
    expect(error.code).toBe('SERVER');
    expect(error.status).toBe(304);
  });

  it.each([
    [401, 'UNAUTHORIZED', 'delivery key refused: missing, revoked or not a publishable key'],
    [404, 'NOT_FOUND', 'project, environment or locale not found, or nothing published'],
    [400, 'BAD_REQUEST', 'malformed project, environment, locale or namespace'],
    [429, 'RATE_LIMITED', 'delivery rate limit reached'],
    [502, 'SERVER', 'delivery answered 502'],
  ] as const)('%i → %s with status and message', async (status, code, message) => {
    const error = await failure(res(status, '{"message":"x"}'));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message).toBe(message);
  });

  it('200 with an array body → SERVER', async () => {
    const error = await failure(res(200, '["a"]', fixture.identity));
    expect(error.code).toBe('SERVER');
    expect(error.message).toBe('unexpected delivery body');
  });

  it('200 with non-string values → SERVER', async () => {
    expect((await failure(res(200, '{"a":1}', fixture.identity))).code).toBe('SERVER');
  });

  it('200 with a body that is not JSON → SERVER', async () => {
    expect((await failure(res(200, '<html>', fixture.identity))).code).toBe('SERVER');
  });

  it('a 200 missing the etag header still yields an entry with etag undefined', async () => {
    const outcome = await fetchEntry(fetchOf(res(200, '{}')), url, undefined, signal);
    expect(outcome).toMatchObject({ kind: 'fresh', entry: { etag: undefined, bundle: {} } });
  });

  it('fetch rejecting → NETWORK carrying the cause message', async () => {
    const error = await failure(new TypeError('Failed to fetch'));
    expect(error.code).toBe('NETWORK');
    expect(error.status).toBeUndefined();
    expect(error.message).toBe('network error: Failed to fetch');
  });

  it('an AbortError → NETWORK "request aborted"', async () => {
    const error = await failure(new DOMException('The user aborted a request.', 'AbortError'));
    expect(error.code).toBe('NETWORK');
    expect(error.message).toBe('request aborted');
  });

  it('any error named AbortError → NETWORK "request aborted", not only a DOMException', async () => {
    const cause = new Error('aborted by a fetch polyfill');
    cause.name = 'AbortError';
    const error = await failure(cause);
    expect(error.code).toBe('NETWORK');
    expect(error.message).toBe('request aborted');
  });

  it('never includes the url, and so the key, in an error message', async () => {
    for (const response of [res(401), res(404), res(500), res(200, '[]'), new TypeError(`fetch failed for ${url}`)]) {
      const error = await failure(response);
      expect(error.message).not.toContain('pk_');
    }
  });
});

describe('asTranslifyError', () => {
  it('passes a TranslifyError through unchanged', () => {
    const error = new TranslifyError('NOT_FOUND', 'gone', 404);
    expect(asTranslifyError(error)).toBe(error);
  });

  it('wraps anything else as NETWORK with the key redacted', () => {
    const error = asTranslifyError(new Error(`listener failed for ${url}`));
    expect(error.code).toBe('NETWORK');
    expect(error.message).toBe('network error: listener failed for https://h/api/delivery/p/e/it-IT?key=[key]');
    expect(asTranslifyError('plain pk_abc').message).toBe('network error: plain [key]');
  });
});
