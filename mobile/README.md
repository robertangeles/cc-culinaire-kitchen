# CulinAIre Kitchen phone app

Expo (React Native) app for iOS and Android, phone and tablet. How to run the checks and the device walk: `device/README.md`.
Rules that hold for every screen: light paper, copper capitals labels, Fraunces and Inter (`src/theme.ts`); taps at least 56 dp;
screens never call `fetch` (lint rule; only `src/api` does); a tab exists only for a permission the person holds, and the server
checks every call anyway.

## Layout

| Folder | What lives there |
|---|---|
| `app/` | Screens (expo-router). A module is a route group `app/(app)/(module)/`, plus one entry in `src/shell/tabs.ts` naming the permission that opens it. |
| `src/api` | The one network client: auth, refresh, coded errors (`ApiError.code`, `serverCode`). |
| `src/outbox` | The offline queue (below). |
| `src/ingredients` | The shared ingredient picker's data (below); its component is `src/ui/IngredientPicker.tsx`. |
| `src/count`, `src/waste`, `src/prep` | One folder per module: API calls, store (screen state), pure view functions, commands. |
| `src/ui` | Components shared by every module, `Column` (the tablet column) among them. |
| `packages/shared/src/schemas` | The zod schemas of what the server sends, parsed leniently at the boundary (`lenient.ts`). |

## The offline queue (`src/outbox`)

Anything a person does where signal is poor is a **command**: it is written to the phone's SQLite `outbox` table first (the screen
shows it at once as "waiting to send"), then sent in the background. Nothing is dropped without the person seeing it.

A command has a **type** (`waste.log`), a **version** (the shape of the stored JSON) and a **handler** registered for the type:

```ts
export interface CommandHandler<C> {
  type: string;                  // "waste.log"
  version: number;               // bump when the stored shape changes; give `upgrade` for old rows
  key(command: C): string;       // commands with one key are sent in the order saved: "waste:<id>"
  send(command: C, entry): Promise<void>;   // throws ApiError; must be safe to repeat
  isApplied?(err): boolean;      // a refusal that means "the server already has it" (409 ALREADY_CONFIRMED, a 404 on delete)
  classify?(err): Outcome;       // override how a refusal is read; the server's `code` decides, never its English text
  maxServerFailures?: number;    // stop retrying 5xx after this many and ask the person (network failures never count)
  fold?(open, incoming, mayBeOnServer) // what a newer command does to an open one: merge, "cancel", or "append"; only "append" once it may be on the server
  creates?: boolean;             // this command makes what its key names (a waste log): discarding it discards the later commands with the key
  latestOnly?: boolean;          // only the newest command per key matters (counts)
  describe?(command: C): string; // the line shown in the sync list (Account tab); no `describe` = not listed there
}
```

Add a module's commands in four steps: (1) a `<module>Commands.ts` exporting `xxxHandlers(client)` (copy `src/waste/wasteCommands.ts`);
(2) add them to `handlers` in `src/runtime/appOutbox.ts`; (3) enqueue with `outbox.enqueueCommand(type, command)` and call `runner.kick()`;
(4) list the command types in `QueueStatus` where it is used (Account tab: `types={[...]}`). Mint the row's **id on the phone**
(`newUuid()` in `src/outbox/uuid.ts`) and send it as the server's client-made id (`wasteLogId`, `consumptionLogId`, `stockMovementId`,
`prepSessionId`): a repeat after a lost reply then finds the same row (server answers 200 with the stored row, 201 the first time).

What the queue does, which the tests in `src/outbox/*.test.ts` pin down:

- **Ordered replay**: oldest first, one at a time, at most 20 sends a minute; a command waits for every earlier open command with the same key.
- **Retry with backoff** (5 s, 15 s, 1 min, 5 min, then every 5 min) on network failure, timeout, 429 and 5xx. A handler may cap 5xx tries (`maxServerFailures`).
- **A refusal is kept**: 400/403/404/409 (and an unreadable reply) put the command in "needs attention" with the server's message; it is not resent by
  itself. The person taps *Try again* or *Discard* (a discarded command stays on the phone as a record). Never silently dropped.
- **Already applied is success**: `isApplied` per handler (waste delete treats 404 as done).
- **Session ended (401)**: the drain stops, the command parks as "signed out" and goes back in the queue after the next sign-in (`requeueSignedOut`).
- **Survives a restart**: rows are in SQLite; a send caught mid-flight by a crash is requeued at launch (`recover`). Entries belong to the account that made them.
- **Newer app, older app**: an entry whose type or version this build does not know is kept as "needs attention / unsupported", never sent or dropped, and is
  looked at again after an update.
- **Folding**: a change made before the command leaves the phone is merged into it (edit of an unsent waste log = one POST with the final values; delete of an unsent log
  sends nothing). A command that has been tried and not definitively refused (on the wire, or a timeout, a 5xx, a lost reply, a crash) may already be on the server, so it is never
  changed or cancelled: the new one goes after it. One the server definitively refused can still be corrected in place.
- **Counts** are the built-in `count.saveLine` handler (one entry per item; a newer number replaces the older one). The count flow is unchanged.

## The shared ingredient picker

`src/ui/IngredientPicker.tsx` + `src/ingredients`. The component takes an `IngredientSource` (`src/ingredients/source.ts`):

```ts
const source = createIngredientSource({
  catalogue,            // createCatalogue({ client, kv, key }): the organisation's ingredients, downloaded in the background, read from the phone
  recents,              // createRecents({ kv, key, max }): what this person picked last, newest first
  moreNames: (q) => ..., // optional: names the server suggests for what was typed (waste: its own history and recipes)
});
<IngredientPicker label="What was thrown away" value={name} onChangeText={setName} onPick={(p) => ...} source={source} />
```

Empty, it offers recent items; typing shows matches from the phone at once (prefix, then word-prefix, then contains; accents and case ignored) and, 300 ms later, the
server's extra names. It works with no signal. A name that is in no list is accepted as typed (waste stores text). `onPick` gives `{ name, ingredientId?, unit? }`
(`unit` is the item's kitchen unit from the catalogue, or the unit last used). Consumption, transfers and orders build their own `IngredientSource` and reuse the component.
The catalogue download is `GET /api/inventory/ingredients`, which the server allows for `inventory:count` only: for someone without it the catalogue is simply empty.

## Tablet width

Content sits in a centred column of at most 560 dp, `COLUMN_WIDTH` in `src/ui/Screen.tsx` (`Screen` does it for every screen built on it; the waste and prep screens lay themselves out and use `src/ui/Column.tsx`, which reuses the same number).
Phones fill the width. The count screens are not wrapped yet. jsdom does no layout, so `tests/waste.test.tsx` and `tests/prep.test.tsx` check only the column's constraints (full width, 560 dp cap, centred; prep at 390, 820 and 1180 wide); the look at 390 and 820 wide is for the device walk.

## Add Sign in with Apple (`app/link-apple.tsx`)

Account > "Add Sign in with Apple" (iPhone and iPad only: `appleEnabled`, so Android never sees it) calls `authApi.linkApple` -> `POST /api/auth/apple/link`.
It asks for a fresh Apple credential (new nonce each time, `appleCredential`) and the proof the server wants for changing two-factor settings: the password when the account has one,
the authenticator code when MFA is on (also when the server asks for it though the profile did not say). An account with no password sends none; if it signed in more than 10 minutes ago
the server answers `RECENT_SIGN_IN_REQUIRED` and the screen offers Sign out. Closing Apple's sheet changes nothing and says nothing. An account that already has Apple shows that, with no form.

**Hide My Email.** Someone who registered by email and signs in with Apple while hiding their email gets Apple's private relay address, which never matches by email, so the server makes a second account.
Linking from the signed-in account avoids that: the server joins Apple's stable id to this account, and every later Apple sign-in opens it. Screen tests cover that the link carries the account's own proof and
the screen never reads or sends the relay address; that Apple's id then resolves to the same account is the server's (`appleSignInService`). An Apple ID already used by another account answers `APPLE_ALREADY_LINKED`: two accounts that already exist are not merged.
Not on the phone: unlinking (the web has no such page either).

Compared with the web: the web has no Apple link page at all (Sign in with Apple is phone-only), so there is nothing to mirror; the proof rules are the web's MFA-change rules.

## Waste (`src/waste`, `app/(app)/(waste)`)

The Waste tab is shown to `waste:log` holders. The screen shows today's entries at the current location (the server's list, kept on the phone, with the queue laid over it),
per-unit totals, "Log again" buttons for the six latest items, and every entry with whether it is sent. Log, change and delete only write to the queue.
Differences from the web waste page (`packages/client/src/components/waste`), found while comparing:

| Web | Phone | Why |
|---|---|---|
| The page needs `waste:read`; logging has no separate key in the web nav | The tab needs `waste:log` (PR 202's key for log/edit/delete of your own entries) | A cook can log without seeing team reports. A `waste:log`-only user therefore has a phone tab but no web page. |
| Daily total adds every quantity and labels it "kg" | Each unit on its own ("2.5 kg · 3 bunch"), cost of the entries that have one | The web number is wrong for a mix of units. |
| "Today" is the UTC date (`toISOString().split("T")[0]`) | Local midnight to midnight, sent as timestamps | A venue's day is not the UTC day. |
| Recent list and quick buttons read `data.logs`, the server sends `data`: they are always empty | Reads `data` | Web bug, not fixed here. |
| Quick buttons: the top 5 of the last 10 entries, fill the name only | The 6 latest distinct items, fill name, unit and last quantity; work offline | Two taps to repeat a portion. |
| Free-text name with server suggestions (waste history, recipes) | The same suggestions plus the downloaded catalogue and recent items | Offline, and fewer typos. |
| Lists all my entries, whatever the location | The current location only; entry carries `storeLocationId` | A log replayed after a location switch must land where it was made. |
| Edit cannot clear the cost (only sends when set) | Sends `null` to clear it | The server allows it. |
| Delete has no confirmation; a failed delete or edit is silent | Delete asks first; a refusal stays on screen with Try again or Discard | |
| `loggedAt` is the server's clock | The phone's clock when the entry was made | A queued log keeps its time. |
| Team view, Dashboard, Reuse Ideas | Not on the phone yet | `waste:read` features, later wave. |

## Prep (`src/prep`, `app/(app)/(prep)`)

The Prep tab is shown to `prep:read` or `prep:manage` holders (the server lets either tick, for anyone who works at the session's location, so any role can be given prep).
The list is today's open session at the current location, found by the phone's **local date** and the location, whoever made it: every cook at the location works from one list.
It is read now, when the app wakes, on pull-to-refresh and every 30 seconds (nothing pushes to the phone), and kept on the phone for no-signal starts (only if it is today's).
Tick, untick, skip and undo skip write one `prep.tick` command per task (only the newest per task is sent; the cook's tap is the final word, so no `expectedStatus`) and send the phone's time as `completedAt`.
Planning (`prep:manage`, the Plan screen) saves `prep.create` (client-made session id, location, local date, optional covers), `prep.selections` and `prep.generate` (`requestId`) in that order under one key.
A repeat of any of them answers 200 itself, so no 409 means "already applied" here: `PREP_SESSION_ENDED`, `CONFLICT`, 403 and 404 stay on the row (or on the "list is waiting to be made" card) with the server's words, Try again and Discard.
The plan is only offered when no list exists: generating again rebuilds the tasks and would wipe their ticks. It reads the server again first, so a list a colleague just made is not made twice (two phones planning offline at once can still make two sessions: the server has no unique key for a day and location; the newest one is shown).
Not built, and possible later: add, edit or delete a task. **They exist neither on the web nor on the server** (tasks only come from generating a list; `PATCH /api/prep/tasks/:id` changes status and `assignedTo` only), so there is nothing to mirror.
Differences from the web prep page (`KitchenCopilotPage.tsx`, `components/copilot`), found while comparing:

| Web | Phone | Why |
|---|---|---|
| Page needs `prep:manage` only | Tab needs `prep:read` or `prep:manage`; planning needs `prep:manage` | PR 202's split: a `prep:read` cook can tick without the web page. |
| "Today" is the caller's newest open session of any date and place (and a new one is made with the UTC date, so a morning in Sydney is yesterday) | The open session for the phone's local date at the current location, whoever made it | One list for the whole line; the server's `date` + `storeLocationId` query. |
| Ticks wait for the server; a failed one shows a message and the box stays | Saved on the phone at once, sent in the background; a refused one stays on its row with the reason | Offline-first. |
| No `completedAt`, so the server stamps the time it arrives | The phone's time of the tick | An offline tick keeps its time. |
| Shows no one's name on a done task | "Done by you" or "Done by a colleague", and the time | `completedBy` is a user id; **a name needs a small read-route** (not added: out of scope). |
| Assign a task to a staff name (free text) | Not on the phone | Free text on a phone is a poor fit; also the web's assign sends `status: "pending"` and can undo a colleague's tick. Later, with a user picker. |
| End session (with actual covers) | Not on the phone | Ending is a manager's act on the web; the phone keys on the date, so tomorrow starts clean. |
| Edit selections (regenerates the list), forecast covers to suggested portions | Plan once per day; portions typed or stepped, or "Use the last plan's portions" | A regenerate wipes ticks. Forecast suggestions: later. |
| "Use previous selections" reads `{selections}`; the server sends a bare array, so it does nothing | Reads the bare array | Web bug, not fixed here. |
| Portions start at 1 when a dish is ticked | Start at 0 (not picked); `+` makes 1 | A list of every dish with steppers has no tick box. |
| `expectedCovers` is never sent when the session is made | Sent when the cook types it | The progress card shows it. |
| Dishes of a task: text after the first `for ` of the description | Text after `Prep <ingredient> for `; nothing for a hand-typed description | An ingredient with "for" in its name broke the web's split. |
| Cross-usage, High impact, History, team/personal toggle, print sheet, waste-alert banner | Not on the phone | Later waves. |
| Task add, edit, delete | Not on the web or the server | See above. |

## Tests

`check:test` runs the logic tests (`src/**`) and the screen tests (`tests/*.test.tsx`); `check:e2e` runs the real client and queue against a server
(`e2e/phoneFlow`, `e2e/wasteQueue`, `e2e/prepQueue`). See `device/README.md`.
