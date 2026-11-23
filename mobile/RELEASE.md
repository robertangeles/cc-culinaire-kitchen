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
| Permissions | none asked for yet | camera, notifications and the rest add theirs, with their own wording, in the wave that first uses them |
| Encryption | `ITSAppUsesNonExemptEncryption: false` (HTTPS only) | no export-compliance question on every iOS build |
| Billing | none in the app: no pricing, purchase or upgrade link (a test enforces it) | owner decision; see the Apple rule 3.1.3(b) note below |

**The version rule.** Change `version` whenever a build needs new native code (a new native module, an Expo SDK bump) or whenever you ship to the stores. Then no over-the-air update can reach an older binary. Never raise `mobile_min_app_version` (Settings, Site Settings) above a version that is already live in both stores: you would lock people out of an app they cannot yet update.

## One-time setup (owner)

1. **Expo account.** Create one at expo.dev, then `pnpm --dir mobile exec eas login`.
2. **Link the project.** `pnpm --dir mobile exec eas init` (writes `extra.eas.projectId` into `app.json`), then `pnpm --dir mobile exec eas update:configure` (writes `updates.url`). Commit both changes. Over-the-air updates do not work until this is done.
3. **Server addresses.** One per environment; development and preview must never be production:
   - `pnpm --dir mobile exec eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://<your production server> --visibility plaintext`
   - the same for `--environment preview` (a dev or staging server) and `--environment development`
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` for each environment too (the same Google "Web application" client ID the web app uses)
4. **Google sign-in** (Google Cloud Console, same project as the web client): create an **Android** OAuth client for package `com.culinairekitchen.chef` with the signing key's SHA-1 (step 6 gives it; Play App Signing gives a second one after the first upload: add both), and an **iOS** OAuth client for bundle id `com.culinairekitchen.chef`. Without them the account picker fails with `DEVELOPER_ERROR`. Sign in with Apple is built separately and needs its own capability and key.
5. **Apple.** The Developer Program account exists. Needed: your Apple ID in the prompts below, and the two test devices registered: `pnpm --dir mobile exec eas device:create` (run it once per device; open the link it prints on the iPhone and the iPad). No Mac is needed: EAS builds iOS in its cloud.
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
4. Before any production release the Play Console also needs: Data safety form (the app holds name, email, and later identity documents from compliance uploads: declare them), content rating, target audience, the privacy policy URL (use the existing web Privacy URL, `https://<your site>/privacy`), and the **account deletion** answer: in-app path "Account tab, Delete my account", web page `https://<your site>/delete-account`.
5. Production: `eas submit --platform android --profile production` (the draft goes to the Play Console for you to review and roll out).

## TestFlight and the App Store

1. In App Store Connect create the app with bundle id `com.culinairekitchen.chef`.
2. `pnpm --dir mobile exec eas build --profile production --platform ios`, then `pnpm --dir mobile exec eas submit --platform ios` (asks for your Apple login). It appears in TestFlight after Apple's processing.
3. Add internal testers (your iPhone and iPad) in TestFlight. iPad is supported, so the store listing needs iPad screenshots.
4. Before submitting for review: privacy nutrition labels, age rating, the privacy policy URL (the existing web Privacy URL), the terms URL (the existing web Terms URL), support URL, and the reviewer notes below, with the demo account.
5. Apple rule 3.1.3(b): the day the website starts selling paid plans, an app that unlocks those features must either also sell them in the app or qualify for an exemption. Billing in the app is deferred, so nothing in the app mentions plans. Revisit before the web billing launch.

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

> CulinAIre Kitchen is a tool for restaurant and café kitchen teams. Sign in with the demo account below (email and password; no code is needed). It opens straight to a stock count already in progress at "Demo Kitchen": open an area, enter a quantity for each item with the on-screen keypad, and send the area for review. Counts are saved on the phone first and sent when there is a connection, so it also works with no signal.
>
> Demo account: <email> / <password>
>
> Account deletion: Account tab, "Delete my account" (asks for the password). The demo account may be deleted during review; if it is, please contact us and we will restore it.
>
> Sign in with Google and Sign in with Apple are available on the sign-in screen. There are no in-app purchases and no paid features in this app. The Terms of Service and Privacy Policy are linked from the sign-in screen and the Account tab. Support: <support email>.

## Checks to do on real devices before each release

- iPhone, iPad (portrait and landscape) and the moto g86: sign in, count an area, send it, background and reopen the app.
- iPad: each screen reads as one centred column, not stretched across the glass (the first-run, update, delete-account, terms and sign-in screens).
- Sign in on a fresh account that has no organisation: first-run screen, join by key, join a location, reach the count.
- Delete a test account from the Account tab; confirm the phone returns to sign-in with nothing left on it.
- Open Terms and Privacy from sign-in (signed out) and from the Account tab.
- Set `mobile_min_app_version` above the installed version on a test server: the update screen appears with no link, then (after setting the store link) with the right store's button.
