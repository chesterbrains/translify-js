import type { BundleStorage } from './storage.js';

import { TranslifyError } from './errors.js';
import { memoryStorage } from './storage.js';

export interface TranslifyOptions {
  /** The API origin including the `/api` prefix, e.g. `https://translify.example/api`. Required: there is no default. */
  baseUrl: string;
  /** Project slug. The key is bound to one project; the slug must be that project's. */
  project: string;
  /** Environment slug. */
  environment: string;
  /** A publishable (`pk_`) delivery key. It ships in the browser bundle by design. */
  key: string;
  /** Load these namespaces (one request each) instead of the whole locale. */
  namespaces?: string[];
  /** Where entries persist. Default: memory. */
  storage?: BundleStorage;
  /** Injectable for tests and polyfills. Default: `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Background failures (revalidation) are reported here; `load` never rejects for them. */
  onError?: (error: TranslifyError) => void;
}

export interface ResolvedOptions {
  baseUrl: string;
  project: string;
  environment: string;
  key: string;
  namespaces: string[] | undefined;
  storage: BundleStorage;
  fetch: typeof fetch;
  onError: (error: TranslifyError) => void;
}

export const NAMESPACE_PATTERN = /^[a-z0-9-]+$/;
const SECRET_KEY_PREFIX = 'sk_';

const invalid = (message: string): TranslifyError => new TranslifyError('INVALID_OPTIONS', message);

const required = (value: unknown, name: string): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') throw invalid(`${name} is required`);

  return text;
};

const baseUrlOf = (value: unknown): string => {
  const text = required(value, 'baseUrl');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalid('baseUrl must be an absolute http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('baseUrl must be an absolute http(s) URL');
  if (url.search !== '' || url.hash !== '') throw invalid('baseUrl must not carry a query string or fragment');

  // Rebuild from the parsed parts: a bare `?` or `#`, dot segments and host case are normalised away.
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
};

const namespacesOf = (value: string[] | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  if (value.length === 0) throw invalid('namespaces must name at least one namespace');
  for (const namespace of value) {
    if (!NAMESPACE_PATTERN.test(namespace)) throw invalid(`namespace must be lowercase kebab-case: ${JSON.stringify(namespace)}`);
  }

  return [...value];
};

/** Validates synchronously; throws `TranslifyError` `INVALID_OPTIONS`. Messages never include the key. */
export const resolveOptions = (options: TranslifyOptions): ResolvedOptions => {
  const key = required(options.key, 'key');
  if (key.startsWith(SECRET_KEY_PREFIX)) throw invalid('key must be a publishable (pk_) delivery key, not a secret key');

  return {
    baseUrl: baseUrlOf(options.baseUrl),
    project: required(options.project, 'project'),
    environment: required(options.environment, 'environment'),
    key,
    namespaces: namespacesOf(options.namespaces),
    storage: options.storage ?? memoryStorage(),
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    onError: options.onError ?? (() => undefined),
  };
};
