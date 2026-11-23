# Running the phone tests

All commands: `pnpm --filter @culinaire/mobile run <script> [-- <path filter>]`. Everything but the device walk runs in your own worktree and needs no phone.

- `check:test:logic`: node-only logic tests (`src/**`), a few seconds. Fast pre-commit gate.
- `check:test`: logic plus screen tests (`tests/*.test.tsx`, react-native-web in jsdom). Needs no env var.
  One module: `check:test -- src/count`.
- `check:e2e`: the phone's real client, session, count store and outbox against a server on :3009 and the seeded
  E2E user (credentials from `packages/client/.env.test`).
- `check:device`: walks the real phone or emulator through adb. It always runs through `device/lease.sh`, which takes
  a machine-wide lock (`flock`, Linux only), waits up to 15 min (`DEVICE_LEASE_WAIT_S`) and shows who holds it.
  `adb()` refuses to run without the lease, so never call adb on the phone by hand while someone else holds it.
- Types and lint: `check:types`, `check:lint`.

The lease covers the adb device (moto g86, serial ZY32MB62DD, and the emulator) and the fixed ports: Metro 8088,
API 3009, local DB 55432. There is no iOS device on this Linux machine.

`device/prep.device.test.ts` is the prep walk (sign in, the Prep tab, a tick with no signal, reconnect, sync, reopen offline). It makes its list through the API as a manager first.
It has not passed on the phone yet: the development build installed on 2026-11-20 predates `expo-crypto` (Sign in with Apple), so the app dies at start with "Cannot find native module 'ExpoCrypto'".
Rebuild and install the development build first (see "Rebuild and install" below; `buildStamp.sh check` says whether it is needed), then `check:device -- device/prep`, with Metro on 8088 and the API reachable from the phone (`adb reverse`).

`device/stockWalk.device.test.ts` is the Usage and Move walk (log usage with signal and in airplane mode, the "that's a move, not usage" question, a move between areas, both screens in landscape). It makes its items and areas through the API as a manager first and saves screenshots to `device/_shots`: `check:device -- device/stockWalk`, with the same Metro, API and `adb reverse` set-up as above.

`device/receiving.device.test.ts` is the receiving walk (sign in, the Receive tab, a perfect delivery, then one with a short line, a wrong price and a rejection, checked on the server). It makes its supplier, items and sent orders through the API as a manager first and changes no system setting: `check:device -- device/receiving`.

## Rebuild and install the development build (Android, no EAS, no accounts)

The installed development build holds the native code (Expo modules, icons, app id `com.culinairekitchen.chef`); the screens
come from Metro. So the build only needs redoing when native dependencies or `app.json`/`app.config.ts`/assets change. Ask the check:

```bash
bash mobile/device/buildStamp.sh check    # exit 1 + "STALE" = rebuild; exit 0 = current
```

It compares a fingerprint (`@expo/fingerprint`: installed native packages, app config, icons, plugins) with the one recorded after
the last install on this machine (`~/.cache/culinaire-dev-build/android.fingerprint`). Run `pnpm install` first if `package.json` changed:
it hashes `node_modules`, not `package.json`. It cannot see what is on the phone, only what this machine last installed.

Rebuild (about 2 minutes; needs JDK 17 and the SDK at `~/android-sdk`, `ANDROID_HOME` pointing at it):

```bash
cd mobile
CI=1 npx expo prebuild --platform android --no-install   # writes mobile/android (git-ignored)
git checkout package.json                                 # prebuild rewrites the "android"/"ios" scripts: undo it
(cd android && CI=1 ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a)   # arm64 only: the moto g86 and iPad-class phones
# the APK: android/app/build/outputs/apk/debug/app-debug.apk
```

Install under the lease (the install is adb use). The id is unchanged since the store plumbing (`com.culinairekitchen.chef`) and
the debug keystore is the template's, so `-r` updates in place and keeps the app's data; nothing else on the phone is touched:

```bash
bash device/lease.sh bash -c '$HOME/android-sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk'
bash device/buildStamp.sh stamp
```

If `install -r` fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (a different signing key), uninstall only this app
(`adb uninstall com.culinairekitchen.chef`) and install again; never touch other packages (`com.culinairekitchen.mobile.lite` is a different app).

Start it: Metro needs the server address when it bundles, and the phone reaches Metro through `adb reverse`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3009 npx expo start --dev-client --port 8088   # without the variable the app shows "EXPO_PUBLIC_API_URL is not set"
adb reverse tcp:8088 tcp:8088; adb reverse tcp:3009 tcp:3009   # the walk does the first itself; the second lets the phone's localhost reach your server
```

Stop Metro by the pid you started (`npx` hides it: the listener is `ss -ltnp 'sport = :8088'`). After `pm clear` the first launch
shows the dev tools sheet; Back closes it.
