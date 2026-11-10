import type { Bundle, Entry } from './storage.js';

import { TranslifyError, codeForStatus } from './errors.js';

export type FetchOutcome = { kind: 'fresh'; entry: Entry } | { kind: 'notModified' };

const MESSAGES: Record<ReturnType<typeof codeForStatus>, string> = {
  UNAUTHORIZED: 'delivery key refused: missing, revoked or not a publishable key',
  NOT_FOUND: 'project, environment or locale not found, or nothing published',
  BAD_REQUEST: 'malformed project, environment, locale or namespace',
  RATE_LIMITED: 'delivery rate limit reached',
  SERVER: 'delivery answered',
};

const isBundle = (value: unknown): value is Bundle =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string');

/** A fetch failure message may quote the URL, and the URL carries the key. */
const redact = (text: string): string => text.replace(/pk_[A-Za-z0-9_-]+/g, '[key]');

const networkError = (cause: unknown): TranslifyError => {
  if (cause instanceof DOMException && cause.name === 'AbortError') return new TranslifyError('NETWORK', 'request aborted');
  const detail = cause instanceof Error ? cause.message : String(cause);

  return new TranslifyError('NETWORK', `network error: ${redact(detail)}`);
};

/**
 * One delivery request. The only header ever sent is `If-None-Match`, and only when a
 * validator is held, so a plain load stays a CORS simple request (no preflight).
 */
export const fetchEntry = async (
  fetchFn: typeof fetch,
  url: string,
  etag: string | undefined,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<FetchOutcome> => {
  let response: Response;
  try {
    response = await fetchFn(url, { signal, headers: etag === undefined ? undefined : { 'If-None-Match': etag } });
  } catch (cause) {
    throw networkError(cause);
  }

  if (response.status === 304) {
    if (etag === undefined) throw new TranslifyError('SERVER', '304 without a validator', 304);

    return { kind: 'notModified' };
  }

  if (response.status !== 200) {
    const code = codeForStatus(response.status);
    const message = code === 'SERVER' ? `${MESSAGES.SERVER} ${response.status}` : MESSAGES[code];
    throw new TranslifyError(code, message, response.status);
  }

  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    throw new TranslifyError('SERVER', 'unexpected delivery body', 200);
  }
  if (!isBundle(body)) throw new TranslifyError('SERVER', 'unexpected delivery body', 200);

  return { kind: 'fresh', entry: { etag: response.headers.get('etag') ?? undefined, bundle: body, fetchedAt: now() } };
};
