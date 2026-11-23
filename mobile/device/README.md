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
It needs a development build that includes it before it can run: `check:device -- device/prep`, with Metro on 8088 and the API reachable from the phone (`adb reverse`).

`device/stockWalk.device.test.ts` is the Usage and Move walk (log usage with signal and in airplane mode, the "that's a move, not usage" question, a move between areas, both screens in landscape). It makes its items and areas through the API as a manager first and saves screenshots to `device/_shots`: `check:device -- device/stockWalk`, with the same Metro, API and `adb reverse` set-up as above.
