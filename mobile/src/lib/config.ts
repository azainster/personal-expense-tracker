/**
 * Build-time configuration. EXPO_PUBLIC_* variables are inlined into the bundle by Expo;
 * they are public by design (see mobile/.env.example). No secret ever belongs here.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { deriveGoogleRedirect, normalizeApiUrl } from './configHelpers';

const googleIosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '').trim();
const apiUrl = normalizeApiUrl(process.env.EXPO_PUBLIC_API_URL ?? '');
const appToken = (process.env.EXPO_PUBLIC_API_APP_TOKEN ?? '').trim();
const appEnv = (process.env.EXPO_PUBLIC_APP_ENV ?? (__DEV__ ? 'development' : 'production')).trim();

const redirect = deriveGoogleRedirect(googleIosClientId);

export const appConfig = {
  appEnv,
  bundleId: Constants.expoConfig?.ios?.bundleIdentifier ?? 'com.azainster.expensetracker',
  appName: Constants.expoConfig?.name ?? 'Expense Tracker',
  google: {
    iosClientId: googleIosClientId,
    redirectUri: redirect?.redirectUri ?? null,
    /** Gmail sign-in needs the native iOS app and a configured client ID. */
    configured: redirect !== null && Platform.OS === 'ios',
    problem:
      Platform.OS !== 'ios'
        ? 'Gmail sign-in runs in the iPhone app. This preview can only show demo data.'
        : redirect === null
          ? googleIosClientId === ''
            ? 'This build has no Google iOS client ID. Set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID and rebuild (see SETUP.md).'
            : 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID does not look like an iOS OAuth client ID (…apps.googleusercontent.com).'
          : null,
  },
  api: {
    url: apiUrl,
    appToken,
    configured: apiUrl !== null,
  },
  sync: {
    windowDays: 35,
    maxMessagesPerRun: 400,
    discoverySweepHours: 168,
    /** Foreground auto-sync when the app becomes active and the last sync is older than this. */
    autoSyncAfterMinutes: 15,
    /** iOS gives background refresh ~30 seconds; stop cleanly before that. */
    backgroundBudgetMs: 22_000,
    backgroundIntervalMinutes: 60,
  },
  llm: {
    maxCallsPerSync: 25,
    timeoutMs: 20_000,
  },
  defaultCurrency: 'INR',
  localeHint: 'en-IN',
} as const;
