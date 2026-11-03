/**
 * iOS Keychain storage (§2.1).
 *
 * `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: readable by background refresh after the first unlock
 * since boot, never synced to iCloud Keychain or restored onto another device. Deliberately
 * not gated behind biometrics — background refresh would fail silently.
 */
import * as SecureStore from 'expo-secure-store';
import { appConfig } from './config';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: `${appConfig.bundleId}.gmail`,
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const secureStorage = {
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key, OPTIONS),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key: string): Promise<void> => SecureStore.deleteItemAsync(key, OPTIONS),
};
