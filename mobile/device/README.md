# Running the phone tests

All commands: `pnpm --filter @culinaire/mobile run <script> [-- <path filter>]`. Everything but the device walk runs in your own worktree and needs no phone.

- `check:test:logic`: node-only logic tests (`src/**`), a few seconds. Fast pre-commit gate.
- `check:test`: logic plus screen tests (`tests/*.test.tsx`, react-native-web in jsdom). Needs no env var.
  One module: `check:test -- src/count`.
- `check:e2e`: the phone's real client, session, count store and outbox against a server on :3009 and the seeded
  E2E user (credentials from `packages/client/.env.test`). Start that server with `RATE_LIMIT_PER_MINUTE=1000`, as CI does: all the files
  together make more than the 300 requests a minute one person gets.
- `check:device`: walks the real phone or emulator through adb. It always runs through `device/lease.sh`, which takes
  a machine-wide lock (`flock`, Linux only), waits up to 15 min (`DEVICE_LEASE_WAIT_S`) and shows who holds it.
  `adb()` refuses to run without the lease, so never call adb on the phone by hand while someone else holds it.
- Types and lint: `check:types`, `check:lint`.

The lease covers the adb device (moto g86, serial ZY32MB62DD) and the fixed ports: Metro 8088, API 3009, local DB 55432.
The tablet emulator has its own lease, adb server, serial and ports (see "The tablet emulator" below); the phone's adb never sees it.
There is no iOS device on this Linux machine.

Write 127.0.0.1 in every URL, never `localhost`, and give every health check a 10 s limit (`curl -sf -m 10`): on this machine
`localhost` can resolve to an IPv6 `::1` that goes nowhere (with IPv6 switched off machine-wide, `::1` is routed out over the
Wi-Fi), and a connection to it hangs. `adb reverse` has no such choice (its host side always dials `localhost`), so while that is
the case the phone cannot reach a server on this machine at all; the emulator does not need `adb reverse`.

`device/prep.device.test.ts` is the prep walk (sign in, the Prep tab, a tick with no signal, reconnect, sync, reopen offline). It makes its list through the API as a manager first.
It has not passed on the phone yet: the development build installed on 2026-11-20 predates `expo-crypto` (Sign in with Apple), so the app dies at start with "Cannot find native module 'ExpoCrypto'".
Rebuild and install the development build first (see "Rebuild and install" below; `buildStamp.sh check` says whether it is needed), then `check:device -- device/prep`, with Metro on 8088 and the API reachable from the phone (`adb reverse`).

`device/stockWalk.device.test.ts` is the Usage and Move walk (log usage with signal and in airplane mode, the "that's a move, not usage" question, a move between areas, both screens in landscape). It makes its items and areas through the API as a manager first and saves screenshots to `device/_shots`: `check:device -- device/stockWalk`, with the same Metro, API and `adb reverse` set-up as above.

`device/receiving.device.test.ts` is the receiving walk (sign in, the Receive tab, a perfect delivery, then one with a short line, a wrong price and a rejection, checked on the server). It makes its supplier, items and sent orders through the API as a manager first and changes no system setting: `check:device -- device/receiving`.

`device/chatRecipes.device.test.ts` is the Ask and Recipes walk (a streamed answer seen growing on screen, Stop, a failed answer, My Recipes, the Recipe Lab's wait and Stop,
a made recipe, a refinement, the public switch, then the same screens at iPad width by setting the phone's density so it is 820 dp wide, put back after). It needs no model key:
start the API with the fake model preloaded, which answers chat slowly and recipe and refine calls with a fixed recipe, and makes no outside call:

```bash
NODE_OPTIONS="--import $PWD/mobile/device/fakeModel.mjs" OPENROUTER_API_KEY=fake pnpm --filter @culinaire/server exec tsx src/index.ts
```

The database also needs the `recipePrompt` and `recipeRefinementPrompt` rows (`prompt` table, `default_ind = false`): they are authored in the admin UI and not seeded.
Then `check:device -- device/chatRecipes`, with Metro on 8088 and `adb reverse` for 8088 and 3009. It deletes only the recipes and conversations it made.

`device/orders.device.test.ts` is the purchasing walk: every Orders screen, written from a guide, submitted, rejected, approved, received short and credited, with no signal and on its side, photographed. It runs
through the screenshot walk's own set-up: `SCREENS_FILE=device/orders.device.test.ts SCREENS_FORMS=phone bash device/lease.sh bash device/screens.sh <out-dir>` (with the emulator's env for iPad width).

## The screenshot walk (look at every screen)

Every screen and its main states (empty, filled, error, offline or queued, long text), photographed on the phone and again at iPad widths,
with a gallery to look through. Run it after any change to a screen, and look at the images before opening a PR:

```bash
cd mobile
bash device/lease.sh bash device/screens.sh <out-dir> [<before-dir>]     # default out-dir: device/_shots/screens (git-ignored)
SCREENS_FORMS=phone SCREENS_TESTS="forgot|waste" bash device/lease.sh bash device/screens.sh /tmp/try   # one form, two tests: a quick check
```

`device/screens.sh` does all of it and stops what it started: a fresh throwaway database (`SCREENS_DB`, default `culinaire_screens`) on the local test cluster
(`scripts/localIntegrationDb.sh`, made per form so every pass starts empty), the API and Metro on free ports (other worktrees leave theirs on
3009 and 8088), then `device/screens.device.test.ts` once per form and `device/gallery.mjs`, which writes `<out-dir>/index.html` (screen name,
phone, iPad portrait, iPad landscape, the web page it mirrors; opens from disk). With a `<before-dir>` from an earlier run, a changed image is
shown next to its earlier version. Forms (`SCREENS_FORMS`): `phone` (the moto g86 as it is), `tablet` (820 x 1180 dp) and `tablet-landscape`
(1180 x 820 dp). On the phone the tablet forms set the phone's own display with `wm size` and `wm density` (reset afterwards, also when the walk
dies): the real Android runtime lays the app out at iPad width. On the tablet emulator (below) run the two tablet forms: it is already
iPad portrait, and `tablet-landscape` turns its display on its side at full resolution.

Each test starts on its own from a cleared app (`pm clear` of `com.culinairekitchen.chef` only, relaunch, sign in through the shared helper),
so a failed test never leaves the next one on the wrong screen; a failed test saves `FAILED-<name>.png`. It needs the development build
(`buildStamp.sh check`) and takes about 15 minutes a form. The round gear at the top right of a development build is the dev menu's
Tools button; the walk switches it off after each clear (when the dev menu is slow to open, the gear stays in the picture and the walk
goes on), and release builds never show it. Only `screens.sh` runs this walk: a plain `check:device` skips it (no `SCREENS_OUT`), because
its last test deletes the E2E user's account.

Google Password Manager offers to save the password after a sign-in, over whatever is on screen. `adb.ts`'s `dismissSavePassword` closes it
with the Back key whenever its text is in the screen dump (`waitFor` calls it while it polls). Never tap its buttons (Save, Never, Not now
change the owner's Google account), and never keep an image of it: it shows the owner's Google address. The walk refuses to save a shot while
the sheet is up.

## The tablet emulator (a second device, no queue)

An Android 15 x86_64 emulator under KVM, headless, shaped like an 11-inch iPad: 1230 x 1770 px at 240 dpi = 820 x 1180 dp.
Use it for layout at tablet width, for any walk that does not need real hardware, and whenever the phone's lease is busy.
Use the phone for what only real hardware shows: touch and keyboard feel, real radios and airplane mode on a carrier,
Google Password Manager, the camera, speed on a mid-range ARM phone, and a final check before a PR.

```bash
cd mobile
bash device/emulator.sh start              # cold boot (about 15 s; makes the AVD `culinaire-tablet` the first time)
eval "$(bash device/emulator.sh env)"      # this shell now uses the emulator's lease, serial and ports
bash device/emulator.sh status             # pid, boot state, host memory, who holds its lease
bash device/emulator.sh stop               # waits for its lease, so it never stops under someone's walk
```

The emulator runs on its own adb server (port 5038, started with `--one-device` so it never takes the phone's USB) at console
port 5600, outside the range the phone's adb server scans. So the phone's adb (port 5037) only ever lists the phone, and a bare
`adb` in a phone walk keeps working while the emulator runs. `env` sets `ANDROID_ADB_SERVER_PORT=5038`, `ANDROID_SERIAL=emulator-5600`,
`DEVICE_LEASE_FILE=$XDG_RUNTIME_DIR/culinaire-emulator.lease`, its own build stamp
(`CULINAIRE_BUILD_STAMP=~/.cache/culinaire-dev-build/emulator.fingerprint`), `METRO_URL=http://10.0.2.2:8098` (the address the app opens) and
`E2E_API_URL=http://127.0.0.1:3019` (the address the walk's own API calls use). So `lease.sh`, `buildStamp.sh`, `adb` and the walks in that shell use the emulator and never
wait for the phone; run its Metro on 8098 and its API on 3019 (never the phone's 8088 and 3009), against its own database on the
local cluster (any name but another worker's, for example `culinaire_emulator`). The app reaches them at 10.0.2.2, the emulator's
alias for this machine's 127.0.0.1, with no `adb reverse`. The count walk, for example:

```bash
EXPO_PUBLIC_API_URL=http://10.0.2.2:3019 npx expo start --dev-client --port 8098   # in its own shell, like the API on 3019
curl -sf -m 10 http://127.0.0.1:3019/api/health && curl -sf -m 10 http://127.0.0.1:8098/status   # both answer within 10 s, or stop here
bash device/lease.sh npx vitest run --config vitest.device.config.ts device/walk.device.test.ts
```

(`check:device -- <path>` runs every walk: pnpm 10 hands the `--` to vitest, which then ignores the path.) The screenshot walk picks
its own ports, and `env` also sets `DEVICE_HOST_IP=10.0.2.2` and its own database `SCREENS_DB=culinaire_screens_emulator`, so it runs
beside a phone walk:

```bash
SCREENS_FORMS="tablet tablet-landscape" bash device/lease.sh bash device/screens.sh <out-dir>     # with the emulator's env loaded
```

It stops itself after 15 minutes with nobody holding its lease (`EMULATOR_IDLE_S`), so it never sits on 3 GB for nothing; start
it again before the next walk. Stop it yourself when you are done. `stop` ends only the emulator `start` launched (its pid and
process group, from `$XDG_RUNTIME_DIR/culinaire-emulator.pid`), never another emulator. Its adb server stays up on purpose: a plain
adb server started on 5038 by a later adb call would take the phone's USB too (`start` replaces one that did).

The emulator needs its own development build: x86_64, where the phone's is arm64. Same steps as below, with
`-PreactNativeArchitectures=x86_64` (or `arm64-v8a,x86_64` for one APK that installs on both), and install and stamp with the
emulator's `env` loaded. Cost on this machine: the emulator and the Android 15 image take 2.6 GB in `~/android-sdk`, the AVD
about 0.9 GB in `~/.android/avd`; while running it holds about 2.5 to 3.7 GB of memory (3 GB of guest RAM: at 320 dpi the
emulator insists on 4 GB, hence 240 dpi). Delete it all with
`rm -rf ~/.android/avd/culinaire-tablet.avd ~/.android/avd/culinaire-tablet.ini`; `start` makes it again.

Measured on this machine (20 cores, 30 GB): cold boot 14 to 18 s, the x86_64 build 64 to 93 s, the count walk's sign-in screen 4.2 s
(5.2 s on the phone), the whole screenshot walk 38 minutes (13 of 14 tests, 47 images, measured before the home, Ask, Recipes, Receive and Inbox test was added; about 15 minutes a form on the phone): slower
per walk than the phone, but it never waits for the phone's lease. The emulator is not the phone: with its airplane mode on, the app still opened an area that needs the server
(count walk W5 and W6, cause not yet found), so use the phone for offline steps. At tablet width the walks
written for the phone also meet screens the phone never shows at once (the Sign in tab and button are both on screen).

`device/storeRoom.sh` photographs the Transfers and Stock screens on the phone and at iPad width (`wm size`/`wm density`, reset afterwards), then runs `e2e/storeRoom` against the same API.
The last test signs in a person without `inventory:cost` for the blind-count dashes. It makes its own throwaway database (`STOREROOM_DB`, default `culinaire_storeroom`, on the local test cluster), API and Metro on free ports, and stops them by process group: `bash device/lease.sh bash device/storeRoom.sh [out-dir]`.
On the tablet emulator, with its env loaded, run only the tablet form: `STOREROOM_DB=culinaire_storeroom_emulator STOREROOM_FORMS=tablet bash device/lease.sh bash device/storeRoom.sh [out-dir]` (no `wm` override there: it is iPad portrait as it is).

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
EXPO_PUBLIC_API_URL=http://127.0.0.1:3009 npx expo start --dev-client --port 8088   # without the variable the app shows "EXPO_PUBLIC_API_URL is not set"
adb reverse tcp:8088 tcp:8088; adb reverse tcp:3009 tcp:3009   # the walk does the first itself; the second lets the phone's 127.0.0.1 reach your server
```

Stop Metro by the pid you started (`npx` hides it: the listener is `ss -ltnp 'sport = :8088'`). After `pm clear` the first launch
shows the dev tools sheet; Back closes it.
