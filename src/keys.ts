/**
 * Augmented by the file `npx @translifyhq/client types` writes:
 *
 *   declare module '@translifyhq/client' { interface TranslifyKeys { 'cart.title': string } }
 *
 * Without the augmentation every key is a `string`; with it, `get` autocompletes and refuses typos.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmentation target
export interface TranslifyKeys {}

export type TranslifyKey = keyof TranslifyKeys extends never ? string : keyof TranslifyKeys & string;

export type TranslifyBundle = Readonly<Record<TranslifyKey, string>>;
