/**
 * Token vault. The iOS design puts the refresh token in the Keychain with
 * `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`; the server equivalent is
 * AES-256-GCM under a key that lives in the environment, never in the database.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, config.tokenEncryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(payload: string): string | null {
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts as [string, string, string];
    const decipher = createDecipheriv(ALGORITHM, config.tokenEncryptionKey, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key (e.g. TOKEN_ENCRYPTION_KEY rotated or the ephemeral key was regenerated).
    return null;
  }
}
