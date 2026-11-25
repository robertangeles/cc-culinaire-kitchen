# Releasing the phone app: owner checklist

Nothing here has been run for you: no build, upload or store call was made. Each step says who does it, the exact command, and what it needs.
Run commands from the repository root. `eas` is the Expo build service; use it through the repo (`pnpm --dir mobile exec eas ...`) so everyone has the same version.

## What is already decided (in `mobile/app.json` and `mobile/eas.json`)

| Thing | Value | Why |
|---|---|---|
| App id | `com.culinairekitchen.chef` on iOS and Android | one app, both stores |
| iPad | supported from the first release (`supportsTablet: true`) | owner decision |
| Version | `version` in `app.json`, plain `1.2.3` | the server's "update to continue" rule compares it with the `mobile_min_app_version` setting |
| Build numbers | EAS keeps them (`appVersionSource: remote`, `autoIncrement` on preview and production) | never edit a build number by hand |
| Updates over the air | `runtimeVersion: { policy: "appVersion" }`, one channel per profile (`development`, `preview`, `production`) | a JavaScript update reaches only builds with the same `version`, so it can never meet a build whose native code differs |
| Server address | per EAS environment, never in a file | a test build can never silently point at production |
| Permissions | Face ID (the app lock), photos and camera (the profile picture), notifications (only when turned on) | each with its own wording in `app.json`, asked for when it is first used; later ones arrive with their feature |
| Encryption | `ITSAppUsesNonExemptEncryption: false` (HTTPS only) | no export-compliance question on every iOS build |
| App lock | on for people who approve orders or manage rosters or compliance documents, always; needs a device passcode, fingerprint or face | owner's lost-phone policy (Q6) |
| Billing | none in the app: no pricing, purchase or upgrade link (a test enforces it) | owner decision; see the Apple rule 3.1.3(b) note below |

**The version rule.** Change `version` whenever a build needs new native code (a new native module, an Expo SDK bump) or whenever you ship to the stores. Then no over-the-air update can reach an older binary. Never raise `mobile_min_app_version` (Settings, Site Settings) above a version that is already live in both stores: you would lock people out of an app they cannot yet update.

## Release blockers

| Blocker | State |
|---|---|
| Biometric app lock for people who hold approval, roster or compliance permissions (owner's Q6: before the first store release, and before any roster or compliance data is kept on the phone) | **Done in code** (`mobile/README.md`, "App lock"). Still needs: a new development build (below) and the device checks at the end of this file, on the iPhone, the iPad and the moto g86. |
| The Bench (team chat) in a store build (App Store 1.2 and Google Play: user-generated content needs a way to report a message and block a person) | **Off in production** (`EXPO_PUBLIC_BENCH` is `off` in the production profile of `eas.json`; development and preview have it `on`). Turn it on for production only when the server has report and block, and not before. |

**The app lock needs a new dev client.** `expo-local-authentication` is native code, the Face ID sentence is in the iOS build and one line in Android's MainActivity keeps the app out of the app switcher's pictures, so a development build made before it dies at start with "Cannot find native module 'ExpoLocalAuthentication'". Nothing has been built in the cloud: run the dev client commands under "Test builds" once for each platform (they use your Expo account's build allowance), or rebuild the Android one locally for free (`mobile/device/README.md`, "Rebuild and install"). If a build has already reached a tester by then, raise `version` first (the version rule above).

## One-time setup (owner)

1. **Expo account.** Create one at expo.dev, then `pnpm --dir mobile exec eas login`.
2. **Link the project.** `pnpm --dir mobile exec eas init` (writes `extra.eas.projectId` into `app.json`), then `pnpm --dir mobile exec eas update:configure` (writes `updates.url`). Commit both changes. Over-the-air updates do not work until this is done.
3. **Server addresses.** One per environment; development and preview must never be production:
   - `pnpm --dir mobile exec eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<your production server> --visibility plaintext`
   - the same for `--environment preview` (a dev or staging server) and `--environment development`
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` for each environment too (the same Google "Web application" client ID the web app uses)
   - for iOS builds, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `GOOGLE_IOS_URL_SCHEME` (see `mobile/.env.example`)
4. **Google sign-in** (Google Cloud Console, same project as the web client): create an **Android** OAuth client for package `com.culinairekitchen.chef` with the signing key's SHA-1 (step 6 gives it; Play App Signing gives a second one after the first upload: add both), and an **iOS** OAuth client for bundle id `com.culinairekitchen.chef`. Without them the account picker fails with `DEVELOPER_ERROR`. The iOS client ID and its URL scheme go into the build variables of step 3.
5. **Apple.** The Developer Program account exists. Needed: your Apple ID in the prompts below, and the two test devices registered: `pnpm --dir mobile exec eas device:create` (run it once per device; open the link it prints on the iPhone and the iPad). No Mac is needed: EAS builds iOS in its cloud. Sign in with Apple also needs the server credentials listed under "Owner setup" in the CHANGELOG entry "mobile: Sign in with Apple".
6. **Google Play.** Create the app in the Play Console (package `com.culinairekitchen.chef`). Let EAS make and keep the Android signing key: `pnpm --dir mobile exec eas credentials --platform android` and note its SHA-1 for step 4.
   - A **personal** Play account created after November 2023 must run a closed test with 12 testers for 14 days before production access. This is not yet known for this account: check the Play Console's "Testing" page when you create the listing.
   - For uploads from the command line, create a Google Cloud service account with Play Console access (Users and permissions, Release manager) and give EAS its JSON key: `eas credentials --platform android` (Google Service Account Key). Never commit the key.

## Test builds (internal)

- **Dev client** (for local development): `pnpm --dir mobile exec eas build --profile development --platform android` (or `ios`; the first iOS build asks for your Apple login and creates the certificates).
- **Release-style test build** (what a pilot chef gets): `pnpm --dir mobile exec eas build --profile preview --platform all`. Android gives an APK to install from the link; iOS gives an ad-hoc build for the registered devices.
- **Over-the-air fix to a test build:** `pnpm --dir mobile exec eas update --channel preview --message "what changed"`. Only JavaScript and assets; anything native needs a new build and a new `version`.

## Google Play: internal testing

1. First release only: in the Play Console create an internal testing release and upload the first `.aab` by hand (Play does not let the API create a first release). Build it: `pnpm --dir mobile exec eas build --profile production --platform android`; download the `.aab` from the build page.
2. After that: `pnpm --dir mobile exec eas submit --platform android --profile internal` (uses the latest production build and the `internal` track).
3. Add testers (Testing, Internal testing, Testers): an email list. They install from the opt-in link.
4. Before any production release the Play Console also needs: Data safety form (the app holds name, email, and later identity documents from compliance uploads: declare them), content rating, target audience, the privacy policy URL (use the existing web Privacy URL, `https://<your site>/privacy`), and the **account deletion** answer: in-app path "Account (a tab, or under More), Delete my account", web page `https://<your site>/delete-account`.
5. Production: `eas submit --platform android --profile production` (the draft goes to the Play Console for you to review and roll out).

## TestFlight and the App Store

1. In App Store Connect create the app with bundle id `com.culinairekitchen.chef`.
2. `pnpm --dir mobile exec eas build --profile production --platform ios`, then `pnpm --dir mobile exec eas submit --platform ios` (asks for your Apple login). It appears in TestFlight after Apple's processing.
3. Add internal testers (your iPhone and iPad) in TestFlight. iPad is supported, so the store listing needs iPad screenshots.
4. Before submitting for review: privacy nutrition labels, age rating, the privacy policy URL (the existing web Privacy URL), the terms URL (the existing web Terms URL), support URL, and the reviewer notes below, with the demo account.
5. Check `EXPO_PUBLIC_BENCH` in the production profile of `eas.json`: it stays `off` until the server has report and block (App Store 1.2).
6. Apple rule 3.1.3(b): the day the website starts selling paid plans, an app that unlocks those features must either also sell them in the app or qualify for an exemption. Billing in the app is deferred, so nothing in the app mentions plans. Revisit before the web billing launch.

## Owner chores that are not code (with the long lead times first)

| Chore | Where | Needed before |
|---|---|---|
| Confirm the **delete-account** page is published, and set the store links | Settings, Site Pages (delete-account, mobile surface); Settings, Site Settings ("App Store link", "Google Play link", empty until each listing is live; the update screen then shows no link) | any store submission |
| Reviewer demo account | below | submission |
| Google Play account age and type | Play Console | planning the first production date |

## The reviewer demo account

Apple and Google reviewers must sign in without you. The script makes (or finds) one verified account with no second step, in its own organisation "CulinAIre Demo Kitchen" with one location, three storage areas of eleven items (butter is in two, so the shared-item marker shows) and a stock take open by area. It is safe to run again; if a reviewer deletes the account (Apple tests this), run it again to restore it.

```bash
# Local first, to see it work (a local database needs no confirmation):
REVIEWER_DEMO_EMAIL=reviewer@<your domain> REVIEWER_DEMO_PASSWORD='<12+ characters>' \
  pnpm --filter @culinaire/server exec tsx src/scripts/seedReviewerDemo.ts

# Production, when you are ready. It refuses unless you name the database host, so it is never an accident:
APP_ENV=prod REVIEWER_DEMO_EMAIL=... REVIEWER_DEMO_PASSWORD=... \
  pnpm --filter @culinaire/server exec tsx src/scripts/seedReviewerDemo.ts --confirm-host <the database host it names>
```

The script prints the host before it writes anything and never prints the password. Use a mailbox you control for the email, and keep the password in your password manager.

### Reviewer notes (paste into App Store Connect "App Review Information" and the Play Console "App access")

> CulinAIre Kitchen is a tool for restaurant and café kitchen teams. Sign in with the demo account below (email and password; no code is needed). A stock count is already in progress at "Demo Kitchen": open the Count tab (under More on a small screen if it is not on the bar), open an area, enter a quantity for each item with the on-screen keypad, and send the area for review. Counts are saved on the phone first and sent when there is a connection, so it also works with no signal.
>
> Demo account: <email> / <password>
>
> Account deletion: Account (a tab, or under More), "Delete my account" (asks for the password). The demo account may be deleted during review; if it is, please contact us and we will restore it.
>
> App lock: this account can approve orders, so the app asks for Face ID, Touch ID or the device passcode when it opens. The review device needs a passcode set (Settings, Face ID & Passcode); without one the app asks for one and shows nothing else.
>
> Sign in with Google and Sign in with Apple are available on the sign-in screen. There are no in-app purchases and no paid features in this app. The Terms of Service and Privacy Policy are linked from the sign-in screen and the Account screen. Support: <support email>.

## Checks to do on real devices before each release

- iPhone, iPad (portrait and landscape) and the moto g86: sign in, count an area, send it, background and reopen the app.
- iPad: each screen reads as one centred column, not stretched across the glass (the first-run, update, delete-account, terms and sign-in screens).
- Sign in on a fresh account that has no organisation: first-run screen, join by key, join a location, reach the count.
- Delete a test account from the Account screen (a tab, or under More); confirm the phone returns to sign-in with nothing left on it.
- App lock, signed in as someone who approves orders: cold start shows the lock screen; Unlock works with Face ID or a fingerprint, and with the passcode after biometrics fail; cancel it and fail it five times (still locked, still signed in); lock the phone or switch apps for over a minute (locked) and for a few seconds (not locked); the app switcher shows a blank page; wait two minutes and approve an order (asked again; cancel sends nothing). On a spare device with no passcode: the app asks for one.
- App lock, signed in as a cook: no lock anywhere.
- Open Terms and Privacy from sign-in (signed out) and from the Account screen.
- Set `mobile_min_app_version` above the installed version on a test server: the update screen appears with no link, then (after setting the store link) with the right store's button.
