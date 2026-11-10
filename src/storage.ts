/** Where entries persist between page loads. Values are JSON strings the package serialises itself. */
export interface BundleStorage {
  get(key: string): Promise<string | undefined> | string | undefined;
  set(key: string, value: string): Promise<void> | void;
  delete(key: string): Promise<void> | void;
}

/** The default: lives as long as the client does. */
export const memoryStorage = (): BundleStorage => {
  const map = new Map<string, string>();

  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      map.set(key, value);
    },
    delete: (key) => {
      map.delete(key);
    },
  };
};
