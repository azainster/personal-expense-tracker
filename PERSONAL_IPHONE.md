# Install on your own iPhone with Xcode (free, no Apple Developer Program)

This builds the app on your Mac and installs it on your iPhone using your free Apple Account
("Personal Team"). No EAS cloud builds, no TestFlight, no US$99 membership.

Google sign-in keeps working unchanged: the bundle identifier stays
`com.yourname.expensetracker`, which is what your Google iOS OAuth client is registered for,
and the Google client ID is read from `mobile/.env`.

## What to expect with a free Personal Team

- **The app must be re-installed every 7 days.** Apple's free provisioning expires after 7 days;
  the app then won't open until you plug the iPhone in and build again (Part 6). Your expenses
  are kept — it's an update over the same app.
- Up to 3 apps signed this way can be on a device at once.
- Separately, while your Google consent screen is in Testing mode, Google asks you to reconnect
  Gmail about every 7 days.
- Background refresh, Keychain storage, Gmail sign-in and everything else in the app work.

---

## Part 1 — Install Xcode and CocoaPods (once)

1. Install **Xcode** from the Mac App Store (free). It needs a lot of disk space: plan for about
   40 GB free during installation. Check with `df -h /`.
2. Open Xcode once, accept the license, and when asked which platforms to install, include
   **iOS**. (Later: Xcode → Settings → Components.)
3. In Terminal, point the command-line tools at Xcode and finish setup:

   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   xcodebuild -runFirstLaunch
   xcodebuild -version
   ```

4. Install CocoaPods (the iOS dependency manager React Native uses):

   ```bash
   brew install cocoapods
   pod --version
   ```

If your iPhone runs a newer iOS than your Xcode supports, update Xcode first.

## Part 2 — Add your Apple Account to Xcode (once)

1. Xcode → **Settings…** → **Accounts** → **+** → **Apple Account** → sign in.
2. Your account appears with a team named **"Your Name (Personal Team)"**.

## Part 3 — Prepare your iPhone (once)

1. Connect the iPhone to the Mac with a cable. Unlock it and tap **Trust** when asked.
2. In Xcode: **Window → Devices and Simulators**. Select your iPhone and wait until Xcode finishes
   preparing it (this can take several minutes the first time).
3. On the iPhone: **Settings → Privacy & Security → Developer Mode → On**, restart, and confirm.
   (The Developer Mode switch appears after the iPhone has been connected to Xcode.)

## Part 4 — Generate the iOS project (after any configuration change)

```bash
cd /path/to/expense-tracker
npm install
cd mobile
npm run ios:prebuild
```

This creates `mobile/ios/` from `app.config.ts` (bundle ID, Google sign-in URL scheme,
background refresh), installs the iOS pods, and writes `ios/.xcode.env.local` so Xcode can find
Node. `mobile/ios/` is generated: don't edit it by hand, and re-run this command after changing
`app.config.ts`, `mobile/.env`, or adding native packages.

## Part 5 — Build and install

The app runs on its own (no Mac needed) when built in **Release**. Choose A or B.

### A. From Terminal (simplest)

With the iPhone connected and unlocked:

```bash
cd /path/to/expense-tracker/mobile
npm run ios:device:release
```

Pick your iPhone from the list. If asked for a signing team, choose your **Personal Team**.

### B. From Xcode

```bash
cd /path/to/expense-tracker/mobile
npm run ios:open
```

In Xcode:

1. In the left sidebar, click the blue **ExpenseTracker** project, then the **ExpenseTracker**
   target → **Signing & Capabilities**.
2. Tick **Automatically manage signing**. **Team**: *Your Name (Personal Team)*.
   **Bundle Identifier** must read `com.yourname.expensetracker`.
3. Top toolbar: choose your **iPhone** as the run destination.
4. **Product → Scheme → Edit Scheme… → Run → Build Configuration: Release** → Close.
5. **Product → Run** (⌘R).

### First launch on the iPhone

If iOS says **Untrusted Developer**: **Settings → General → VPN & Device Management** → under
Developer App, tap your Apple Account → **Trust**. Then open **Expense Tracker** → **Connect Gmail**.

## Part 6 — Every 7 days

When the app stops opening, connect the iPhone and run `npm run ios:device:release` again (or ⌘R
in Xcode). No need to repeat Parts 1–4 unless you changed configuration.

## Optional: live development build

`npm run ios:device` builds the Debug version, which loads code from your Mac and reloads
instantly. It needs the Mac running and the iPhone on the same Wi-Fi.

## Optional: keep the signing team across `ios:prebuild`

`npm run ios:prebuild` regenerates the Xcode project, which resets the team you chose in Xcode.
To avoid re-selecting it, add your team ID to `mobile/.env`:

```bash
APPLE_TEAM_ID=ABCDE12345
```

Find it in Xcode after selecting your Personal Team: target → **Build Settings** → search
**Development Team** (the 10-character value), or in `mobile/ios/ExpenseTracker.xcodeproj/project.pbxproj`
as `DEVELOPMENT_TEAM`.

## Optional: the backend

Only for rules-pack updates and the optional AI fallback. The Release build reads
`EXPO_PUBLIC_API_URL` from `mobile/.env` when it's built (for example, `http://<your-mac-ip>:4000`).
Run `npm run server` from the repo root while using the app on the same Wi-Fi. If your Mac's IP
changes, update `mobile/.env` and build again.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Personal development teams … do not support the … capability" | Make sure `IOS_DATA_PROTECTION_ENTITLEMENT` is not set in `mobile/.env`, then `npm run ios:prebuild` again. |
| "Failed to register bundle identifier" / "cannot be registered to your development team" | The bundle ID is taken by another Apple team. Pick a new one in `mobile/app.config.ts` (`APP_BUNDLE_ID`), update the **Bundle ID** of your Google iOS OAuth client to match, then `npm run ios:prebuild`. |
| "No Accounts" / "Signing requires a development team" | Part 2, then select the Personal Team (Part 5 B step 2). |
| Build phase fails with `node: command not found` | Run `npm run ios:prebuild` again (it writes `ios/.xcode.env.local`). |
| "Could not launch… The app has not been trusted" | First-launch trust step above. |
| "Maximum number of apps for free development profiles reached" | Delete another app you installed from Xcode with a free account. |
| iPhone not listed / "Developer Mode disabled" | Part 3. Keep the phone unlocked during install. |
| `pod: command not found` | Part 1 step 4. |
| Connect Gmail says "Setup needed" | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` must be set in `mobile/.env`; then `npm run ios:prebuild` and build again. |
