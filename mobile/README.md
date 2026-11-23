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
| `src/count`, `src/waste` | One folder per module: API calls, store (screen state), pure view functions, commands. |
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

`src/ui/Column.tsx`: content sits in a centred column of at most 640 dp (`Screen` does it for every screen built on it; the waste screens use `Column` directly).
Phones fill the width. The count screens are not wrapped yet. jsdom does no layout, so `tests/waste.test.tsx` checks only the column's constraints (full width, 640 dp cap, centred); the look at 390 and 820 wide is for the device walk.

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

## Tests

`check:test` runs the logic tests (`src/**`) and the screen tests (`tests/*.test.tsx`); `check:e2e` runs the real client and queue against a server
(`e2e/phoneFlow`, `e2e/wasteQueue`). See `device/README.md`.
