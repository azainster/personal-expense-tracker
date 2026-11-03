# Setup: from this folder to the app on your iPhone (and TestFlight)

Follow the parts in order. Each step says exactly what to type or click. Commands are run in
**Terminal** on your Mac. Where you see `com.yourname.expensetracker`, use your own
bundle identifier (Part 3).

You do **not** need Xcode. iPhone builds are made in the cloud by Expo's EAS Build and
uploaded to TestFlight from there.

> **Only for yourself, without the paid Apple Developer Program?** Do Parts 1–4 here, then follow
> [PERSONAL_IPHONE.md](PERSONAL_IPHONE.md) (local Xcode build with a free Personal Team) instead of
> Parts 5–7 and 9.

---

## Part 0 — What you are setting up

```
iPhone app (mobile/)                                   Your API (server/)  — optional
 ├─ Google sign-in (iOS client, PKCE, no secret)        ├─ GET  /api/v1/rules-pack
 ├─ Gmail API, read-only, called from the phone         └─ POST /api/v1/llm/*  (AI fallback, off by default)
 ├─ Parser, dedupe, categories (packages/core)
 ├─ SQLite database on the phone (encrypted at rest)
 └─ Refresh token in the iOS Keychain
```

- Email is read **on the iPhone**. No server ever receives your mail. This is the design in
  `expense-tracker-architecture.md` §1.
- The API is optional. Without it the app uses the rules bundled into the build, and the
  AI fallback is simply unavailable. Gmail sync, parsing, dashboards and everything else work.
- `web/` is a separate development dashboard for your Mac only.

What you need:

| Thing | Cost | Needed for |
|---|---|---|
| Node.js 22 or newer (`node -v`) | free | everything |
| A Google account | free | Gmail sign-in (Part 4) |
| An Expo account — [expo.dev/signup](https://expo.dev/signup) | free tier is enough | cloud iPhone builds |
| Apple Developer Program — [developer.apple.com/programs](https://developer.apple.com/programs/) | US$99/year | installing on your iPhone and TestFlight |
| An iPhone on iOS 18 or newer | — | running it |

---

## Part 1 — Install and check everything works

```bash
cd ~/Desktop/expense-tracker
npm install            # installs all packages and builds packages/core
npm test               # core (parser, store, sync engine) + server + app unit tests
npm run typecheck      # strict TypeScript: core, server, web dashboard, iPhone app
npm run lint           # iPhone app lint
```

All four should finish without errors.

---

## Part 2 — See the app right now (no accounts needed)

This opens the iPhone app in your browser with demo data. Gmail sign-in and background sync
only exist in the real iPhone build, but every screen is the real one.

```bash
npm run mobile:web
```

Press `w` if a browser doesn't open. Tap **Explore with demo data**. Stop with `Ctrl+C`.

---

## Part 3 — Choose your bundle identifier

The bundle identifier is the app's permanent ID with Apple and Google. It looks like a
reversed domain, for example `com.jsmith.expensetracker`. Choose it once: the Google client
(Part 4) and the App Store Connect app (Part 8) are both tied to it.

1. Open `mobile/app.config.ts`.
2. Change this line near the top:

   ```ts
   const APP_BUNDLE_ID = process.env.APP_BUNDLE_ID || 'com.yourname.expensetracker';
   ```

   to your identifier, e.g. `'com.jsmith.expensetracker'`.
3. Optionally change `APP_DISPLAY_NAME` (the name under the icon).

---

## Part 4 — Google Cloud: allow the app to read Gmail

### 4.1 Create a project and turn on the Gmail API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in.
2. Top bar → project picker → **New project** → name it `Expense Tracker` → **Create**.
   Make sure the new project is selected in the top bar.
3. Left menu → **APIs & Services → Library** → search **Gmail API** → open it → **Enable**.

### 4.2 Consent screen (Google Auth Platform)

1. Left menu → **APIs & Services → OAuth consent screen** (this opens **Google Auth Platform**).
   If asked, click **Get started**.
2. **App information**: App name `Expense Tracker`, support email = your email → **Next**.
3. **Audience**: choose **External** → **Next**.
4. **Contact information**: your email → **Next** → agree → **Create**.
5. Left menu **Audience** → **Test users** → **Add users** → add the Gmail address you will use
   on your iPhone → **Save**. Only listed test users can sign in while the app is in Testing.
6. Left menu **Data Access** → **Add or remove scopes** → filter for `gmail.readonly` → tick
   `https://www.googleapis.com/auth/gmail.readonly` → **Update** → **Save**.

> **Testing mode signs you out every 7 days.** Google expires refresh tokens for apps in
> Testing after 7 days. The app detects this and shows a **Reconnect Gmail** banner; tap it.
> This is Google's behaviour, not a bug. It goes away only after Google verification (Part 11).

### 4.3 Create the iOS OAuth client

1. Left menu → **Clients** → **Create client**.
2. **Application type: iOS**.
3. **Name**: `Expense Tracker iOS`.
4. **Bundle ID**: exactly your identifier from Part 3.
5. App Store ID and Team ID can stay empty for now → **Create**.
6. Copy the **Client ID**. It looks like
   `1234567890-abc123def456.apps.googleusercontent.com`.

There is **no client secret** for an iOS client — that is correct. Native apps are public
OAuth clients and use PKCE instead. Never put a client secret in the app.

**You do not register a redirect URI anywhere.** The app uses Google's iOS redirect,
`com.googleusercontent.apps.1234567890-abc123def456:/oauth2redirect`, which it derives from the
client ID and registers as a URL scheme in the iOS build automatically. (The old
`http://localhost:…/callback` address is only for the Mac dashboard and cannot work on a phone.)

### 4.4 Give the client ID to the app

The client ID is not a secret; it is compiled into the app.

Put it in **both** places:

1. `mobile/eas.json` → replace `REPLACE_WITH_IOS_CLIENT_ID.apps.googleusercontent.com` with your
   client ID. Cloud builds read it here and register the sign-in redirect in the iPhone build.
2. `mobile/.env` → the development server reads it here for the development build (Part 7 option A):

   ```bash
   cd ~/Desktop/expense-tracker/mobile
   open -e .env        # set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your client ID (remove the "# "), then save
   ```

   If `mobile/.env` doesn't exist yet, create it first with `cp .env.example .env`.

If the ID is missing or malformed, the app still runs and the **Connect Gmail** screen shows
"Setup needed" instead of failing.

---

## Part 5 — Expo account and EAS project

```bash
npm install -g eas-cli
eas login                              # your Expo account
cd ~/Desktop/expense-tracker/mobile
eas init                               # creates the project on expo.dev
```

`eas init` prints a project ID (a UUID). Because this app uses `app.config.ts`, paste it into
`mobile/app.config.ts`:

```ts
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID || 'paste-the-uuid-here';
```

EAS Build uploads your project from git, so put the folder under version control once:

```bash
cd ~/Desktop/expense-tracker
git init
git add -A
git commit -m "Expense tracker"
```

`.env` files, `data/`, `node_modules/` and generated `ios/` folders are git-ignored and never
uploaded. Commit again after any configuration change before building.

---

## Part 6 — Apple Developer account

1. Enroll at [developer.apple.com/programs](https://developer.apple.com/programs/enroll/) with your
   Apple ID. Approval can take from minutes to a couple of days.
2. That's all you do by hand. On the first `eas build`, EAS asks you to log in with your Apple ID
   and then creates the App ID (bundle identifier), the signing certificate and the provisioning
   profile for you, including the **Data Protection** capability the app uses. Answer **Yes** to
   "Generate a new Apple Distribution Certificate?" and "Generate a new Provisioning Profile?".

---

## Part 7 — Run it on your iPhone

Pick **A** while developing (fast reloads, real Gmail), or **B** for a standalone install.
TestFlight (Part 9) is the third way.

### Before either option: prepare the iPhone

1. Connect your iPhone to Wi-Fi (for option A: the **same** Wi-Fi as your Mac).
2. Register it with your Apple account so builds can be installed on it:

   ```bash
   cd ~/Desktop/expense-tracker/mobile
   eas device:create
   ```

   Choose **Website**, open the link/QR code **on the iPhone**, and install the profile when
   asked (Settings → General → VPN & Device Management).
3. On the iPhone: **Settings → Privacy & Security → Developer Mode → On**, restart, confirm.
   (Required for development and internal builds; TestFlight installs don't need it.)

### Option A — Development build (recommended while developing)

```bash
cd ~/Desktop/expense-tracker/mobile
npm run build:ios:dev          # cloud build, ~15–25 min the first time
```

When it finishes, open the printed link on the iPhone and tap **Install**. Then on your Mac:

```bash
cd ~/Desktop/expense-tracker
npm run mobile                 # starts the development server; keep it running
```

Open **Expense Tracker** on the iPhone. It finds the development server on your Wi-Fi
(allow "Local Network" access when asked). Code changes reload instantly. Rebuild only when you
add native packages or change `app.config.ts` / `eas.json`.

### Option B — Preview build (standalone, no Mac needed after install)

```bash
cd ~/Desktop/expense-tracker/mobile
npm run build:ios:preview
```

Install from the printed link on the iPhone.

### First run

1. **Connect Gmail** → read the explanation → **Continue to Google**.
2. Choose the test-user account from Part 4.2.
3. Google warns that the app is unverified: tap **Continue**. Keep **View your email messages
   and settings** ticked → **Continue**.
4. You're back in the app; the first sync shows progress and fills the dashboard.

---

## Part 8 — The API (optional: rules updates and AI fallback)

### 8.1 Run it on your Mac (development)

```bash
cd ~/Desktop/expense-tracker
cp .env.example .env           # only if you haven't already
npm run server                 # http://localhost:4000
```

The iPhone can't use `localhost` (that means the phone itself). It uses your Mac's Wi-Fi address:

```bash
ipconfig getifaddr en0         # e.g. 192.168.1.17
```

`mobile/.env` must contain `EXPO_PUBLIC_API_URL=http://<that address>:4000`. After changing it,
stop and restart `npm run mobile` so the value is compiled in again. This URL is only for the
development build talking to your Mac; it never goes into `eas.json`.

- The iPhone must be on the same Wi-Fi as the Mac.
- The first time the phone connects, macOS may ask **"Do you want the application node to accept
  incoming network connections?"** — click **Allow**. If you clicked Deny: System Settings →
  Network → Firewall → Options → set `node` to *Allow incoming connections*.
- Check from the iPhone: open Safari at `http://<that address>:4000/api/v1/health`.
- If the Mac's address changes (new network, router restart), update `mobile/.env` and restart.

Your transaction data routes (`/api/transactions` etc.) refuse requests from other devices; only
`/api/v1` is reachable from the phone.

### 8.2 Deploy it (production, needed for TestFlight)

On [render.com](https://render.com) (free tier works; any Node 22 host is fine):

1. Push this repository to GitHub (private is fine).
2. Render → **New → Blueprint** → select the repository. It reads `render.yaml`.
3. Deploy, then open `https://<your-service>.onrender.com/api/v1/health`. You should see
   `{"status":"ok",…}`.
4. Add the URL to the `env` of the `preview` and `production` profiles in `mobile/eas.json`
   (no trailing slash), commit, and rebuild:

   ```json
   "production": {
     "extends": "base",
     "distribution": "store",
     "autoIncrement": true,
     "env": {
       "EXPO_PUBLIC_APP_ENV": "production",
       "EXPO_PUBLIC_API_URL": "https://<your-service>.onrender.com"
     }
   }
   ```

   Don't add the key until you have the real URL: EAS rejects empty values in `eas.json`, and
   every `eas` command fails until they're removed.

Other hosts: build with
`npm ci --include=dev --workspace @expense/core --workspace server --include-workspace-root && npm run build -w server`,
start with `node server/dist/index.js`, and set `NODE_ENV=production`.

### 8.3 Anthropic API key (only for the AI fallback)

The fallback is off by default and optional. When on, the phone sends a **redacted, shortened**
snippet of an email it couldn't parse to your API, which asks Claude.

1. Create a key at [console.anthropic.com](https://console.anthropic.com) → **API Keys**.
2. On your server (Render → Environment), set:
   - `ANTHROPIC_API_KEY` = your key
   - `LLM_PROXY_ENABLED` = `true`
   - optional `LLM_PROXY_SHARED_TOKEN` = any random string (then also set
     `EXPO_PUBLIC_API_APP_TOKEN` to the same value in `mobile/eas.json` and rebuild)
3. In the app: **Settings → AI fallback → On**.

The key lives only on the server. It is never in the app, `eas.json`, or `mobile/.env`.

---

## Part 9 — TestFlight

### 9.1 Create the app in App Store Connect

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps** → **+** → **New App**.
2. Platforms: **iOS**. Name: `Expense Tracker` (must be unique on the App Store; add a word if taken).
   Primary language: your choice. **Bundle ID**: pick yours (it appears after your first
   `eas build`, or register it at developer.apple.com → Identifiers). SKU: `expense-tracker`.
   User access: Full Access → **Create**.
3. Open the app → **App Information** → copy **Apple ID** (a number like `6739012345`).
4. Add it to `mobile/eas.json` under `submit.production.ios`, as digits in quotes, and commit:

   ```json
   "submit": {
     "production": {
       "ios": { "ascAppId": "6739012345" }
     }
   }
   ```

   Use your own number. Don't put words in this field: EAS only accepts digits.

### 9.2 Archive (build) and upload

EAS makes the signed App Store archive (`.ipa`) in the cloud — the equivalent of Xcode's
Product → Archive — and uploads it:

```bash
cd ~/Desktop/expense-tracker/mobile
npm run build:ios              # production build; build number increases automatically
npm run submit:ios             # uploads the latest build to App Store Connect
```

Or both in one go: `eas build --platform ios --profile production --auto-submit`.

The first submit asks for your Apple ID and offers to create an **App Store Connect API key**;
accept so later uploads need no password.

### 9.3 Install through TestFlight

1. App Store Connect → your app → **TestFlight**. Wait until the build's status is **Ready to
   Submit / Ready to Test** (5–30 minutes of processing). Export compliance is pre-answered by the
   app (it uses only standard encryption).
2. **Internal Testing** → **+** → create a group → add yourself (your Apple ID must be a user on
   the App Store Connect team, which it is if you created the account).
3. On the iPhone, install **TestFlight** from the App Store, sign in with the same Apple ID,
   accept the invite → **Install**.

For each new version: commit, `npm run build:ios`, `npm run submit:ios`.

---

## Part 10 — Checklist before your first TestFlight build

- [ ] `APP_BUNDLE_ID` set in `mobile/app.config.ts` (Part 3)
- [ ] Gmail API enabled, you added as a test user, `gmail.readonly` scope added (Part 4)
- [ ] **iOS** OAuth client created for exactly that bundle ID; client ID in `mobile/eas.json` (Part 4.4)
- [ ] `EAS_PROJECT_ID` set in `mobile/app.config.ts` (Part 5)
- [ ] Project committed to git (Part 5)
- [ ] App created in App Store Connect; `ascAppId` in `mobile/eas.json` (Part 9.1)
- [ ] Optional: API deployed and `EXPO_PUBLIC_API_URL` set (Part 8.2)
- [ ] Optional: replace `mobile/assets/icon.png` (1024×1024 PNG, no transparency) with your final icon

---

## Part 11 — Before a public App Store release (not needed for TestFlight)

From `expense-tracker-architecture.md` §0 and §6:

- **Google verification + CASA.** `gmail.readonly` is a restricted scope. Public release needs
  Google's OAuth verification and an annual third-party security assessment. Testing mode (up to
  100 test users) needs neither.
- **Privacy policy URL** and the **App Privacy** questionnaire in App Store Connect. The in-app
  **Settings → Privacy** screen describes the data flows; your policy must match it and include
  Google's Limited Use statement. If you enable the AI fallback, declare the redacted email text
  sent for processing.
- **App Review demo.** Reviewers can't use a real Gmail with bank alerts. Tell them in the review
  notes: "Tap *Explore with demo data* on the first screen." Demo data runs through the real parser.
- Account deletion is not required: the app has no accounts. **Settings → Erase everything**
  deletes all local data and revokes Gmail access.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Setup needed" on Connect Gmail | The build has no valid iOS client ID. Check `mobile/eas.json` (cloud builds) or `mobile/.env` (development server), then rebuild or restart. |
| Google: "Access blocked: … has not completed the Google verification process" | Add that Gmail address under **Audience → Test users** (Part 4.2). |
| Google: "Error 400: invalid_request" / redirect mismatch | The OAuth client must be type **iOS** with the **same bundle ID** as the build. Web clients don't work in the app. |
| "Google rejected this app's OAuth client" | Client ID and bundle ID don't match, or the client was deleted. |
| "Gmail read access was not granted" | On Google's screen, keep "View your email messages and settings" ticked. |
| Asked to reconnect about weekly | Expected in Testing mode (Part 4.2). |
| App can't reach the API | `EXPO_PUBLIC_API_URL` must be your Mac's IP (not `localhost`) in development, or an `https://` URL for TestFlight. Check `…/api/v1/health` in Safari on the phone. |
| Development build shows "No development servers found" | Mac and iPhone must be on the same Wi-Fi, `npm run mobile` must be running, and Local Network access must be allowed for the app (Settings → Privacy & Security → Local Network). |
| `eas build` complains about git | Run the commands at the end of Part 5, and commit before each build. |
| Any `eas` command fails with "build.….env.… is not allowed to be empty" | EAS validates `eas.json` on every command and rejects empty strings. Delete that key instead of leaving it blank. |
| Build fails after adding packages | Always add app packages with `cd mobile && npx expo install <package>`, then `npm run doctor`. |
| Nothing found after syncing | **Settings → Sync activity** shows what was checked and which senders were skipped. **Parser lab** shows exactly how any email is read. |

---

## Useful commands

| Command (from the repo root) | What it does |
|---|---|
| `npm test` | All tests (core, server, app) |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run mobile` | Development server for the iPhone development build |
| `npm run mobile:web` | App preview in a browser (demo data) |
| `npm run server` | API + development dashboard backend on :4000 |
| `npm run dev` | Development dashboard (server + web on :5173) |
| `cd mobile && npm run doctor` | Checks app dependencies for iOS build problems |
| `cd mobile && npm run verify:bundle` | Builds the production iOS JavaScript bundle locally |
| `cd mobile && npm run verify:native` | Generates the iOS project locally to inspect Info.plist and entitlements (delete `mobile/ios` afterwards) |
