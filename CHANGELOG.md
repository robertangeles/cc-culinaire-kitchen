# Changelog

All notable changes to CulinAIre Kitchen are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed (an authenticator code typed just before the 30-second step changed was refused)

Server only. No migration, no permission change.

- **Sign-in, changing two-step settings, linking a sign-in method and deleting an account** now accept an authenticator code in its own 30-second step and the one before it, never a future step. A code typed as the step changes, or from a phone whose clock is a little slow, is no longer refused.
- **Used codes:** we checked whether a code that has already been used is refused. It is not: `verifyMfaToken` stores nothing, so a used code can be used again within its window. That was so before this change; this change widens that window from about 30 to about 60 seconds. Refusing a used code is tracked separately.

### Added (mobile Wave 9, phone: the Bench)

Phone app only; no server change, no migration, no new permission. New dependency in the phone app: `socket.io-client`, the version the web already uses. The Bench tab is hidden in production builds by the build flag `EXPO_PUBLIC_BENCH` (`on` in the development and preview profiles of `eas.json`, `off` in production): turn it on for production only when the server has report and block (App Store 1.2).

- **Bench tab** for everyone signed in (where `EXPO_PUBLIC_BENCH` is `on`), last in the tab order: Everyone, each kitchen's own channel and direct messages, with reactions, mentions, edit, delete, pins (anyone who can reach a channel may pin and unpin in it) and search. On a tablet the list sits beside the open room.
- **Live** over the Bearer socket while the tab is in view and the app is in front; a drop or the background reconnects and reads what was missed. Messages are kept in memory only. A post made with no connection says Not sent and never sends itself later.
- Presence shows in a kitchen's own channel only, and direct messages go to people of one's kitchens or existing threads, pending the owner's decisions.

### Fixed (the Bench's live channel followed the client's room names, not the person's membership)

Server only. No migration, no permission change, no change to the Bench's HTTP routes.

- **Joining a room:** `bench:join` allows only Everyone, an organisation the person belongs to and a DM thread they are in. Any other name, including another person's `user_<id>` room, is refused with `FORBIDDEN`.
- **Presence:** an organisation or DM room lists only the people in it; only the Everyone room lists everyone online.
- **Reactions, edits and deletes** are sent to the stored message's own audience (its organisation's channel, or the two people of its DM), not to a room the socket happens to be in or a `channelKey` the client names. A person who is no longer in the audience cannot react to or edit its messages. `bench:message:edit` and `bench:message:delete` no longer take `channelKey`.
- **Leaving an organisation** (leaving, removal by an admin, Administrator removal, account deletion) ends that person's live subscription to the organisation's channel.
- **Pinned messages** no longer list a deleted message.
- Still open: opening a DM thread with any user id, who may pin or set the Everyone banner, mention counts, and the Everyone room's platform-wide presence.

### Added (mobile Wave 9, phone: Your Brain)

Phone app only; no server change, no migration, no new permission.

- **Brain tab** for `brain:read` holders, last in the tab order: what CulinAIre remembers, private or shared with the kitchen, by source, searched on the server, twenty at a time. Pinned and still-learning memories are marked.
- **Removing a memory** (for `brain:manage` holders, on rows the server says are theirs to manage) asks first and names it; it needs a connection.
- **Proactive nudges** opt-in, the web's switch.
- The first page of each tier is readable with no signal. Pinning, correcting and sharing stay on the web for now; every difference from the web page is listed in `mobile/README.md`.

### Changed (Bench socket input validation)

Server only. No migration, no permission change, no change in the web client.

- **Bench socket input validation hardening:** every Bench socket event is checked before it is handled; malformed events are dropped and the sender gets `bench:error` with code `VALIDATION`. A typing notice is accepted only for a room the sender has joined.

### Added (open swaps say the shift's status and the venue's zone and name)

Server only, additive. No migration, no permission change, no change to who sees which swaps.

- **`GET /api/workforce/swaps`:** each swap also carries `shiftStatus` (`Draft`, `Published` or `Cancelled`), and its venue's `ianaTimezone` and `locationName`, so a client can hide swaps of shifts that are not published and show venue time for a venue the person does not work at. The list itself is unchanged: swaps of draft and cancelled shifts are still in it.

### Added (mobile Wave 5, phone: the biometric app lock)

Phone app only; no server change, no migration, no permission change, nothing on the web. **The phone's development build must be rebuilt**: `expo-local-authentication` is a new native module and iOS needs its Face ID sentence (`mobile/RELEASE.md`, "Release blockers"). No build was run.

- **The app locks** for anyone who holds `purchasing:approve` or a roster or compliance permission beyond their own records, and for Administrators: at a cold start, at a sign-in, and after more than 60 seconds in the background. Unlock is Face ID, Touch ID or Android biometrics, with the device passcode as the fallback. Nothing of the app shows behind the lock or in the app switcher. A cancelled or failed prompt leaves it locked and signed in. It cannot be switched off; nobody else sees a lock.
- **A device with no passcode and no biometrics** is asked to set one up or sign out, for those people only.
- **Approve, Reject and Raise credit note** ask again when the last unlock is more than two minutes old; a prompt that does not go through sends nothing.
- The lock was the last condition before roster and compliance data may be kept on the phone (the cache itself is not built).

### Added (mobile Wave 7, phone: the menu)

Phone app only; no server change, no migration, no new permission. Uses the Wave 7 menu server (organisation-owned menu items, `menu:manage`, keyed sales) and the shared costing.

- **Menu tab** for `menu:read` holders, last in the tab order: the organisation's menu with search, category and class filters; an item's page with its set-up, allergens and recipe lines; food cost, percentage and margin as the server stored them, for `inventory:cost` holders only.
- **Adding and changing items** (from scratch or from a saved recipe), recipe lines linked to the catalogue with a live cost preview, deleting, and category food cost targets, for `menu:manage` holders. Saving needs a connection; Save again after a lost reply adds nothing twice.
- **Recording a sale** of a dish or a front-of-house item with its own key, so a sale whose answer was lost can be sent again and is recorded once; recent sales, and voiding one.
- Every difference from the web Menu & Costing page is listed in `mobile/README.md`.

### Fixed (reorder wrote the shortfall in the wrong unit)

Server, web and phone. No migration, no permission change.

- **Reorder** (`POST /api/inventory/purchase-orders/:id/clone`) worked out par less stock in the item's kitchen unit but wrote it as the quantity of a line ordered in another unit: 62.5 kg short of a 12.5 kg bag became 62.5 bags. Each line is now converted to its own unit and rounded up to whole units. A line whose unit cannot be converted keeps its last quantity and the reply names it in `quantityWarnings`; the web alert and the phone notice tell the person to check it. A bad purchase order id or an inactive supplier answers 400 with a code, not a 500; a missing source order's 400 now carries one too.
- **Order guides** offer an item with a package but no pack size in its kitchen unit, not as packages.

### Changed (menu costs, margins and on-hand stock are for `inventory:cost` holders)

Server and web. No migration, no new permission. **Before deploying:** a custom role that should keep seeing menu costs needs `inventory:cost`; the seeded roles with menu access have it. A person's access follows their token, so a role change takes effect when it refreshes.

- **Server:** for anyone without `inventory:cost`, the menu routes leave out food cost, food cost %, contribution margin, line and unit costs, the dashboard averages, the P&L cost, the yield variance in dollars, the waste in dollars per dish (`GET /api/menu/waste-impact`) and what a sale left on hand. The fields are absent, not null, so older apps keep parsing. `GET /api/prep/menu` leaves out the dish's food cost % the same way. Price, recipe, quantities sold, menu mix and class stay for everyone with `menu:read`. AI recommendations and the replacement request are made without the hidden figures.
- **Changing a recipe without seeing its costs:** a line sent without a cost by such a person keeps the cost the dish already has for that ingredient (`addIngredient`, `keepHiddenCost`), so changing a quantity no longer depends on the client sending the cost back.
- **Web:** Menu & Costing shows such a person prices, sales, popularity and class; the cost columns, cost cards, engineering matrix, category actuals, cost fields in the form, the waste column and badge, and on-hand figures are gone, with a short note in their place. Saving an item leaves untouched lines alone.

### Added (mobile Wave 5, phone: orders, approvals and credit notes)

Phone app and shared schemas only; no server change, no migration, no permission change, no new dependency (the development build does not need a rebuild). Uses the Wave 5 purchasing server and the draft edit and replay-safe create routes.

- **Orders tab** for holders of `purchasing:draft`, `purchasing:submit`, `purchasing:approve` or `purchasing:credit` (after Receive; under More for most people): the location's orders with a status filter, one order with its items, submit, email, cancel, reorder, and a new order written by hand or from an order guide, kept on the phone until it is saved. A saved draft can be changed.
- **Approvals:** the queue, longest wait first (over a day and over two days stand out), approve and reject on the order itself. An approver is not offered Approve on an order they raised or changed while someone else can approve it.
- **Credit notes** raised from a delivery's discrepancy, one each, for no more than it is worth.
- **Links:** order to delivery, delivery to order, received order to what can be claimed, and approval, answer and discrepancy notifications to their order.
- **Offline:** lists open with no signal and say from when; every write needs a connection and says so. A repeated save, approval or credit note never acts twice.
- Figures the server leaves out are never shown as zero. Every difference from the web Purchasing page, with the web bugs found, is listed in `mobile/README.md`.

### Changed (phone: a quieter tab bar, a real home, one header on every tab)

Phone app only; no server change, no permission change.

- **Home:** the signed-in app opened on Ask, a tab under More, for anyone who has Prep (every module's list is `index`, so "/" opened the route group that sorts first). It now opens on the first button of the person's own bar: Prep for a cook who preps, Waste for one who only logs waste, Ask for someone with no module (`homeHref` in `mobile/src/shell/tabs.ts`, a one-time redirect in `app/(app)/_layout.tsx` before the tabs exist, so Ask is not left in the Back history).
- **Tab bar:** labels 12 pt Inter (were 16 pt), one line, growing with the phone's text size only to 1.3x; 22 dp icons with a finer stroke; the open tab is the only one in copper, on a sunk-paper pill; the bar is 64 dp above the system navigation bar (was 68). Order, More and every permission rule are unchanged.
- **One header and one set of text styles:** every tab opens with `ScreenHeader` (the location in copper capitals over the title; Ask and Recipes keep "Kitchen AI" and "Recipe book"). The copper capitals label and the Fraunces 20 card heading are `Text` variants (`label`, `heading`) instead of styles copied into each screen. More's icons are grey, as the first app's lists.
- **Screenshot walk:** also photographs the first screen after sign-in, Ask, a new conversation, My Recipes, the Recipe Lab and Receive.

### Added (mobile Wave 4, phone: inbox, push, profile and account)

No server change, no migration. Uses the Wave 4 push server (migration `0004_push_dispatch`) for push registration and settings, and the error codes on the profile and account routes; the inbox and profile screens use routes that already exist. **The phone's development build must be rebuilt**: `expo-notifications` and `expo-image-picker` are new native modules (`mobile/device/README.md`).

- **Inbox tab** for every signed-in person, with the unread count on its button (or on More, and the Inbox row of the More list, when the Inbox is under More): every notification type has its own heading and sentence, Mark read works with no signal (queued command `notification.read`), Open goes where the phone has the screen (an overdue delivery: Receive). Kept on the phone for a start with no signal.
- **Push on the phone.** Off until the person taps Turn on (never asked at launch); the token is registered with the sign-in it belongs to, registered again at each start and return to the foreground, removed when turned off and before sign-out. A tapped push opens its screen or the inbox. **Notification settings**: a switch per kind and quiet hours, through the server's push-preference routes. Real pushes need the owner's Expo project id, FCM and APNs credentials (checklist in `mobile/README.md`); until then the screen says the build cannot receive pushes.
- **Profile and account.** The Account tab is a hub: My details (picture from the library or camera, name, bio, address, social links; an emptied field is cleared), Kitchen profile (skill level for everyone; the kitchen, restaurant and menu answers for organisation admins, as on the web), Password (this phone stays signed in), Two-step verification set-up (key, "Open in authenticator app", QR) and removal. Delete my account and Add Sign in with Apple stay where they were.
- **No location yet.** The join screen also says what to do without a key, shows who is signed in, and keeps the legal pages and Delete my account reachable.
- Every difference from the web bell and profile pages is listed in `mobile/README.md`.

### Changed (error codes on the profile and account routes, before the phone shows them)

No migration, no new route, nothing to seed or backfill. Every refusal below keeps the status and the `error` the web shows today and adds `code` (shared `ApiErrorBody`), so older installed apps and the web keep working. Two behaviour changes, both on the profile photo upload: a failure at the photo store no longer answers 500, and the "file too large" sentence now states the real limit (10 MB; it said 2 MB).

- **New error codes:** `INVALID_CREDENTIALS`, `WEAK_PASSWORD`, `PASSWORD_NOT_SET`, `RECENT_SIGN_IN_REQUIRED`, `MFA_REQUIRED`, `INVALID_MFA_CODE`, `INVALID_MFA_SESSION`, `MFA_ALREADY_ENABLED`, `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `UPLOAD_FAILED`. The MFA ones were already sent by `/mfa/setup`, `/mfa/disable` and `/apple/link`; they are now in the shared list too.
- **`PATCH /api/users/profile`:** a bad field is `400 VALIDATION` (`error` is still the field-error object the web reads).
- **`POST /api/users/change-password`:** a new password under 8 characters is `400 WEAK_PASSWORD`, any other bad body `400 VALIDATION`; a wrong current password is `400 INVALID_CREDENTIALS`, an account with no password (Google sign-in only) `400 PASSWORD_NOT_SET`, a deleted account `400 NOT_FOUND`. The per-address limit answers `429 RATE_LIMITED`.
- **`POST /api/users/profile/avatar`:** a file over the limit is `400 FILE_TOO_LARGE` ("File too large. Maximum size is 10 MB.", built from the limit the upload enforces; the web's fallback text says 10 MB too), a file that is not an image `400 UNSUPPORTED_FILE_TYPE`, a missing file or a malformed upload `400 VALIDATION`. A photo the photo store says is not a valid image is `400 UNSUPPORTED_FILE_TYPE` ("That file could not be read as an image."); any other photo-store failure (another refusal, a time-out) is `502 UPLOAD_FAILED` ("The photo could not be uploaded. Try again.") and can be retried. The store's own error is logged and never sent.
- **`POST /api/auth/mfa/setup`, `/enable`, `/disable`, `/verify`:** no session is `401 UNAUTHENTICATED`, a missing code `400 VALIDATION`, a wrong code `400 INVALID_MFA_CODE`, an expired sign-in step `401 INVALID_MFA_SESSION`. The per-account and per-address MFA limits answer `429 RATE_LIMITED`.
- **`GET`/`PUT /api/users/kitchen-profile`:** `401 UNAUTHENTICATED`, `400 VALIDATION` (the field errors stay under `details`).
- **`PATCH /api/inventory/notifications/:id/read`** and **`/dismiss`:** a notification that is missing or not the caller's is `404 NOT_FOUND`.
- **Not in this change:** there is no "same as the current password" refusal on change-password today (web or server), so no code for it; adding one would be a behaviour change.

### Added (mobile Wave 6, phone: Ask Antoine and recipes)

No server change, no schema change and no migration. The phone gets two tabs shown to everyone signed in (the server asks for no permission on chat, conversations or recipes): **Ask** (the kitchen chat with a streamed answer, Stop, Try again, saved conversations and the "grounded in your Brain" label) and **Recipes** (My Recipes, the culinary Recipe Lab, a recipe's page with refine and the public switch). No pricing, purchase or upgrade links. How it works and every difference from the web: `mobile/README.md` ("Ask Antoine", "Recipes").

- **Shared schemas.** `packages/shared/src/schemas/conversation.ts` and `recipe.ts`: what the conversation and recipe routes send, parsed leniently on the phone.
- **Not on the phone yet:** guest chat, image mode, web search, the Patisserie and Cocktail labs, versions, share, email, ratings, archive and image regeneration.

### Changed (mobile: the tab bar)

- **Tab order and More.** The phone's tabs now follow a cook's shift: Prep, Waste, Usage, Count, Move, Receive, Ask, Recipes, then Account. The bar holds at most five buttons; a person with more modules gets the first four and **More**, which lists the rest and Account and stays highlighted while one of them is open. The bar now sits above the system navigation bar with its labels unclipped. The Count tab is titled "Count", shows its empty state in a card and keeps the centred tablet column. The system Back key retraces tabs (from a screen under More to the More list, then to the tab before it) instead of jumping to the first tab. More, Account, delete account, add Sign in with Apple, the location choice and Terms and Privacy start at the top of the page like the module tabs; only the signed-out screens stay centred. On iOS, VoiceOver reads a tab's place among the buttons that show ("More, tab, 5 of 5"). No server change.
- **Screenshot walk.** `mobile/device/screens.sh` photographs every phone screen on the moto g86 at phone and iPad widths and writes a gallery to look through; the look checklist is in `mobile/README.md` (see `mobile/device/README.md`, "The screenshot walk").

### Added (mobile Wave 5, server: edit a draft order, and a create that is safe to repeat)

No migration, nothing to seed or backfill. The web is unchanged and older phone and web versions keep working: `poId` is optional and the new route is additive. The request and answer schemas are in `@culinaire/shared/schemas/purchaseOrder`.

- **`PUT /api/inventory/purchase-orders/:id`** (`inventory:manage`, as create) replaces the header and lines of a DRAFT with the body create takes, and answers the order as create does (200). Any other status is `409 INVALID_STATE`; an unknown order or another organisation's `404 NOT_FOUND`; the caller must be able to use the order's location and the one it moves to (`403 LOCATION_NOT_ALLOWED`); an order moved by someone else in the meantime is `409 CONFLICT`. The lines get new ids, the total of an earlier submission is cleared (submit works it out again), and an `audit_log` row keeps the order before and after.
- **`POST /api/inventory/purchase-orders`** takes an optional client-made `poId`. The same body again answers the first order as it is now (200, not 201), even after it was edited or sent; another body, or an id used by someone else, is `409 CONFLICT`. The header and lines are now written together. A refused body carries `VALIDATION` (the sentences are unchanged); a delivery date that is not a date, a blank price and an endless quantity are 400 (the first two were 500).
- **Approvals.** Whoever edited an order may not approve it while someone who neither created nor edited it can (`403 SELF_APPROVAL_NOT_ALLOWED`, `canApprove: false`); otherwise it is allowed and recorded as a self-approval. The rule for the creator, and for an order nobody edited, is unchanged.
- **Submit** locks the order while it works out the total, so an edit at the same moment cannot send a larger order under the spend threshold.
- The 403 of a missing permission carries `FORBIDDEN`, on every route.

### Changed (mobile Wave 5, server: orders, approvals and credit notes)

**Apply migration `0008_credit_note_one_per_discrepancy` by hand on production BEFORE this version deploys** (`pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts`; run it with `--dry-run` first). It adds a unique index on `credit_note.discrepancy_id` and drops the plain one it replaces; it deletes nothing, and stops without changing anything if a discrepancy already has two notes. The previous server keeps working after it. No permission is added: nothing to seed or backfill.

- **Approvals.** The person who created a purchase order cannot approve it (`403 SELF_APPROVAL_NOT_ALLOWED`) unless nobody else active in the organisation can approve (only someone whose earliest organisation is this one counts, as that is the only one they act in); then it is allowed and recorded as a self-approval. Approve and reject lock the order, so two approvers racing cannot both act; an order that is no longer waiting answers `409 INVALID_STATE` (was 400). Every approve and reject writes an `audit_log` row naming who and when (reject keeps the reason). List and detail carry `canApprove` on each waiting order for a `purchasing:approve` holder.
- **Spend thresholds.** Changing them needs an organisation admin as well as `purchasing:approve` (`403 FORBIDDEN`), the amount is at most 1,000,000 (`400 VALIDATION`), a location must be the organisation's own (`404 NOT_FOUND`), and every change is audited with the old and new amount.
- **Supplier email and PDF.** `POST /purchase-orders/:id/send-email` emails once: a repeat inside 5 minutes answers `409 ALREADY_EMAILED` and sends nothing; a failed send answers `502 EMAIL_FAILED` and can be tried again at once. The PDF render (download and email) has its own limit, 20 per 10 minutes per user (`429 RATE_LIMITED`); a slow render answers `503 PDF_TIMEOUT`.
- **Credit notes.** `POST /credit-notes` takes an optional client-made `creditNoteId` (a repeat answers the first note, 200); the supplier is the discrepancy's own, so `supplierId` is no longer read (a body that still sends it is ignored). The amount is kept to the cent and must be at least 0.01. It refuses a second note for a discrepancy (`409 ALREADY_CREDITED`), more than the discrepancy is worth (`400 CREDIT_EXCEEDS_DISCREPANCY`; a short delivery is worth the missing quantity at the higher of the order price and the price recorded at the door, a rejection or substitution the whole line, a price rise the extra per unit times what arrived), a line with no price (`400 DISCREPANCY_VALUE_UNKNOWN`) and a delivery still being received (`409 INVALID_STATE`). New `GET /credit-notes/unresolved-discrepancies` (`purchasing:credit`, optional `supplierId`) lists open discrepancies of confirmed deliveries, newest first, with `maxCreditAmount` (`null` when the line has no price, so it cannot be credited yet). It is paged: `limit` (1 to 100, default 50) and `offset` (0 or more); a bad value answers `400 VALIDATION`. A price drop is worth nothing and is left out. Both lists and `POST /credit-notes` reach the whole organisation, as `GET /credit-notes` did before. Receiving still keeps one discrepancy per line, so a line flagged both short and re-priced is credited as whichever was flagged last (a price rise is capped at the extra per unit times what arrived); whether to model both is an open owner decision.
- **Removed** the legacy `POST /purchase-orders/:id/lines/:lineId/receive`: it could never succeed on current statuses and nothing called it (receiving sessions replaced it).
- **Web.** The Approvals tab follows `purchasing:approve` instead of the organisation-admin role; Settings needs both. An approver's own waiting order shows "Another approver must approve your order" instead of Approve, a resend inside the email window is hidden, and the PDF download shows the server's message.

### Changed (mobile Wave 7, server: menu items belong to the organisation; sales are keyed and zoned)

**Before this version deploys, on production:** apply migration `0006_menu_item_organisation` by hand (`pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts`; `--dry-run` first), then run `pnpm --filter @culinaire/server exec tsx src/scripts/backfillMenuManagePermission.ts`. **Once after it deploys:** `pnpm --filter @culinaire/server exec tsx src/scripts/backfillMenuItemOrganisation.ts`. Prefix `APP_ENV=prod` for production. The previous server keeps working after the migration (two nullable columns it never reads). Why each step and in which order: the header comments of those three files.

- **Menu items belong to the organisation.** Every member reads them; the creator or an admin of that organisation changes them (`403 FORBIDDEN` otherwise). Another organisation's item is `404 NOT_FOUND`. An item with recorded sales or prep history cannot be deleted (`409 CONFLICT`). The rules live in `packages/server/src/services/menuAccess.ts`. Category targets are still per user. Prep's dish lists and selection check use the same read rule, so a person who left an organisation no longer sees its dishes there.
- **New permission `menu:manage`.** `menu:read` still opens Menu & Costing and records a sale. Creating, changing and deleting items and recipe lines, refreshing a cost, recalculating, category targets, voiding a sale, AI recommendations and `POST /api/menu/import-sales` now need `menu:manage` too. Seeded for every role that had `menu:read`; the backfill gives it to existing roles.
- **`canManage`** on each item of `GET /api/menu/items` and `GET /api/menu/analysis`, and on each sale of `GET /api/menu/locations/:locId/sales`. The web hides edit, delete and void when it is `false`, and now shows the server's sentence for a refused change.
- **`GET /api/menu/analysis` writes nothing.** Stored costs, mix and classification are refreshed by `POST /api/menu/analysis/recalculate` and after each sale or void.
- **Sales.** Any member with `menu:read` can sell any item of the organisation, at a location they may use: the request's `locationId`, else their selected location, else the item's when they may use it (`400` when none applies). The idempotency key (`Idempotency-Key` header or body `idempotencyKey`) is claimed by the insert; the same key with a different sale answers `409` with the new shared code `IDEMPOTENCY_KEY_REUSED`. Quantities take at most 3 decimal places. A FOH consumable's stock leaves the FOH shelf, everything else the back of house; the zone is kept in the new `consumption_log.zone` so a void puts it back. A sale is voided by its recorder or an organisation admin.
- **Sales CSV.** The preview reports a bad quantity, an unparseable date and a name that matches more than one item as unmatched rows; the commit answers `400 VALIDATION` for malformed `lines`.
- Refusals on these routes carry a `code` (`VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `INVALID_STATE` for a sale already voided). The phone has no menu or sale screen yet.

### Added (mobile Wave 3, phone: store room, first slice)

No server change, migration or seed. Built on the Wave 3 server routes above; details and every difference from the web in `mobile/README.md` (Transfers, Stock).

- **Transfers tab** (`inventory:count`): the transfers to and from the location (to receive, sent from here, received here), a transfer's lines, receive line by line with "Short by" or "Over by", and for `inventory:manage` a new transfer (send now, or save and send later), send and cancel. Every write goes through the offline queue with a phone-made `transferId`; a refused or conflicting transfer stays on screen with the server's words, and a receive someone else made first is kept visible, not counted as done.
- **Stock tab** (`inventory:count`): the server's critical and low lists for the location with a drill-down to each item, the stock value for `inventory:cost` holders only, the stock take in progress and the last count, kept on the phone with the time of the download; item lookup over the catalogue with an item's stock here, where it is kept and (managers) its stock at every location; ask for a new catalogue item (queued, phone-made `requestId`) and My requests with HQ's outcome (`GET /catalog-requests/mine`).
- **Blind counts**: a quantity or value the server leaves out is a dash, never 0, and never blocks an action.
- New shared schemas `@culinaire/shared/schemas/transfer` and `@culinaire/shared/schemas/storeRoom` (the latter re-exports the catalogue's `CATEGORIES` and `ITEM_TYPES`).
- Stock is per location and zone, not per storage area: an item's page shows where it is kept, never a quantity per area.

### Changed (mobile Wave 3, server: store room, bar and HQ review)

**Before this version deploys, on production, in this order:** apply migration `0007_foh_restocks` (`APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts --dry-run`, then the same without `--dry-run`), then run `APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/backfillInventoryCostPermission.ts`. The migration only adds a table the previous server never touches; the backfill must run at least one hour before the deploy, or every counter loses stock value and expected quantities at the deploy. The hour matters because a signed-in user's permissions travel in their access token, which lasts up to an hour: someone signed in before the backfill keeps a token without `inventory:cost` until it refreshes, and sees dashes for value, costs, book quantity and expected quantities in the meantime (nothing is written wrongly). If the deploy cannot wait an hour, those users must sign in again.

- **Retried writes do not double up.** Transfer create (`transferId`), front-of-house restock (`fohRestockId`), front-of-house waste (`consumptionLogId`), each sale line (`fohSaleId`) and catalogue requests (`requestId`) take a client-made id: a repeat answers 200 with what was stored and moves no stock; an id held by someone else is 409 `CONFLICT`. Without the ids everything behaves as before. Restocks are now rows in `foh_restocks` (who moved what, when).
- **Front-of-house count.** An optional `countedAt` (when the count was taken): if the shelf changed after it (a sale, restock or waste), 409 `FOH_COUNT_STALE` and nothing is overwritten; a resend of a count already applied answers success with `replay: true`. A `countedAt` ahead of the server's clock is stored as sent (so its resend is still recognised) and compared as now; `null` counts as absent. The web sends no `countedAt` and counts as before.
- **Transfers.** Receive refuses a line that is not on the transfer and a quantity below 0 or not a number (400 `VALIDATION`, nothing received). Adding an item already on the transfer is 409 `CONFLICT` (was 500). Every refusal carries a code; a location or ingredient outside the organisation is 404 `NOT_FOUND` (was 400).
- **Stock reads take the store-room row.** The location item list, the dashboard, the organisation summary, the per-ingredient stock levels and a count's expected quantity read `zone = 'BOH'`, so a front-of-house item is listed once and its expected quantity is the store room's. The same holds for order guide items, receiving session lines, the stock a cloned purchase order tops up from, the on-hand figure of a prep list, and the row a received purchase order line adds to (each could list the item twice or take the shelf's figure).
- **Dashboard figures from the server.** `GET /locations/:locId/dashboard` adds `stockSummary { lowCount, criticalCount, lowIngredientIds, criticalIngredientIds, stockValue?, valueByCategory? }`. Low and critical are the store-room quantity against par (25% / 75%, as before); value is store room plus shelf at the location's unit cost, else the catalogue's. The web dashboard now shows these instead of working them out itself. **One rule for both this summary and the HQ table (`GET /dashboard/org-summary`), so the two agree for a location:** value counts every stock row there, whether or not the item is active at the location or has a location row (stock on hand is money), and a negative quantity is worth nothing; low and critical count only items active at the location that have a par, by the store-room quantity. Before, the HQ table also counted deactivated items as low or critical and subtracted negative stock from the value. Quantities on transfers (sent and received) and on front-of-house restock, count and waste have no upper limit, as before this version; they must be finite.
- **New permission `inventory:cost`** (see stock value, unit costs and expected quantities). Without it, count lines (save, category lines, session detail, previous lines) carry no `expectedQty`, `varianceQty`, `variancePct` or `unitCost`, and the dashboard and organisation summary carry no value. Seeded for all four default roles; the backfill gives it to every role holding any inventory key, so nothing changes until an owner removes it from a role (blind counting). The web shows "—" where a value is absent. Without it the location item list (`GET /locations/:locId/ingredients`) also carries no `currentQty`, `locationUnitCost` or `orgUnitCost`, the catalogue list (`GET /ingredients`) no `unitCost` or `preferredUnitCost`, an item's supplier list (`GET /ingredients/:id/suppliers`) no `packCost` or `costPerUnit`, and an item's stock by location (`GET /ingredients/:id/stock-levels`) no `currentQty` or `unitCost`: the fields are left out, not zeroed. `stockSummary.lowIngredientIds` and `criticalIngredientIds` stay for everyone, because staff need to know what is running low. Order guides and receiving keep showing on-hand and prices to holders of `purchasing:draft` and `purchasing:receive`: for a truly blind counter, remove those two keys from the role as well. A purchase order (`GET /purchase-orders`, `GET /purchase-orders/:id`) carries no `totalValue`, line `unitCost` or `actualUnitCost` for a caller with neither `inventory:cost` nor any `purchasing:` key. Where the quantity is hidden the web does not read it as zero: usage, transfers and purchase order lines can still be entered (the server does not refuse a quantity above the book figure, on the web or the phone; stock goes negative until the next count), and an ingredient saved without touching its price keeps the stored one. Web screens made to treat an absent quantity as unknown (a dash, no low or critical status, no stock check): the dashboard alert lists and the HQ drill-down (which now lists low and critical from the server's `stockSummary`), the catalogue's status filter and category markers, the catalogue item's stock across locations (a dash, not "Not counted yet"), the purchase order list's line detail, the purchase order form, usage, transfers (form and list), stock moves and the bulk par editor. Checked and already safe or reading fields that are not hidden: the catalogue item table, stock-take review, forecast cards, the receiving checklist and the menu costing forms.
- **Opening inventory.** Finishing it needs `inventory:manage` (403 `FORBIDDEN` otherwise); the web shows a counter "A manager finishes the opening inventory" instead of the button. Submitting a category no longer moves an opening count to review (it did after the first one, which blocked the rest); one already stranded in review can be finished.
- **Recount round.** After HQ flags a category and it is counted and submitted again, the session goes back to review by itself (it stayed FLAGGED, and the web had no button for it).
- **`GET /stock-takes/:id/count-sheets`** serves a category count too (one sheet per category; was 400). Installed phones never ask for it on a category count.
- **`fohParLevel`** on `PATCH /locations/:locId/ingredients/:id` is stored (it was accepted and dropped).
- **New `GET /catalog-requests/mine`** (anyone who may make a request, `inventory:count`): the caller's own catalogue requests in their organisation, in any status, newest first, `{ data, total }`, paged with `limit` (1 to 100, default 50) and `offset`; a bad page is 400 `VALIDATION`. Each row carries `status`, HQ's `reviewNotes` (the reason for a rejection) and `createdIngredientId` (the item an approval made); who reviewed it is left out. Shared schema `CatalogRequestListSchema` (`@culinaire/shared/schemas/catalogRequest`).

| Route | New |
|---|---|
| `POST /api/inventory/transfers` | body `transferId` (uuid); 200 on a repeat; 409 `CONFLICT`; 404 `NOT_FOUND` for a location or item outside the organisation |
| `POST /api/inventory/transfers/:id/receive` | 400 `VALIDATION` for a foreign line or bad quantity |
| `POST /api/inventory/transfers/:id/lines` | 409 `CONFLICT` for an item already on it |
| `POST /api/inventory/locations/:locId/foh/restock` | body `fohRestockId`; 201, 200 on a repeat; answer carries `fohRestockId` |
| `POST /api/inventory/locations/:locId/foh/count` | body `countedAt`; 409 `FOH_COUNT_STALE`; answer carries `replay` |
| `POST /api/inventory/locations/:locId/foh/waste` | body `consumptionLogId`; 200 on a repeat |
| `POST /api/inventory/locations/:locId/sales` | line `fohSaleId`; 200 when every line was a repeat; each `recorded` line carries `replay`, each `rejected` line a `code` |
| `POST /api/inventory/catalog-requests` | body `requestId`; `storeLocationId` required (400, was a 500); 200 on a repeat |
| `GET /api/inventory/catalog-requests/mine` | new: the caller's own requests with the review outcome, `{ data, total }`, `limit`/`offset` |
| `GET /api/inventory/ingredients/:id/stock-levels` | no `currentQty` or `unitCost` without `inventory:cost` |
| `GET /api/inventory/locations/:locId/dashboard` | `stockSummary` |

### Changed (server hardening for chat, recipes and the model-backed screens, before the phone shows them)

No migration, nothing to seed or backfill. Every answer below keeps `error` as the sentence the web shows and adds `code` (shared `ApiErrorBody`), so older installed apps keep working.

- **New error codes:** `FREE_SESSIONS_EXHAUSTED`, `GUEST_QUOTA_EXHAUSTED` (403), `AI_UNAVAILABLE` (503), `AI_TIMEOUT` (504), `EMAIL_FAILED` (502). The 401s from `authenticate` and `authenticateOrGuest` now carry `UNAUTHENTICATED`, and the error answers of the chat, conversation and recipe routes carry `VALIDATION`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_STATE` or `RATE_LIMITED`. Validation 400s on chat and conversations now send `error` as a sentence and the field errors under `details` (before, `error` was the field-error object).
- **Time limits.** Chat stops after 3 minutes, recipe generation after 150 s, refine after 90 s, an image after 60 s, a menu recommendation or waste reuse answer after 45 s: `504 AI_TIMEOUT` (chat already streaming gets a stream error part instead). A model failure on these routes is `503 AI_UNAVAILABLE` and never repeats the provider's message. A client that hangs up stops the model call, and a recipe or image still in the making is not saved.
- **Rate limits per person** (user, else guest token, else address), `429 RATE_LIMITED`: 10 recipe generations, 20 refinements and 10 image regenerations per 10 minutes. Recipe emails: 10 an hour per sender, 10 an hour for all guests behind one address together, and 3 an hour to any one inbox (`+tag` and Gmail dot variants count as the same inbox).
- **Sessions are charged only for what was delivered.** Chat charges once answer text reached the client (also if the client then hangs up); recipe generation charges only when a recipe was made. A refusal, failure, time-out or prose fallback costs nothing. Both counters are now single atomic updates.
- **`GET /api/recipes/:id`** leaves `userId` and `kitchenContext` out unless the caller owns the recipe.
- **`PATCH /api/recipes/:id`** answers `403 FORBIDDEN` to guests; a guest-created recipe can no longer be changed by anyone. The web Recipe Lab no longer shows guests the public/private toggle.
- **`GET /api/recipes/my`** honours `?domain=recipe|patisserie|spirits` (`400 VALIDATION` for anything else).
- **`POST /api/recipes/:id/email`** escapes all recipe text in the HTML body, and a send failure is `502 EMAIL_FAILED` with a fixed sentence (was 500 with the mail provider's message).
- **Conversations.** A repeated `POST /api/conversations` with the same id by the same owner answers 200 (201 the first time); an id held by someone else is `409 CONFLICT`. A repeated save of messages skips the ids already stored. Neither answers 500 any more.
- **`GET /api/menu/items/:id/recommendations`** answers `503`/`504` when the model fails instead of 200 with stand-in text (`404 NOT_FOUND` for an unknown item); **`POST /api/waste/reuse`** answers the same codes. Both now call the model through `aiService`. The web menu panel, the recipe card and the recipe editor show the error.
- **Shared schemas.** `ChatRequestSchema` is `{ messages, webSearch? }` and `ChatResponseSchema` is `{ text, brainGrounded? }`, matching what `POST /api/chat` really takes and streams (contract in `CLAUDE.md`, API section).

### Added (mobile Wave 1: receiving deliveries)

No schema change and no migration. The phone gets a **Receive** tab (for `purchasing:receive`): the deliveries queue and a checklist that starts as "received in full" with Short, Wrong price and Reject per line, a pinned Confirm, and Cancel receiving. Screens sit in a centred column (the app's one column width), so they hold up on an iPad. Receiving is online-only. A short delivery closes the order as partial; the balance needs a new purchase order (owner decision, Wave 1).

- **Purchase order list and detail.** `GET /purchase-orders` takes `status` as one value or a comma list, a validated `limit` (1 to 100; a bad value answers 400, not 500), `offset`, and `sort=expected`. Rows and detail carry `supplierPhone` and `beingReceivedBy`; detail also carries `totalValue`, `rejectedReason` and `sentAt`. The web's plain call is unchanged.
- **Permission.** A user holding only `purchasing:receive` can list and open purchase orders, but only SENT and RECEIVING ones (a draft answers 404), and only at the locations they can use (another location's order answers 403 `LOCATION_NOT_ALLOWED`).
- **Create and clone.** The location, supplier and every ingredient must belong to the caller's organisation (400 "not found").
- **Spend threshold.** With a threshold set, a purchase order with any line that has no price goes to HQ approval instead of slipping under it.
- **Receiving.** SHORT needs a quantity below the order (`SHORT_QTY_REQUIRED`, `SHORT_QTY_NOT_LESS`); a price change needs the price (`PRICE_REQUIRED`). Confirm with a unit that has no path to the base unit answers 400 `UNIT_NOT_CONVERTIBLE` naming the item, writes nothing, and leaves the session open (reject the line to go on). Start answers `resumed` and `startedBy`, and refuses a location that is not the order's own (403 `LOCATION_NOT_ALLOWED`); Cancel on a delivery already confirmed answers 409 `ALREADY_CONFIRMED`; the audit rows, `receivedByUserId` on the order line and the WAC trigger name whoever acted, not whoever started the session.

### Added (mobile Wave 4, server: push notifications)

**Apply migration `0004_push_dispatch` by hand on production BEFORE this version deploys** (`pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts`; run it with `--dry-run` first). It creates `push_opt_outs`, `push_quiet_hours` and `push_receipts` and adds the nullable column `device_token.refresh_family_id`; the previous server reads none of them and keeps working after the migration.

- **The server can send a push.** After an in-app notification is saved, the same notification goes to the person's registered devices through Expo's push service. The in-app inbox stays the record: a push that is skipped or fails loses nothing. No phone build registers a token yet, so nothing is delivered until the phone side ships (see `tasks/todo.md`).
- **Off until the owner turns it on.** Settings → Integrations → Push Notifications: `EXPO_PUSH_ENABLED` must read `true`; `EXPO_ACCESS_TOKEN` is needed only if enhanced push security is on in the Expo project. The Apple (APNs) and Google (FCM) keys live in the Expo project, not here.
- **What pushes today:** roster published, a Published shift cancelled, document verified, document rejected. The person who made the change is not notified. Shift assigned, and a Draft shift's time change or cancellation, save the in-app notice only: a draft never reaches a lock screen. The other notification types are still inbox only (list in `tasks/todo.md`).
- **Generic lock-screen text.** The title and body are fixed per type (`services/pushCopy.ts`): no staff name, document type or date. The push `data` is `{ notificationId, type, link }`, where `link` is an in-app route from `pushLink` (`@culinaire/shared/schemas/push`), defined for every notification type.
- **Per-type opt-out and quiet hours.** `GET /api/notifications/push-preferences` answers `{ types: [{ type, label, enabled }], quietHours: { start, end, timeZone } | null }`. `PUT` takes `{ disabledTypes?, quietHours? }`: `disabledTypes` replaces the list, `quietHours: null` clears the window, a key left out changes nothing; times are 24-hour `HH:MM` in the given IANA time zone. A push inside quiet hours is dropped, not held. Neither setting touches the inbox. Both routes are the caller's own data (`authenticate` only, no new permission).
- **Device tokens.** `POST /api/notifications/unregister-device` `{ deviceToken }` removes the caller's own token; a repeat is safe. `POST /api/notifications/register-device` now ties the token to the sign-in whose refresh token the request presents (cookie, or `refreshToken` in the body), and the server removes it when that sign-in ends: logout, password change, expiry or a revoke. A token registered with no refresh token is removed once the person has no sign-in left. A token Expo reports as dead is removed, at the send or by a receipt job that runs every 15 minutes. Only Expo push tokens are sent to; a raw APNs or FCM token is skipped.
- **Web.** The notification bell names the six new types (new shift, shift changed, shift cancelled, roster published, document verified, document rejected). `POST /api/auth/logout` answers as before.
- Deleting an account also deletes the person's push settings.

### Changed (mobile Wave 4, server: roster on the venue's clock)

**Apply migration `0005_staff_availability_unique` by hand on production BEFORE this version deploys** (`pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts`; run it with `--dry-run` first). It deletes exact duplicate availability windows (keeping the earliest) and then allows one row per window; the migration file holds a read-only query that counts what would be removed. The previous server keeps working afterwards.

- **A date-only roster range is a day on the venue's clock, not UTC's.** `from`/`to` given as `YYYY-MM-DD` on `GET /api/roster/shifts`, `/shifts/calendar`, `/shifts/mine` and on publish are read in the venue's IANA zone, so a 6 am Monday shift in Melbourne (Sunday 20:00 UTC) is on Monday. A full timestamp is still read as an instant. An impossible date (`2026-02-30`) answers `400` with `code: "VALIDATION"`.
- **`GET /api/roster/shifts/mine`** takes optional `excludeDrafts=true` (leaves out Draft shifts, except one waiting on the caller's public-holiday consent), `from`, `to` and `limit` (1 to 500), and each row now carries `locationName`, `ianaTimezone`, `state` and `isPublicHoliday`. With no parameters it answers as before, Drafts included, which is what the web sends.
- **Roster 409s carry a `code`** (shared `ApiErrorBody`): assigning answers `SHIFT_NOT_DRAFT`, `ASSIGNMENT_BLOCKED_COMPLIANCE` or `SHIFT_ALREADY_ASSIGNED`; claiming a swap answers `SWAP_CLAIMED_BY_YOU`, `SWAP_CLAIMED_BY_OTHER` or `SWAP_CANCELLED`. A replayed claim used to answer `404`; it is recognised for 7 days.
- **Adding an availability window twice returns the existing row** instead of a twin; editing one into a copy of another answers `409` with `code: "CONFLICT"`.
- **The location context lists each venue's `ianaTimezone` and `state`.** Shared `formatShiftRange` and `daysBetweenLocal` take an optional time zone (the device's zone when omitted, as before).

### Added (waste: the ingredient list for a cook who logs waste but cannot count stock)

- **`GET /api/waste/ingredients`.** A read-only list of the caller's organisation's active ingredients, each `{ ingredientId, ingredientName, baseUnit }` (the kitchen unit) and nothing else: no cost, stock, supplier, category or allergen. Same organisation as `GET /api/inventory/ingredients` (ingredients belong to the organisation, not to a location); removed ingredients are left out; sorted by name. Open to `waste:log` and to `inventory:count` (and Administrators), so a cook who may log waste but not count stock can now search the whole list in the phone's picker. No new permission, no migration, nothing to seed or backfill. Someone in no organisation gets `403` with `code: "FORBIDDEN"`.
- **Phone.** The picker's catalogue downloads this list when the person lacks `inventory:count`, and keeps it on the phone like the full one; people who have `inventory:count` still download `GET /api/inventory/ingredients`, unchanged. Older installed apps keep working: the inventory route is untouched and an old phone never asks for the new one.
- Not in this change: a web waste page for `waste:log`-only users (the web gives them no waste screen to type in yet; separate decision).

### Added (mobile: add Sign in with Apple to an account)

- **Account > Add Sign in with Apple** (iPhone and iPad only; Android never shows it). A signed-in person gives a fresh Apple credential and the same proof as changing two-factor settings: the password for an account that has one, and an authenticator code when MFA is on. It calls the existing `POST /api/auth/apple/link`; no server change. A person who registered by email and then hides their email with Apple can now join the two, so Apple sign-in opens the one account instead of creating a second. The screen also shows the already-linked state and plain sentences for the server's codes (`INVALID_CREDENTIALS`, `MFA_REQUIRED`, `INVALID_MFA_CODE`, `RECENT_SIGN_IN_REQUIRED`, `APPLE_ALREADY_LINKED`, `APPLE_TOKEN_INVALID`, `APPLE_NOT_CONFIGURED`/`APPLE_UNAVAILABLE`, `RATE_LIMITED`).

### Added (mobile: Sign in with Apple)

**Apply migration `0003_apple_sign_in` by hand on production BEFORE this version deploys** (`pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts`; run it with `--dry-run` first). The new column and table are read by nothing in the previous server, and the two unique indexes only cover provider `apple`, so the previous server keeps working after the migration. The web behaves as before.

- **Sign in with Apple on iPhone and iPad** (App Store rule 4.8, because the app also offers Google). `POST /api/auth/apple/idtoken` takes `{ identityToken, nonce, authorizationCode?, givenName?, familyName? }` and answers like `/login`, or `{ requiresMfa, mfaSessionToken }` for an account with MFA on. `POST /api/auth/apple/link` (signed in; password or MFA code as for changing MFA) adds Apple to an existing account. The phone screen that calls it is Account > Add Sign in with Apple (see below).
- **Linking is by Apple's stable id.** A first sign-in links to an existing account by email only when Apple says the email is verified AND that account's own email is verified (otherwise `ACCOUNT_EMAIL_UNVERIFIED`). A relay address never matches by email. The Google paths still link unverified accounts (see `tasks/lessons.md`).
- **Deleting the account revokes the Apple token** (App Store rule 5.1.1(v)). `POST /api/users/delete-account` also accepts `appleIdentityToken` and `appleNonce`: a fresh Apple sign-in of the linked Apple ID is the proof for an account with no password (it replaces the typed email and the recent-sign-in rule). A failed revoke queues the encrypted token in `apple_revocation_retries` and logs `apple_token_not_revoked`; nothing runs the queue by itself, so run `pnpm --filter @culinaire/server exec tsx src/scripts/retryAppleRevocations.ts` (prefix `APP_ENV=prod` for production) when that alert appears.
- **Owner setup.** Credentials `APPLE_CLIENT_ID` (the iOS bundle id), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the `.p8`) in Settings → Integrations; the key is needed only to revoke. For Google on iPhone: `GOOGLE_IOS_CLIENT_ID` on the server, and in the phone build `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` plus the EAS variable `GOOGLE_IOS_URL_SCHEME` (see `mobile/.env.example`).
- **New error codes** (shared `ApiErrorBody`): `APPLE_NOT_CONFIGURED`, `APPLE_UNAVAILABLE` (both 503), `APPLE_TOKEN_INVALID` (401), `APPLE_EMAIL_MISSING`, `APPLE_EMAIL_NOT_VERIFIED` (403), `APPLE_ALREADY_LINKED` (409), `ACCOUNT_EMAIL_UNVERIFIED`, `UNAUTHENTICATED`, `RATE_LIMITED` (the per-IP limiters now carry it).

### Added (mobile Wave 2, phone: usage and moves)

- **Usage on the phone.** A Usage tab for `inventory:count` holders (the web's "Internal Usage"): log with the shared ingredient picker, quantity in the item's kitchen unit, reason and shift; edit and delete your own entries; per-unit daily totals with "Return to Stockroom" kept apart; quick "Log again" buttons; the web's "that's a move, not usage" question for FOH usage of kitchen ingredients. Every write is a queued command with a client-made `consumptionLogId`, so a repeat after a lost reply takes no second deduction.
- **Move between areas on the phone.** A Move tab for `inventory:count` holders: pick an item, an amount and the two areas; the areas and latest moves are kept on the phone. One queued command with a client-made `stockMovementId`. A move changes no stock.
- **Shared schemas.** `packages/shared/src/schemas/consumption.ts` and `stockMovement.ts` (what the server sends, parsed leniently, and the reason and shift lists); the catalogue schema gains an optional `itemType`.
- No server route changed: older installed apps keep working. Location Transfer came later (see mobile Wave 3, phone, above). Differences from the web are listed in `mobile/README.md`.

### Added (mobile Wave 2, phone: the offline queue and waste)

- **A general offline queue.** The phone's outbox now holds typed, versioned commands with a handler per type: client-made ids so a resend is safe, ordered replay per entry, backoff on network and 5xx (with a cap a handler can set), refusals kept visible with the server's code and message (Try again or Discard), "already applied" counted as sent, a session that ended pauses the queue until sign-in. Counts are the first handler and behave as before. Existing phones gain the new `outbox` columns by `ALTER TABLE` on first launch. Documented in `mobile/README.md`.
- **Waste on the phone.** A Waste tab for `waste:log` holders: log with ingredient autocomplete, quantity, unit, reason and shift, quick buttons for the latest items, edit and delete your own entries, per-unit daily totals, all offline-first. The shared ingredient picker (`src/ui/IngredientPicker.tsx`) is built to be reused by consumption, transfers and orders.
- **Tablet width.** Screens built on `Screen` and the waste screens sit in a centred column of at most 560 dp.
- No server route changed: older installed apps keep working. Differences from the web waste page are listed in `mobile/README.md`.

### Added (mobile Wave 2, phone: prep)

- **Prep on the phone.** A Prep tab for `prep:read` or `prep:manage` holders (any role can be given them): today's list at the current location (found by the phone's local date, shared by every cook at the location), tick, untick, skip and undo skip with offline-first queued commands that keep the phone's tick time, a progress card, the tasks grouped start with these, next up, can wait, and a Plan screen for `prep:manage` holders (pick dishes and portions, or start from the last plan; saved as create, dishes and generate and sent in order, each safe to repeat). Refused ticks stay on their row with the server's reason. The list is read again every 30 seconds and when the app wakes. Differences from the web prep page are listed in `mobile/README.md`; adding, editing or deleting a task exists on neither web nor server.
- No server route changed: older installed apps keep working.

### Changed (mobile Wave 2, server: the line loop)

**Apply migration `0002_prep_completed_by` by hand on production BEFORE this version deploys** (`pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts`, then `backfillWastePrepPermissions.ts`). Both new columns are nullable, so the previous server keeps working after the migration. The web behaves as before.

- **Retried writes do not double up.** Waste, consumption, stock movements and prep sessions accept a client-made `id` (`wasteLogId`, `consumptionLogId`, `stockMovementId`, `prepSessionId`): a repeat answers 200 with the stored row and changes nothing (no second stock deduction); an id held by someone else is 409 `CONFLICT`. A repeat of a delete answers success. Prep generate takes an optional `requestId`; a repeat answers with the stored tasks and rebuilds nothing, so ticks survive. Without these fields everything behaves as before.
- **Waste.** The location in the request decides where an entry lands (checked against the caller's locations), so a log replayed after a location switch stays where it was made. A date-only report range now includes its end day. The ingredient suggestions query works again (it was a Postgres error). The team/personal toggle context (`GET /api/waste/org-context`) no longer needs `waste:read`.
- **Prep.** Any member who works at the session's location can tick tasks; the server records who (`completedBy`) and keeps the client's `completedAt` (never later than now). `expectedStatus` stops an assign reverting a task another device completed. Ended session, lost race and forbidden each answer with their own code. "Today's session" with `date` and `storeLocationId` is that day's open session at that location, whoever made it. The stock effect of a tick commits or rolls back with it. Generate, end and saving selections are for the creator or a `prep:manage` holder at the location.
- **Consumption log and stock movements.** The log, its edit and delete each commit together with their stock change; concurrent entries take turns on the stock row. Refusals carry codes.
- **Permissions.** New `waste:log` (log, edit, delete your own entries) and `prep:read` (read prep, tick tasks). `waste:read` is reports and the team view; `prep:manage` is create, generate and end. The backfill gives every role that holds the old key the new one, so no role loses access.
- **New error codes** (shared `ApiErrorBody`): `PREP_SESSION_ENDED`, `PREP_TASK_CHANGED` (both 409).

Where the plan and the code disagreed (the code won): the consumption log already checked the body `storeLocationId` and already coded its edit/delete refusals (PR 201), and `:locId` movement routes already pass the location guard, so those got only idempotency, atomic stock and codes. The waste suggestions failed twice (a set-returning function in `WHERE`, and `SELECT DISTINCT` ordered by an unselected column). Prep ticking is gated by location membership plus the module key (`prep:read` or `prep:manage`), not by a new `prep:execute` key. A delete of an entry that is gone answers success for waste and consumption (the 404 test for consumption was changed to say so).

Route changes the phone can adopt (all additive; an old build keeps working):

| Route | New |
|---|---|
| `POST /api/waste` | body `wasteLogId` (uuid), `storeLocationId`; 200 on a repeat, 201 first time; 403 `LOCATION_NOT_ALLOWED`; 409 `CONFLICT`; row now carries `storeLocationId` |
| `DELETE /api/waste/:id` | gone = 200 `{ok:true}`; someone else's = 403 `FORBIDDEN` (was 404); `PATCH` of a missing entry = 404 `NOT_FOUND` |
| `GET /api/waste`, `/summary` | date-only `endDate` includes that day; `teamView=true` needs `waste:read` (403 `FORBIDDEN`) |
| `GET /api/waste/org-context` | open to `waste:read`, `waste:log`, `prep:read`, `prep:manage` |
| `POST /api/prep/sessions` | body `prepSessionId`, `storeLocationId`; `prepDate` must be `YYYY-MM-DD` (400); 200 on a repeat |
| `GET /api/prep/sessions/today` | `?date=YYYY-MM-DD&storeLocationId=` returns that day's open session at the location (400 if only `date`) |
| `PATCH /api/prep/tasks/:id` | body `completedAt`, `expectedStatus`, `assignedTo: null`; answers 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `PREP_SESSION_ENDED`, 409 `PREP_TASK_CHANGED`; task rows carry `completedBy` |
| `POST /api/prep/sessions/:id/generate` | body `requestId` (uuid); 200 with the stored tasks on a repeat, 201 on a rebuild |
| `PATCH /api/prep/sessions/:id/end` | a repeat answers 200 with the session (was 404); 403 `FORBIDDEN`, 404 `NOT_FOUND` |
| `POST /api/inventory/consumption-logs` | body `consumptionLogId`; 200 on a repeat; unknown ingredient 404 `NOT_FOUND` (was 500) |
| `DELETE /api/inventory/consumption-logs/:id` | gone = 200 `{success:true}` (was 404) |
| `POST /api/inventory/locations/:locId/stock-movements` | body `stockMovementId`; 200 on a repeat; refusals carry `VALIDATION`, `NOT_FOUND` or `INCOMPATIBLE_UNITS` |

### Fixed (mobile Wave 0, server)

- **Public recipe pages escape recipe text.** A recipe title, description or image URL could close the page's `<title>`, a meta attribute or the JSON-LD script and run script for every visitor.
- **Receiving and transfers are safe to retry.** Two confirms at once (two phones, a retried request) added the stock twice; now the second answers 409 `ALREADY_CONFIRMED`. "All good" after Short or Reject put the old quantity back; a substitution now lands as stock of the item that arrived (the substitute must belong to the organisation). A transfer checks both locations, ingredients and cost layer against the organisation and runs send, receive, cancel and edit in one locked transaction.
- **Location scoping.** A location sent by the client must be one assigned to the user (org admins and `inventory:hq` holders keep their wider access): enforced on every `:locId` route and on consumption, transfers, receiving, forecasts, purchasing, order guides, catalogue requests and sales (checked on the resolved sale location). The organisation context no longer takes an arbitrary first membership, and admin of one organisation no longer opens another's locations.
- **Errors a phone can act on.** `{ error, code }` (shared `ApiErrorBody`): unit conversion problems answer 422 `INCOMPATIBLE_UNITS`, illegal PO/receiving transitions 409 `INVALID_STATE`, consumption edit/delete refusals 404/403/409, stock-take refusals carry the codes the phone names. `error` is unchanged for the web.
- **Auth.** Refresh tokens rotate (30-day sliding; a lost reply or second tab gets the same successor; replaying a spent token revokes the whole sign-in); suspend, cancel, password change and reset end sessions; the MFA-pending token no longer works as an access token; every public auth endpoint has its own rate-limit bucket, sign-in counts failures only. Bearer tokens are accepted on guest-or-user routes and the Bench socket.

### Added (mobile Wave 0, server)

- `GET /api/mobile/config` (module flags, minimum version, store links), a JSON `FEATURE_DISABLED` body on flagged-off routes, and the update gate on every phone read (queued writes still go through).
- Numbered schema migrations (`src/migrations`, `src/scripts/migrate.ts`, `schema_migrations` ledger). Migration `0001_refresh_token_rotation` must be applied before this version deploys.

### Changed

- **Organisation admins can regenerate the join key.** A refresh button next to the key on Profile → Kitchen (admins only), with a confirm because the old key stops working at once. The route and service already existed with no screen. Removed two dead leftovers: the member `joinedAt` field (the table has no date column, the server always sent null, nothing showed it) and the unused address state in `OrgTab` (the form never had inputs and the server ignored the values). The address columns stay in the database, unused.
- **Offsite backups now go to a private GitHub repo, not Google Drive.** `prodOffsiteBackup.sh` uploads each encrypted dump as a release in `robertangeles/culinaire-offsite-backups`, checks the stored size, and prunes releases over 30 days old (prod and dev, by tag prefix). Reason: rclone's shared Google login is being retired in 2026. Temporary until a proper backup store is chosen. Tried for real: a prod dump uploaded, downloaded, decrypted and listed 958 objects. Files already on Drive stay there and are no longer pruned.

### Added

- **The dev database now has a daily encrypted offsite backup too.** `ck-prod-backup dev` (same script, `prodOffsiteBackup.sh` takes an optional `prod|dev` argument) dumps the Render dev DB, restore-checks it, encrypts it and uploads it to `culinaire-offsite-backups/dev/daily/`, keeping 30 days. Prod behaviour and state files are unchanged. Tried once for real: a 65 MB encrypted dump uploaded and listed on Drive.
- **Mobile compliance contract.** `web-needs.md` in the shared context now records what the server does today for certificate upload, own documents, own roster, s.114 consent and notifications, with what is not built (push, a mobile roster payload). It also surfaced follow-ups, logged in `tasks/todo.md`.
- **Real-DB integration tests run in seconds locally.** `scripts/localIntegrationDb.sh` starts a throwaway local Postgres with pgvector, pushes the schema and seeds it, the same shape CI uses. Against the Render dev DB the roster suite (39 tests) timed out after 400+ seconds; locally it takes 0.4 s, so the slowness was network latency, not the test. `scripts/localIntegrationDb.sh start|env|stop`.
- **Offsite database backup.** A daily dump of prod is checked, encrypted (AES256) and uploaded to Google Drive, and uploads older than 30 days are removed. Until now every backup lived only on one laptop. `scripts/backup/prodOffsiteBackup.sh`; setup, health check and restore steps in `docs/architecture/offsite-backup.md`.
- **Delete my account.** Profile -> Security now has a "Delete account" section. The user confirms with their password (Google-only accounts type their email; accounts with MFA also enter their authenticator code), the account is anonymised exactly like an admin deletion, and they are signed out. Google-only accounts must also have signed in within the last 10 minutes. Blocked, with a clear message, for the only Administrator and for the only admin of an organisation that still has other members. `POST /api/users/delete-account`, `accountDeletionService.ts`. The profile response now includes `hasPassword`.

### Changed

- **Tab strips are touch-sized and work with the arrow keys.** The pill tabs on Inventory, Purchasing, Roster, Team Compliance, Public Holidays, Settings (rostering), Profile, the Create/Join organisation toggle, the Brain scope toggle and the Integrations categories were about 36px tall (the scope toggle 26px), under the 44px touch minimum, and most did not respond to the arrow keys. They now share one `PillTabs` component: 44px tall, Left/Right/Home/End move and select, and only the active tab is a tab stop (Tab leaves the strip). The Organisation and Settings sidebar rows and the Prompts list are also 44px. Tabs grow by about 8px, so headers shift slightly; the Locations and Inventory Catalog screenshot baselines were refreshed. The user-detail screenshot now opens the E2E user by email instead of "the first row", because the seed also creates a second user. `components/ui/PillTabs.tsx`.
- **Deleting a user now anonymises the account instead of removing the row.** Personal data (conversations, credentials, roles, notifications, saved recipes, preferences) is removed, the name, email and other identity fields are scrubbed, any Stripe subscription is cancelled immediately, and the user row is kept so orders, waste logs and the audit trail stay valid with no name attached. Previously the hard delete failed for any user with business history and left orphan rows (for example notifications) behind for the rest. Deleted users are hidden from the admin user list. `userAnonymisationService.ts`; the admin confirmation text now says what actually happens.

### Fixed

- **A deleted account's compliance documents are kept 7 years, not 2.** The purge job had an "orphan sweep" for documents of people who were never offboarded, with a single 2-year window for any non-active account. A deleted account counts as non-active, so its staff compliance documents would have been purged 2 years after deletion, short of the 7-year Fair Work retention. The sweep now waits over 7 years for a deleted account; suspended or cancelled accounts keep the 2-year window. Deleting an account still does not archive their documents (owner decision). `isOrphanedInactive` in `complianceRetentionService.ts`.
- **The backup script no longer shows the database password to `ps`.** `pg_dump` was given the full connection URL as an argument, which any `ps` on the machine prints. The password now goes in `PGPASSWORD` and the URL passed on the command line has none. Applies to the prod and dev backups. Also adds the missing lessons to `tasks/lessons.md`.
- **The backup and local-database scripts are executable.** `scripts/localIntegrationDb.sh`, `scripts/backup/checkBackupFresh.sh` and `scripts/backup/prodOffsiteBackup.sh` were committed without the executable bit, so `scripts/localIntegrationDb.sh start` failed with "Permission denied".
- **Roster screens say when the staff list failed to load, and slow responses no longer overwrite newer ones.** `useOrgMembers` swallowed every failure (and any non-OK response) into an empty list, so a network error looked like a venue with no staff; it now exposes `error` and the Shifts and Roster calendar screens show it. The six roster hooks (shifts, templates, calendar, roles, my shifts, my availability) abort the previous request when a new refresh starts, so a fast venue switch on a slow network cannot show the old venue. `parseError` and its types moved to `hooks/rosterUtils.ts`. 55 new hook tests.
- **A flaky E2E check no longer fails PRs at random.** "Status is never conveyed by colour alone" counted every element with `rounded-full border`, which also matches the empty-state hero icon (no text). Counted before the table loaded, it failed on code that had just passed (seen on #171). `StatusPill` now carries `data-status-pill` and the test counts only those.
- **A stale prod backup now raises an alert, and there is one backup folder.** The daily offsite backup failed silently: a missing `last_success` older than 2 days was visible only if someone looked. `scripts/backup/checkBackupFresh.sh` (cron, hourly) now shows a desktop notification and logs an `ALERT`, once a day, when the last success is 2 or more days old. The two local dump folders were merged into `~/culinaire-prod-backups`, the one the wiki rule names.
- **A mobile (bearer) client can now pass the "signed in recently" check.** Starting or switching off MFA, and deleting your own account, ask Google-only accounts to have signed in within the last 10 minutes, and the server found that time only from the `refresh_token` cookie, so an app with no cookie always got `RECENT_SIGN_IN_REQUIRED`. With no cookie it now reads `refreshToken` from the request body, as change-password already does. The token must still belong to the caller. `POST /api/auth/mfa/setup`, `/mfa/disable`, `POST /api/users/delete-account`; `utils/presentedRefreshToken.ts`.
- **The browser E2E job in CI works again.** GitHub moved `ubuntu-latest` to Ubuntu 26.04, which Playwright 1.59 cannot install chromium on ("Playwright does not support chromium on ubuntu26.04-x64"), so every PR failed that job after 38 seconds. The job is pinned to `ubuntu-24.04`; move it back to `ubuntu-latest` once the Playwright we use supports 26.04. `.github/workflows/ci.yml`.
- **Deleting an account now also deletes the Stripe customer and the profile photo file.** Deletion cancelled the subscription and cleared the photo's address from the account, but Stripe kept the customer's name and email, and the uploaded photo stayed public at its Cloudinary link. The customer is now deleted, which cancels its subscriptions too (Stripe keeps its invoices and payment records); if Stripe refuses, the account is not deleted and the user can retry. The photo is removed from Cloudinary on a best-effort basis: a failure is logged with the link and the deletion goes on. Only photos we uploaded to the avatar folder are ever removed, never a Google avatar or a link another account also uses, because the photo address is user-editable. A local `/uploads/` photo (the no-Cloudinary dev fallback) is not removed from disk. `anonymiseUser`, `stripeService.deleteCustomer`, `deleteProfilePhoto`.
- **Guessing two-factor codes and passwords is now capped per account, not just per address.** The MFA routes shared the sign-in limit of 20 attempts a minute per address, so an attacker using many addresses was not stopped, and a busy kitchen's MFA sign-ins used up the same budget as everyone's logins. `/api/auth/mfa/verify` now has its own per-address limit (20 failed codes a minute) and every MFA route (`/setup`, `/enable`, `/disable`, `/verify`) allows 5 failed attempts per account per 15 minutes, answered with `429`. Only failures count, so successful sign-ins never use up the budget, and neither does the `409` that setup returns while MFA is already on (no password or code was checked). The account is taken from the session, or on `/mfa/verify` from a verified MFA session token; a forged token names no account and cannot be aimed at someone else. The counters are in memory, so a deploy resets them. Change-password and delete-account still use the per-address limit. New: `mfaVerifyRateLimit` and `mfaAccountRateLimit` in `middleware/rateLimiter.ts`, a database-free unit test for the MFA proof check (`services/mfaProof.test.ts`).
- **Changing your password now ends your other sign-ins, and guessing your current password is slowed.** The change-password route had no rate limit, so someone holding a stolen session could keep guessing the current password; it now shares the sign-in limit of 20 attempts a minute per address. That slows guessing without capping it per account, so an attacker using many addresses is not stopped yet. A password change also left every other sign-in alive, unlike a password reset. It now ends all other refresh tokens and keeps the one you are using (the `refresh_token` cookie, or `refreshToken` in the body for bearer clients; with neither, all end). A device that is already signed in stays usable until its current access token expires (up to an hour). The password update and the sign-out are one transaction, and server faults are no longer returned to the client as a 400 with their raw text. `POST /api/users/change-password`.
- **The MFA login code step is now rate limited.** Entering the authenticator code at sign-in had no limit at all, so someone who had just passed the password step could try codes as fast as they liked for the five minutes the step stays open. It now shares the sign-in limit of 20 attempts a minute per address. That slows guessing without capping it per sign-in, so an attacker using many addresses is not stopped yet. `POST /api/auth/mfa/verify`.
- **Uploading a PDF to the compliance vault no longer stalls for five seconds.** The certificate reader (OCR) only understands images, so a PDF sat through its full timeout and came back empty every time. PDFs now skip it and go straight to the manual-entry form; JPEG and PNG uploads are read as before.
- **Two-factor settings can no longer be changed with just a session.** Anyone holding a stolen session could start MFA setup, which replaced the authenticator secret even when MFA was already on (locking the owner out), or switch MFA off with no check at all. Starting setup now needs the account password (Google-only accounts: a sign-in within the last 10 minutes), setup is refused while MFA is on, and switching MFA off needs the password plus a current authenticator code. The three MFA routes are rate limited. The Security tab asks for what the server requires. `POST /api/auth/mfa/setup` and `/disable` now take `{ password, mfaCode }`; an API client that called them with an empty body gets 403.
- **`/settings`, `/profile` and `/my-shelf` no longer render for a visitor with no session.** `AuthenticatedOnly` only redirected guests, so when the guest session could not start (rate limit or guest cap) the visitor was neither guest nor authenticated and saw the Settings admin shell. The server still returned 401 for all data. It now redirects anyone who is not authenticated to `/chat/new`.
- **Global `/api` rate limit no longer locks signed-in users out.** The old per-IP 60/min limit broke the UI after about four page loads (a page load costs ~15 requests) and made everyone behind one office/NAT IP share a single budget. Signed-in users are now limited per user id at 300/min (override with `RATE_LIMIT_PER_MINUTE`). Anonymous traffic, and requests with a forged or expired token, stay on the per-IP 60/min bucket. `/api/auth/*` remains exempt. New: `packages/server/src/middleware/globalRateLimit.ts`.

---

## [0.1.0] — 2026-10-01 (Phase 5)

### Changed

- **Scheduler extracted from `index.ts` into `scheduler.ts`.** All background job logic (~253 lines) — 10 jobs, the `isProductionProcess` gate, and graceful shutdown — moved to `packages/server/src/scheduler.ts`. `index.ts` shrinks from 684 to 431 lines. No runtime behaviour changed; the scheduler is called via `startScheduler(log)` which returns a `clearAll()` cleanup function used in the SIGINT/SIGTERM handlers.

---

## [0.1.0] — 2026-10-01

### Fixed

- **Recipe refinements now use knowledge base context.** `recipeRefinementService` was reading `.text`/`.content` from search results — fields that don't exist on `SearchResult`. The field is `.snippet`. RAG context was silently empty on every recipe refinement call; it now contains the relevant knowledge base snippets.
- **Subscription period end dates populate across all Stripe API versions.** Stripe SDK v20 moved `current_period_end` to `SubscriptionItem`; accounts on older API versions still return it at the subscription level. Both locations are now checked so subscription display is correct regardless of account API version.
- **E2E test selectors repaired** after guide panel and networkidle changes introduced stale selectors in `purchasing.spec.ts` and `order-guides.spec.ts`.

### Changed

- **TypeScript `no-explicit-any` enforced** on all production server code. 238 explicit `any` usages replaced with concrete types, `catch (err: unknown)` guards, or minimal type assertions. ESLint `@typescript-eslint/no-explicit-any: error` added to production config (test files remain exempt).
- **Catch handlers now return `String(err)`** for non-Error thrown values instead of `undefined`. All 36 server catch blocks use `err instanceof Error ? err.message : String(err)` pattern.
