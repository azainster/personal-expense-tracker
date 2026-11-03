import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * ─── Identity: the values you change before your first TestFlight build ───────────────────
 *
 * APP_BUNDLE_ID must match the App ID you register at developer.apple.com and the iOS OAuth
 * client you create in Google Cloud. It can also be supplied as an environment variable.
 */
const APP_BUNDLE_ID = process.env.APP_BUNDLE_ID || 'com.azainster.expensetracker';
const APP_DISPLAY_NAME = process.env.APP_DISPLAY_NAME || 'Expense Tracker';
/**
 * The EAS project this app is linked to (created by `eas init`). Not a secret — it's a public
 * identifier EAS uses to find the project. `eas init` can't write into a dynamic config, so it
 * lives here. EAS_PROJECT_ID in the environment still overrides it.
 */
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || '3207d153-b3b4-4cc8-88df-866364667a4c';

/**
 * Local Xcode signing with a free Apple Personal Team (see PERSONAL_IPHONE.md).
 *
 * APPLE_TEAM_ID (optional, not a secret): written into the generated Xcode project so
 * `npm run ios:prebuild` doesn't lose the signing team. Leave unset to pick it in Xcode.
 *
 * IOS_DATA_PROTECTION_ENTITLEMENT (optional): adds the Data Protection entitlement
 * (NSFileProtectionCompleteUnlessOpen). Off by default so a free Personal Team can always sign
 * the app; without it iOS still encrypts the app's files with its default protection class.
 */
const APPLE_TEAM_ID = (process.env.APPLE_TEAM_ID || '').trim();
const IOS_DATA_PROTECTION_ENTITLEMENT = /^(1|true|yes)$/i.test((process.env.IOS_DATA_PROTECTION_ENTITLEMENT || '').trim());

/**
 * The iOS OAuth client ID from Google Cloud, e.g. 1234-abcd.apps.googleusercontent.com.
 * Not a secret: native apps are public OAuth clients (PKCE, no client secret). Its reversed
 * form becomes a URL scheme so Google can redirect back into the app after sign-in.
 */
const GOOGLE_IOS_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '').trim();
// Same rule as src/lib/configHelpers.ts: a placeholder or a web client ID registers nothing.
const GOOGLE_REDIRECT_SCHEME = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(GOOGLE_IOS_CLIENT_ID)
  ? GOOGLE_IOS_CLIENT_ID.split('.').reverse().join('.')
  : null;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_DISPLAY_NAME,
  // Must match the EAS project (@azainster/expense-tracker). Explicit, because this Expo login
  // also belongs to the azainsters-team account.
  owner: 'azainster',
  slug: 'expense-tracker',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  // `expensetracker://` for in-app links; the reversed Google client ID for the OAuth redirect.
  scheme: GOOGLE_REDIRECT_SCHEME ? ['expensetracker', GOOGLE_REDIRECT_SCHEME] : ['expensetracker'],
  ios: {
    bundleIdentifier: APP_BUNDLE_ID,
    ...(APPLE_TEAM_ID ? { appleTeamId: APPLE_TEAM_ID } : {}),
    // With appVersionSource "remote" in eas.json, EAS manages and auto-increments this.
    buildNumber: '1',
    supportsTablet: false,
    deploymentTarget: '18.0',
    config: {
      // Only HTTPS/TLS provided by iOS is used — no custom encryption. Skips the export
      // compliance question on every TestFlight upload.
      usesNonExemptEncryption: false,
    },
    ...(IOS_DATA_PROTECTION_ENTITLEMENT
      ? {
          entitlements: {
            // §5: financial history is encrypted at rest while the phone is locked. CompleteUnlessOpen
            // (not Complete) so a sync already in progress survives the screen locking.
            'com.apple.developer.default-data-protection': 'NSFileProtectionCompleteUnlessOpen',
          },
        }
      : {}),
    infoPlist: {
      // Lets "View in Gmail" prefer the Gmail app when it is installed.
      LSApplicationQueriesSchemes: ['googlegmail'],
    },
  },
  android: {
    package: APP_BUNDLE_ID,
  },
  web: {
    // Browser preview only (demo data, no Gmail). A single-page build: nothing native runs at build time.
    output: 'single',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    // The Keychain item is deliberately not biometric-gated (§2.1), so no Face ID usage string.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-web-browser',
    'expo-background-task',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 140,
        resizeMode: 'contain',
        backgroundColor: '#F4F5F7',
        dark: { image: './assets/splash-icon.png', backgroundColor: '#0E1013' },
      },
    ],
  ],
  extra: {
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
    ...(GOOGLE_REDIRECT_SCHEME ? { googleRedirectScheme: GOOGLE_REDIRECT_SCHEME } : {}),
  },
});
