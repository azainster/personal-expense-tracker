/**
 * Browser preview stand-in. There is no Keychain in a browser, and Gmail sign-in is not
 * offered there, so nothing sensitive is ever written. Values live in memory only.
 */
const memory = new Map<string, string>();

export const secureStorage = {
  get: async (key: string): Promise<string | null> => memory.get(key) ?? null,
  set: async (key: string, value: string): Promise<void> => {
    memory.set(key, value);
  },
  remove: async (key: string): Promise<void> => {
    memory.delete(key);
  },
};
