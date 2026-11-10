/** Every error the package surfaces carries one of these. Closed union: the README lists each. */
export type TranslifyErrorCode =
  | 'INVALID_OPTIONS'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'SERVER'
  | 'NETWORK';

export const ERROR_CODES: readonly TranslifyErrorCode[] = [
  'INVALID_OPTIONS',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'BAD_REQUEST',
  'SERVER',
  'NETWORK',
];

export class TranslifyError extends Error {
  readonly code: TranslifyErrorCode;
  readonly status: number | undefined;

  constructor(code: TranslifyErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'TranslifyError';
    this.code = code;
    this.status = status;
  }
}

/** HTTP status → code. Anything the delivery contract does not name is a server-side surprise. */
export const codeForStatus = (status: number): Exclude<TranslifyErrorCode, 'INVALID_OPTIONS' | 'NETWORK'> => {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';

  return 'SERVER';
};

/**
 * A definitive failure means the server said this URL and key no longer serve a bundle
 * (key revoked, environment archived, locale disabled). A stored entry must not outlive it.
 */
export const isDefinitive = (code: TranslifyErrorCode): boolean =>
  code === 'UNAUTHORIZED' || code === 'NOT_FOUND' || code === 'BAD_REQUEST';
