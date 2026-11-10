import type { ResolvedOptions } from './options.js';

/** One delivery request's identity: a (locale, namespace) pair under one client. */
export interface EntryRef {
  locale: string;
  namespace: string | undefined;
  /** Full request URL, key included (`?key=` is the delivery contract; it is never a header). */
  url: string;
  /** Storage key: host + path + namespace + the key's last four characters. Never the whole key. */
  storageKey: string;
}

/** Bumps when the stored entry shape changes, so older entries read as misses. */
export const STORAGE_PREFIX = 'translify:v1:';

type UrlOptions = Pick<ResolvedOptions, 'baseUrl' | 'project' | 'environment' | 'key'>;

export const entryRef = (options: UrlOptions, locale: string, namespace: string | undefined): EntryRef => {
  const path = `${options.baseUrl}/delivery/${encodeURIComponent(options.project)}/${encodeURIComponent(options.environment)}/${encodeURIComponent(locale)}`;
  const query = new URLSearchParams();
  if (namespace !== undefined) query.set('namespace', namespace);
  query.set('key', options.key);

  const host = new URL(options.baseUrl).host;
  const suffix = namespace === undefined ? '' : `?namespace=${namespace}`;

  return {
    locale,
    namespace,
    url: `${path}?${query.toString()}`,
    storageKey: `${STORAGE_PREFIX}${host}/${options.project}/${options.environment}/${locale}${suffix}#${options.key.slice(-4)}`,
  };
};
