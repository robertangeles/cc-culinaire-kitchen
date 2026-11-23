# CulinAIre Kitchen phone app

Expo (React Native) app for iOS and Android, phone and tablet. How to run the checks and the device walk: `device/README.md`.
Rules that hold for every screen: light paper, copper capitals labels, Fraunces and Inter (`src/theme.ts`); taps at least 56 dp;
screens never call `fetch` (lint rule; only `src/api` does); a tab exists only for a permission the person holds, and the server
checks every call anyway.

## The look: check every screen against this

Run the screenshot walk (`device/README.md`, "The screenshot walk") after changing a screen, open its gallery and go down this list for the phone and both iPad widths:

- Light paper background (`bg`), never white; cards and grouped rows on the sunk paper `Surface` with hairline dividers.
- Section and field labels in copper capitals (Inter semibold 12, letter-spaced, `accentText`); titles and sentences in Fraunces; buttons, chips, numbers and short facts in Inter. Nothing below 16 pt except those labels.
- A tab's title says what it is ("Waste", "Count"), with the location under it in Inter; an empty tab shows its state in a card (copper label, one sentence), never a bare line.
- Nothing clipped or overlapping: tab labels fully above the system navigation bar, long item names wrap, buttons fit their words.
- At most five tab buttons; more modules go under More (`src/shell/tabs.ts`, `tabBar`), and Account is always reachable.
- On a tablet the content sits in the centred 560 dp column (`Screen` or `Column`), with equal paper on both sides.
- A signed-in screen, the location choice and Terms and Privacy start at the top (`Screen` with `align="top"`); only sign-in, forgot password, check email, the two-step code, first run, update required and account deleted sit centred down the page.
- The primary action is the copper gradient button; quiet actions are copper text; destructive ones outlined in ember. Offline is the saffron banner, waiting rows say "Waiting to send".
- With the keyboard up, the field being typed in stays visible; a form's button may need a scroll but is never unreachable.
- No pricing, purchase or upgrade link anywhere (subscriptions are sold on the web).

## Layout

| Folder | What lives there |
|---|---|
| `app/` | Screens (expo-router). A module is a route group `app/(app)/(module)/`, plus one entry in `src/shell/tabs.ts` naming the permission that opens it (none when the server asks only for a signed-in person), in the order a line cook uses them (Prep, Waste, Usage, Count, Move, Receive, Ask, Recipes). Past five tab buttons, the fifth is More (`app/(app)/more.tsx`), listing the rest and Account. A tab under More keeps its route and loses only its button: never `href: null`, which expo-router turns into a hidden tab that redirects to the first tab when opened. |
| `src/api` | The one network client: auth, refresh, coded errors (`ApiError.code`, `serverCode`). |
| `src/outbox` | The offline queue (below). |
| `src/ingredients` | The shared ingredient picker's data (below); its component is `src/ui/IngredientPicker.tsx`. |
| `src/count`, `src/waste`, `src/prep`, `src/consumption`, `src/movements`, `src/chat`, `src/recipes`, `src/notifications` | One folder per module: API calls, store (screen state), pure view functions, commands. |
| `src/profile` | The photo picker and the kitchen profile form's rules. |
| `src/ui` | Components shared by every module, `Column` (the tablet column) among them. |
| `packages/shared/src/schemas` | The zod schemas of what the server sends, parsed leniently at the boundary (`lenient.ts`). |
| `packages/shared/src/utils/menuCosting.ts` | Menu and recipe costing (line cost, food cost %, margin, plate P&L cost, classification, the 35% alert and 30% category target). The phone imports costing from `@culinaire/shared`, never its own copy; the server and the web import the same functions. Where the web editor and the server round or guard differently each keeps its own named function (`previewLineCost`, `editorItemCosts` for a live preview; `storedLineCost`, `storedItemCosts` for what the server saves): a phone editor uses the preview ones, and the differences are listed in `menuCosting.test.ts`. |

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
  catalogue,            // createCatalogue({ client, kv, key, path }): the organisation's ingredients, downloaded in the background, read from the phone
  recents,              // createRecents({ kv, key, max }): what this person picked last, newest first
  moreNames: (q) => ..., // optional: names the server suggests for what was typed (waste: its own history and recipes)
});
<IngredientPicker label="What was thrown away" value={name} onChangeText={setName} onPick={(p) => ...} source={source} />
```

Empty, it offers recent items; typing shows matches from the phone at once (prefix, then word-prefix, then contains; accents and case ignored) and, 300 ms later, the
server's extra names. It works with no signal. A name that is in no list is accepted as typed (waste stores text). `onPick` gives `{ name, ingredientId?, unit? }`
(`unit` is the item's kitchen unit from the catalogue, or the unit last used; `itemType` is the catalogue's KITCHEN_INGREDIENT, FOH_CONSUMABLE or OPERATIONAL_SUPPLY). Usage and Move build their own `IngredientSource` (the catalogue and their own recents, no server name list) and reuse the component; transfers and orders will do the same. Those two need the item's id (the server takes an ingredient, not free text), so a name that is not in the list is refused on the form, and so is an item whose unit is not known ("Pick the item from the list again"): the unit is cleared whenever the name is retyped or an item without a kitchen unit is picked, so an earlier item's unit is never carried over.
The catalogue download is `catalogueRoute(user)`: `GET /api/inventory/ingredients` for someone with `inventory:count`, and for a cook who may only log waste `GET /api/waste/ingredients`,
a read-only list of id, name and kitchen unit (no cost, stock or supplier; the server opens it to `waste:log` and `inventory:count`). Both are kept on the phone the same way and read offline.
If a download fails (no signal, or a server that does not have the route yet) the last list stays and the picker still offers recent items and the server's name suggestions.

## Ask Antoine (`src/chat`, `app/(app)/(chat)`)

The Ask tab is shown to everyone signed in: the server asks for no permission on chat, conversations or recipes (a tab entry
without `anyPermission` in `src/shell/tabs.ts`). Guest chat is not on the phone yet.

`POST /api/chat` is a chunked HTTP POST that answers in the Vercel AI SDK v4 data-stream format, one `<code>:<json>` line per part;
it is not SSE. `src/chat/dataStream.ts` joins lines split across network pieces and reads `0` (text), `3` (error) and `8`
(the `brain_grounded` annotation); everything else is skipped. The server keeps no chat state, so every question sends the whole
history (`chatStore.ts`). The body arrives through `client.stream`, which uses `expo/fetch` on the phone (the built-in fetch buffers).
A refusal is read from the server's `code`, never its English: `RATE_LIMITED`, `AI_UNAVAILABLE`, `AI_TIMEOUT` (and the client's own
time-out), `FREE_SESSIONS_EXHAUSTED`, signed out, no signal. A `3:` part partway keeps what arrived next to the message. The
conversation is saved after each finished or stopped answer (`POST /api/conversations` with an id made on the phone, then the messages
with their ids; both are safe to repeat; one save runs at a time). As on the web, a save sends only the messages not saved yet: the server builds a Brain
memory from what each save sends, so sending the whole conversation again would repeat it.

**Streaming on a real phone (the spike), 2026-11-24.** Chat chunks arrive one at a time through `expo/fetch` on the moto g86
(development build, Android, against a local server whose model is `device/fakeModel.mjs`, no paid calls). In the device walk
(`device/chatRecipes.device.test.ts`, all 10 steps passed) the screen was read while an answer streamed one line every 2.5 s: its
lines on screen went 1, 2, 3, 4, 5, 6, 7, 8 with Stop showing until the end; a second answer stopped after 3 lines kept those 3. Not yet run on an iPhone or an iPad (no Mac). How to read the phone's
screen from a test: uiautomator only dumps an idle screen, so text that changes faster than about once a second cannot be sampled
(the walk slows the fake model down; the Recipe Lab's clock steps every 5 s for the same reason and for screen readers).

Differences from the web chat (`ChatContainer.tsx`, `ConversationList.tsx`), found while comparing:

| Web | Phone | Why |
|---|---|---|
| Guests can chat (`gate: "guest-ok"`) | Signed-in people only | Guest chat is a follow-up. |
| Errors are matched on the English text: one "Something went wrong" for 429, 503, 504 and a stream error | One plain sentence per `code` (too fast, not available, too long, signed out, no signal, free sessions used up) | The phone branches on the code. |
| Free sessions used up: "Upgrade to continue" links to the profile | The sentence only, no link and no Try again | No billing or upgrade links in the app (owner, Q7). |
| No retry | Try again after a failure sends the same history again (a half answer is dropped first) | Asked for in this wave. |
| Leaving mid-answer moves the stream to the background (it is re-POSTed) | Leaving the conversation stops the answer; what arrived is saved | A background answer is a follow-up. |
| Image mode and the web-search toggle (when the site settings turn them on) | Not on the phone | Follow-up. |
| Markdown with GFM (tables, code blocks, images) | Headings, lists, bold, italic and links (`src/ui/Markdown.tsx`, shared with the legal pages); a table or code block shows as plain text | No new dependency. |
| "Grounded in your Brain" chip, dismissible, expands to the note titles | The same label, expands to the titles; not dismissible | |
| Delete (hover trash) without asking | Delete asks first | |
| A failed save is silent | "Not saved yet" with Save again | |
| Empty state subtitle is the site's description | A fixed line | The site settings are not read by the phone. |
| No rename | No rename | Same (the server's PATCH is never used). |

## Recipes (`src/recipes`, `app/(app)/(recipes)`)

The Recipes tab is shown to everyone signed in. It opens on My Recipes; "Create a recipe" is the culinary Recipe Lab; a recipe opens its own page.

Generation (`labStore.ts`) can take up to two and a half minutes (the server stops at 150 s with `AI_TIMEOUT`; the phone waits 170 s).
The screen shows the time so far, how long it usually takes, and Stop. The server saves a recipe only when it is made, and a stop, a
time-out or a model failure saves nothing and costs no session (PR 215). Only a reply lost after the server finished can leave a recipe
the phone never heard about, so before generating the phone notes the newest of My Recipes (without that look the request is not sent),
and after a lost reply or a stop it looks again. A recipe that was not there when the request began is offered as a question ("A new
recipe appeared. Is it this one?", it may have been made on the web meanwhile) instead of being made twice. "Nothing was saved" is said
only when that second look worked and shows no new recipe; when it could not be made the screen says so, asks the person to look in
My Recipes first, and offers Check again beside Try again (a Try again from there looks once more before it sends anything). A dropped
connection is different from a stop or the phone's own time-out: the server does not see a phone change networks and may still be
writing, so until its limit has passed (160 s after the request was sent) the screen says the recipe may still be on its way, looks in
My Recipes every 15 s, and offers Check now but not Try again. The lab opens a finished recipe only while its screen is in view. A recipe that finishes while the person is back on My Recipes appears in the
list. Returning to My Recipes reads every page already loaded again, so the list keeps its length and a recipe added or removed elsewhere shows as the server has it. Refine (`recipeStore.ts`) is a
proposal: nothing is saved until Accept (`accept-refinement`); Discard drops it; once Accept is saved the proposal is gone even if the
recipe cannot be loaded again. The owner's switch is `PATCH /api/recipes/:id`
`{ isPublicInd }`, shown at once and put back if the server refuses. Ownership comes from the server: `userId` is sent only to the owner.
An image the server keeps itself has a site-relative path, which the phone completes with the server's address (`recipeApi.ts`).

Differences from the web (`RecipeLabPage.tsx`, `RecipeForm.tsx`, `MyShelfPage.tsx`, `RecipeRefinePanel.tsx`), found while comparing:

| Web | Phone | Why |
|---|---|---|
| Recipe, Patisserie and Cocktail labs | The culinary Recipe Lab only | The other labs are out of scope for this wave. My Recipes still lists and opens their recipes. |
| The same culinary fields; servings is a number box | The same fields and lists; servings is a − / + stepper (1 to 100) | |
| "Generating..." on the button; no way to stop | Time so far, the usual duration and Stop | An honest wait. |
| A retry after a lost reply can make the recipe twice | A recipe that appeared is offered first ("is it this one?"); if the shelf cannot be read, Check again | Uses the server's rule that nothing is saved unless made. |
| "Grounded in your Brain" chip on the lab result | The same chip on the page of the recipe just made, expands to the note titles | Matched. Only the generate reply carries it, so it is not shown when the recipe is opened later. |
| The result is shown on the lab page (kept in the browser session) | The saved recipe's own page opens | |
| My Recipe Book: All / Culinary / Patisserie / Spirits, search over what is loaded, Load more, "Showing X of Y" | The same | |
| Archive, ratings and view counts on the cards | Not on the phone | Follow-up. |
| The recipe page: versions, share, email, edit, image regeneration, ratings and reviews, flavour balance, nutrition, wine pairing, baker's percentages | Image, facts, ingredients, method, pro tips, why it works, allergens, the model's note | Read and refine only in this wave; image regeneration is a follow-up. |
| Refine: Cancel, Try Again, Accept Changes | Discard, Accept changes (refine again to try again); Stop while it works | |
| Public/private on the lab result and the shelf | "Only me / Public" on the recipe page, for the owner only | |

## Tablet width

Content sits in a centred column of at most 560 dp, `COLUMN_WIDTH` in `src/ui/Screen.tsx` (`Screen` does it for every screen built on it; the waste, prep, usage, move, receiving, chat and recipe screens lay themselves out and use `src/ui/Column.tsx`, which reuses the same number).
Phones fill the width. The Count areas list uses `Column`; the area count and needs-attention screens are not wrapped yet. jsdom does no layout, so the screen tests check only the column's constraints (full width, 560 dp cap, centred): `tests/waste.test.tsx`; `tests/prep.test.tsx` at 390, 820 and 1180 wide; `tests/usage.test.tsx`, `tests/moves.test.tsx`, `tests/chat.test.tsx` and `tests/recipes.test.tsx` at window sizes of an iPad in portrait (820 x 1180) and landscape (1180 x 820) and a phone (390 x 844). `tests/receiving.test.tsx` at an iPad's width. The look is for the device walk. Usage and Move use `Column` and have no second column definition. They have no two-column layout: a tablet gets the same column in the middle of the paper.

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

## Usage (`src/consumption`, `app/(app)/(usage)`)

The Usage tab is the web's "Internal Usage" (inventory, Transfers tab). It is shown to `inventory:count` holders, the key the server asks for on every consumption route
(and on the catalogue download the picker uses, so nobody who sees this tab is left without ingredients). The screen shows today's entries at the current location (the server's
list, kept on the phone, with the queue laid over it), per-unit totals with returns kept apart, "Log again" buttons for the six latest items, and every entry with whether it is sent.
Log, change and delete only write to the queue (`consumption.log`, `consumption.edit`, `consumption.delete`, ids made on the phone as `consumptionLogId`); the server answers a repeat with 200 and takes no second deduction.
Refusals stay on the entry with the server's words and Try again or Discard: another person's id (409 `CONFLICT`), a location the person does not work at (403 `LOCATION_NOT_ALLOWED`),
units that cannot be converted (422 `INCOMPATIBLE_UNITS`), an item the server does not know (404 `NOT_FOUND`), an edit or delete after 24 hours (409 `EDIT_WINDOW_EXPIRED`, a refusal, never "already applied"),
someone else's entry (403 `FORBIDDEN`). A delete of an entry that is already gone is success (200 now, a 404 from an older server).
Differences from the web (`packages/client/src/components/inventory/ConsumptionLogger.tsx`), found while comparing:

| Web | Phone | Why |
|---|---|---|
| The Inventory page opens for `inventory:count`, `inventory:manage`, `inventory:transfer` or `inventory:hq`; the form's own routes need `inventory:count` | The tab needs `inventory:count` | A person with only manage, transfer or HQ sees the web page but gets 403 on logging. Web gate is wider than the server's. |
| Items come from the location (`GET /locations/:locId/ingredients`): only items active there, with the stock on hand, greyed out at zero (except for Return to Stockroom) | The shared picker searches the organisation's whole catalogue, works offline, shows no stock and never blocks an item at zero | The server checks neither activation nor stock; offline the phone cannot know them. An item not active at the location can be logged and makes a stock row there. A location-activated list is a small read-route follow-up. |
| Unit is the location's unit override, else the kitchen unit | Always the item's kitchen unit (shown under the quantity) | The server converts any unit to the kitchen unit; the phone does not download overrides yet. Where an override exists, the number the person types is in the kitchen unit. |
| Optional "Dish" for the Kitchen reason (`menuItemId`, for yield variance) | Not on the phone | The dish list needs `menu:read`; comes with the menu wave. |
| Entries are final: "no edits", although the server lets the logger or an Administrator change and delete within 24 hours | Edit quantity, reason, shift and notes, and delete, your own entries (an Administrator any); the item cannot be swapped | Asked for in the wave. A change after 24 hours is refused by the server and shown. |
| Asks "That's a move, not usage" (modal) for FOH usage of kitchen ingredients and FOH consumables, with "Record as movement" carrying item and amount to the movement form | The same question as an alert with the same three answers; "Record as movement" opens Move filled in. An item whose type the phone does not know yet (a catalogue saved before it was sent) counts as a kitchen ingredient. Not asked when editing | Same rule, `FOH_MOVE_ITEM_TYPES` in `packages/shared/src/schemas/consumption.ts`. |
| The form's header and submit button say "Transfer" | "Log usage" | Web wording slip next to the Location Transfer view; not fixed here. |
| Reasons and shifts are lists in `ConsumptionLogger.tsx` | The same keys and labels, copied to `packages/shared/src/schemas/consumption.ts` | Keep the two in step until the web imports the shared list. |
| Lists everyone's entries at the location whose `loggedAt` falls on the browser's calendar day | Local midnight to midnight sent as timestamps; other people's entries are shown read-only with their name | A venue's day is not the UTC day. |
| `loggedAt` is the server's clock | The same: the route takes no time. The phone shows its own clock until the entry is sent, then the server's | An entry made offline and sent after midnight moves to the next day's list. Waste sends its own time; the consumption route could too (needs a server change, not made here). |
| Counts only "N today" | Per-unit totals; "Return to Stockroom" entries are shown apart, never added to usage | Mixed units cannot be added. |
| A quantity of zero or less is refused on the form only | Refused on the form and again before an edit is queued | The edit route stores any number. |
| Quick buttons: none | "Log again" for the latest six items, with unit, quantity and reason | The 15-second entry. |
| Location Transfer view (create, send, receive) | Not on the phone | Create, send and receive are not safe to replay (no client id or guard; the plan puts it in Wave 3 with the server work). Nothing is queued that could double-apply. |
| No adjustment screen | None | The web has none either: stock is changed by counts, and the only way to put stock back is the Return to Stockroom reason. |

## Move between areas (`src/movements`, `app/(app)/(moves)`)

The Move tab is the web's "Move Between Areas", shown to `inventory:count` holders. A move ("4 bottles, Stock Room to Bar") changes no stock: the item stays on site until it is sold or wasted. One command, `movement.log`, with its id made on the phone (`stockMovementId`);
it is sent to the location the move was made at. The areas and the latest moves are kept on the phone, so the form works with no signal once it has opened once with one.
Refusals stay visible: an area that is not at the location (404 `NOT_FOUND`), an area no longer in use or the same area twice (400 `VALIDATION`), units that cannot be converted (`INCOMPATIBLE_UNITS`).
Differences from the web (`StockMovementForm.tsx`):

| Web | Phone | Why |
|---|---|---|
| Item search over the location's items (six results), stock shown | The shared picker over the organisation's catalogue, no stock | As for Usage. |
| Unit is the location's override, else the kitchen unit | The kitchen unit | As for Usage. |
| From and To are drop-downs; To leaves out the chosen From | Rows of chips; the same rule | |
| Fewer than two areas: "No areas yet" / "You need a second area" | The same words; with no signal and nothing downloaded yet it says the areas have not been downloaded | |
| "Recent moves": the latest ten, from the server | The latest twenty, with moves still waiting to send laid over them, each with its state | Offline-first. |
| `movedAt` is the server's clock | The same; the phone shows its own clock until the move is sent | As for Usage. |
| Moves cannot be changed or deleted | The same | The server has no route for it. |
| No quick buttons | "Move again" for the latest six moves, with item, amount and areas | |
| Notes up to 500 characters | The same, checked before it is queued (as is an amount over 99,999) | The server refuses both. |

## Receive (`src/receiving`, `app/(app)/(receive)`)

The Receive tab is shown to `purchasing:receive` holders. It is the web's receiving (`components/purchasing/ReceiveQueue.tsx`, `ReceivingChecklist.tsx`) and uses the same routes.
**Online-only**: nothing is written to the outbox. Every tap waits for the server and the screen shows what the server saved; a refused change stays on its line with the server's words (the web swallowed a failed line save and confirmed anyway).
The queue is the SENT and RECEIVING purchase orders at the current location, soonest expected first (the server filters and sorts), read again whenever the screen comes back into view and on pull-to-refresh.
A row says "In progress" for a delivery you have open and names a colleague who has it open. The expected day is the order's UTC calendar day (the server stores the day typed on the web as UTC midnight) compared with the phone's own today.
Opening a delivery starts its session, or resumes the open one (a banner names whoever started it on another phone; both phones change the same delivery). Every line starts as received in full, so a perfect delivery is: open, Confirm.
A line offers All good, Short (less than ordered, typed on the count keypad), Wrong price and Reject (a reason and an optional note). The server keeps one status per line, so the row shows the quantity and the price it holds whatever the status. Substituted lines are shown, not made on the phone.
While a keypad or reject panel is open only that line shows and Confirm is hidden. Confirm also waits until no line is saving. A short delivery closes the order as partial; the balance goes on a new purchase order.
"Back to deliveries" leaves the delivery open; "Cancel receiving" asks first, discards it (nothing reaches stock) and puts the order back in the queue.
A delivery another phone already confirmed (`ALREADY_CONFIRMED`) or cancelled (`INVALID_STATE`) says so and offers the queue. A unit with no path to the kitchen unit (`UNIT_NOT_CONVERTIBLE`) names the item and leaves the delivery open: reject that line to go on.

## Inbox and push (`src/notifications`, `app/(app)/(inbox)`, `app/notification-settings.tsx`)

The **Inbox** tab is everyone's (an entry in `src/shell/tabs.ts` with no permission: the server's notification routes need only a sign-in), with the unread count on its button.
It lists the server's unread notifications (`GET /api/inventory/notifications?limit=50`, the count from `/count`), newest first, each with a heading and a sentence for its type
(`notificationView.ts`; every type in `NOTIFICATION_TYPES` has its own words, a type this build does not know reads "Notification"). The list is kept on the phone, so it opens with no signal.
It is read when the tab opens, when the app wakes, when a push arrives and every minute while the app is open. **Mark read** is the queued command `notification.read`
(a 404 counts as done), so it works offline and the row stays gone if a refresh lands before the server has it. **Open** shows only where the phone has the screen the notification is about
(today an overdue delivery opens the Receive list); the server's link (`pushLink`) names routes for shifts, documents and orders that come in later waves.

**Push** (`push.ts`, native side in `nativePush.ts`): off until the person taps **Turn on** (the card at the top of the inbox, or Notification settings); the app never asks at launch.
Turning it on asks the system, gets the Expo push token and registers it with `POST /api/notifications/register-device`, sending the refresh token so the server ties it to this sign-in.
It is registered again at every sign-in and app start (tokens change), removed with `unregister-device` when turned off, and removed before sign-out (3 s at most; the server also drops it when the sign-in ends).
A refused permission shows **Open settings**. A tapped push opens the screen it is about (and marks it read) or the inbox; one that started the app waits for the session. A push that arrives with the app open shows as a banner and refreshes the inbox.
**Notification settings** lists the server's kinds with a switch each (`PUT /api/notifications/push-preferences`, `disabledTypes`) and sets quiet hours (24-hour times in the phone's own time zone; a push inside the window is skipped, not saved for later). Neither touches the inbox.

**Before push works on a phone** (owner, needs credentials): `eas init` (writes `extra.eas.projectId` into the app config), FCM credentials in the Expo project and `google-services.json` for Android, an APNs key for iOS,
then `EXPO_PUSH_ENABLED=true` in Settings > Integrations. Until then **Turn on** ends at "This version of the app can't receive pushes yet", and the inbox works as before. `expo-notifications` is a native module: rebuild the development build (`device/README.md`).

Differences from the web bell (`components/layout/NotificationBell.tsx`), found while comparing:

| Web | Phone | Why |
|---|---|---|
| A bell in the header; the 20 newest unread | A tab with a badge; the 50 newest unread; the count from the server, so it can be more than the list | |
| Thirteen types have a label; the other six (Brain problems, document expiring, holiday shift asked or declined, swap picked up, document to review) show "Approval needed" | Every type has its own heading and sentence | The web fallback is wrong for them. |
| Text: `body`, `summary`, else the order number, reason and supplier | The same, plus the document and whose it is, the holiday shift's date, the Brain error count; a plain sentence when the payload has nothing | |
| A click marks it read and opens Purchasing for an order; any other type opens nothing | **Open** only where the phone has the screen; **Mark read** always | Shifts, documents and orders are later waves. |
| X dismisses | Not on the phone: Mark read takes it off the list the same way | The dismiss route stays on the web. |
| A failed read is silent | Queued; works with no signal; a refusal stays in the Account sync list | |
| No read history, no "mark all read" | The same | **The server keeps only unread rows**; history and mark-all need server routes. |
| No push, no settings page | Push and Notification settings | Phone only. |

## Profile and account (`app/(app)/account.tsx`, `app/profile.tsx`, `app/change-password.tsx`, `app/two-step.tsx`, `app/kitchen-profile.tsx`)

The Account tab is the hub: picture, name, email and location, then **My details**, **Kitchen profile**, **Password**, **Two-step verification** and **Notifications**, then the sync list, change location, Add Sign in with Apple (iPhone and iPad), sign out, the legal pages and Delete my account.
A change of name, picture or two-step setting reads the person again (`session.refreshUser`), so every screen shows it at once. The picture is picked with `expo-image-picker` (`src/profile/pickImage.ts`, a native module: rebuild the development build), cropped square on the phone and uploaded as multipart `file`.

Differences from the web profile (`pages/ProfilePage.tsx`, `components/profile`), found while comparing:

| Web | Phone | Why |
|---|---|---|
| Account Details: name, bio (300), address, five social links; Save, and an autosave when leaving the tab | The same fields; Save only | A phone screen has no tab switch to hang an autosave on. |
| An emptied field is sent as nothing, so it cannot be cleared (and clearing every address field leaves the old address) | Every field is sent, an emptied one as `""`, which clears it; the six address fields always go together (the server writes them as one) | |
| Picture: a file, then a crop window | Choose photo or Take photo, the system's square crop, compressed; HEIC is refused on the phone with a plain sentence | The server takes PNG, JPEG and WebP. |
| Change password shows the form to an account with no password; the server answers "Account uses OAuth login" | Says there is no password to change | |
| Change password does not send the refresh token in the body (the cookie does it) | Sends it, so this phone stays signed in while every other sign-in ends | |
| Two-step set-up: a QR and the key | The key with **Open in authenticator app** (an `otpauth:` link) and the QR for an authenticator on another device | Scanning a QR on the phone that shows it is not possible. The server does not send its `otpauth` URL, so the phone builds it with the server's issuer ("CulinAIre Kitchen") and the account's email. |
| A sign-in that is too old for a change (no-password account) shows the server's sentence | Says so and offers Sign out | |
| Kitchen profile: accordion sections; a non-admin sees only the skill level and Save sends the whole form | Flat sections; a non-admin sees the skill level and Save sends only the skill level | Never overwrites the organisation's answers from a cook's phone. |
| Organisation tab (members, keys, locations), My Documents | Not on the phone | Organisation admin is Wave 8; documents are the compliance staff side (Wave 8). |
| Onboarding wizard | Not on the phone | Out of scope (the kitchen profile covers its answers). |

**No location yet** (`app/first-run.tsx`, the web's `NoLocationScreen`): never empty tabs. A person with no location gets the join screen: the organisation's key first if they are in no organisation, then the location's key.
It also says what to do without a key (an admin can add them from the organisation's settings on the web), who is signed in, and keeps sign out, the legal pages and Delete my account reachable (App Store 5.1.1(v)).
The web's "create your first location" link for an admin is a sentence here: making locations is organisation admin, Wave 8.

**Server answers without a machine-readable code** (no server change in this wave; the phone reads the HTTP status and shows the server's sentence for a 400):
`PATCH /api/users/profile` (400 with `error` as a field object), `POST /api/users/change-password` (400), `POST /api/users/profile/avatar` (400; its size message says 2 MB while the limit is 10 MB), `POST /api/auth/mfa/enable` (400), `PUT /api/users/kitchen-profile` (400), and the notification read route (404).

## Tests

`check:test` runs the logic tests (`src/**`) and the screen tests (`tests/*.test.tsx`); `check:e2e` runs the real client and queue against a server
(`e2e/phoneFlow`, `e2e/wasteQueue`, `e2e/prepQueue`, `e2e/stockQueue`, `e2e/chatRecipes`; `e2e/receiving` uses the client alone, receiving has no queue; `e2e/accountNotifications`
covers details, kitchen profile, password, two-step, the inbox read queue and push settings with a just-registered person; set `E2E_NOTIFICATION_ID` to a notification made for that person to check a real row, as the suite cannot make one through the API). See `device/README.md`.
