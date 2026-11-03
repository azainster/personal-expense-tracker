import { describe, expect, it } from 'vitest';
import { deriveGoogleRedirect, monthLabel, normalizeApiUrl, relativeTime, shiftMonthKey } from '../configHelpers';

describe('Google iOS OAuth redirect', () => {
  it('reverses the iOS client ID into the custom scheme Google expects', () => {
    expect(deriveGoogleRedirect('1234567890-abc123def.apps.googleusercontent.com')).toEqual({
      scheme: 'com.googleusercontent.apps.1234567890-abc123def',
      redirectUri: 'com.googleusercontent.apps.1234567890-abc123def:/oauth2redirect',
    });
  });

  it('rejects web client IDs, placeholders and blanks instead of building a broken redirect', () => {
    expect(deriveGoogleRedirect('')).toBeNull();
    expect(deriveGoogleRedirect('REPLACE_WITH_IOS_CLIENT_ID.apps.googleusercontent.com')).toBeNull();
    expect(deriveGoogleRedirect('http://localhost:3000/api/auth/google/callback')).toBeNull();
  });

  it('matches the scheme app.config.ts registers', () => {
    const id = '42-xyz.apps.googleusercontent.com';
    expect(deriveGoogleRedirect(id)?.scheme).toBe(id.split('.').reverse().join('.'));
  });
});

describe('API URL', () => {
  it('normalizes and validates', () => {
    expect(normalizeApiUrl(' https://api.example.com/ ')).toBe('https://api.example.com');
    expect(normalizeApiUrl('http://192.168.1.20:4000')).toBe('http://192.168.1.20:4000');
    expect(normalizeApiUrl('')).toBeNull();
    expect(normalizeApiUrl('api.example.com')).toBeNull();
  });
});

describe('dates', () => {
  it('shifts months across year boundaries', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2025-12', 1)).toBe('2026-01');
  });

  it('labels months, adding the year only when it differs', () => {
    expect(monthLabel('2026-09', '2026-09')).toBe('September');
    expect(monthLabel('2025-12', '2026-01')).toBe('December 2025');
  });

  it('formats relative times, including SQLite datetime strings', () => {
    const now = Date.parse('2026-09-14T12:00:00Z');
    expect(relativeTime('2026-09-14T11:58:00Z', now)).toBe('2 min ago');
    expect(relativeTime('2026-09-14 09:00:00', now)).toBe('3 hr ago');
    expect(relativeTime(null, now)).toBe('never');
  });
});
