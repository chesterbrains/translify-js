import { describe, expect, it } from 'vitest';

import { ERROR_CODES, TranslifyError, codeForStatus, isDefinitive } from './errors.js';

describe('codeForStatus', () => {
  it.each([
    [400, 'BAD_REQUEST'],
    [401, 'UNAUTHORIZED'],
    [403, 'UNAUTHORIZED'],
    [404, 'NOT_FOUND'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER'],
    [503, 'SERVER'],
    [418, 'SERVER'],
  ] as const)('status %i → %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});

describe('isDefinitive', () => {
  it('is true for UNAUTHORIZED, NOT_FOUND and BAD_REQUEST only', () => {
    const definitive = ERROR_CODES.filter(isDefinitive);
    expect(definitive.toSorted()).toEqual(['BAD_REQUEST', 'NOT_FOUND', 'UNAUTHORIZED']);
  });

  it('ERROR_CODES lists the seven codes', () => {
    expect([...ERROR_CODES].toSorted()).toEqual(
      ['BAD_REQUEST', 'INVALID_OPTIONS', 'NETWORK', 'NOT_FOUND', 'RATE_LIMITED', 'SERVER', 'UNAUTHORIZED'],
    );
  });
});

describe('TranslifyError', () => {
  it('carries code, status, name and message', () => {
    const error = new TranslifyError('NOT_FOUND', 'nothing there', 404);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TranslifyError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe('nothing there');
  });

  it('status is undefined when there was no response', () => {
    expect(new TranslifyError('NETWORK', 'offline').status).toBeUndefined();
  });
});
