# Command Inventory & Risk Classification

**Sprint:** 1 — Command inventory and risk classification
**Created:** 2026-07-21
**Scope:** Every CLI command in `src/commands/*.ts`, mapped to its `src/client.ts` method, HTTP verb, endpoint, API `Version` header, and a risk tier per the classification in `ghl-cli-safety-hardening-roadmap-v2.md` Epic 1.1.

No source was changed to produce this document. It is ground truth from reading the code, not from the roadmap's assumptions — several findings below correct or sharpen those assumptions.

## Risk tiers

| Tier | Meaning |
|---|---|
| `read` | No state change (`list`, `get`, `search` — including `POST` endpoints used only to carry a search body) |
| `low_write` | Additive, low blast-radius, easily reversed (add note, create task, create a grouping) |
| `high_write` | Changes visible/consequential state: contact/record fields, tags, stage, sends, publishes, financial records |
| `destructive` | Deletes a record, or is otherwise effectively irreversible (void) |
| `local` | Never touches the GHL API — reads/writes `~/.ghl/config.json` only |

## Key findings (read this before Sprint 3)

1. **There is no v1 REST host in this codebase.** Every call goes to `https://services.leadconnectorhq.com` (the v2 LeadConnector API). The roadmap's "v1 vs v2 split" is really about the `Version` **header** value (`2021-07-28` default vs `2021-04-15`), not a separate legacy host. Worth rephrasing in the roadmap so nobody goes looking for a `rest.gohighlevel.com` call site.
2. **`calHeaders()` looks like a copy-paste bug.** It returns the exact same `CONVERSATIONS_VERSION` (`2021-04-15`) as `convHeaders()`, and it's only actually applied to `getCalendars()` — `getCalendarEvents`, `getFreeSlots`, `createAppointment`, `updateAppointment`, and `deleteAppointment` all use the default `2021-07-28` instead. Whether calendar endpoints genuinely need `2021-04-15` (and the other five methods are missing it) or `calendar list` is wrongly pinned to a conversations-era version is a Sprint 2 platform question, not something to guess at.
3. **`opportunities update` never calls the dedicated status-transition endpoint.** `client.ts` has `updateOpportunityStatus` (`PATCH /opportunities/:id/status`), but the CLI's `update` command always goes through `updateOpportunity` (`PUT /opportunities/:id`) even when only `--status` is passed. If GHL's automation triggers (workflow enrollment on stage/status change) are wired to the `PATCH /status` endpoint specifically, the CLI may be silently changing status without firing the automation GHL customers expect — or firing something different. Needs a Sprint 2 empirical check before Epic 2.3 designs around "status change" as a single well-defined operation.
4. **`invoices number` is a `GET` with a likely side effect.** `generateInvoiceNumber` hits `/invoices/generate-number` — if GHL allocates/reserves the number server-side on each call (typical for sequence generators), repeated dry-runs or retries would burn invoice numbers. Verify in Sprint 2; if true, this command needs `low_write` treatment despite being a `GET`.
5. **The client exposes more destructive/structural methods than the CLI currently wires up.** These are unreachable today, so they're not an active risk, but they must be registered (or explicitly prohibited) in Sprint 3's policy engine *before* anyone adds a command for them, not after:
   - `deleteConversation`, `updateConversation`
   - `deleteLocation`, `updateLocation`, `createLocation` (whole-location CRUD — good that this is already unreachable, matches Epic 1.5's "locations: deletion prohibited")
   - `createLocationCustomField` / `updateLocationCustomField` / `deleteLocationCustomField`
   - `createLocationCustomValue` / `updateLocationCustomValue` / `deleteLocationCustomValue`
   - `updateLocationTag` (create/delete are wired; update is not)
   - `deleteInvoiceTemplate`, `createInvoiceTemplate`, `getInvoiceTemplate`
   - `deleteSocialAccount`, `bulkDeleteSocialPosts` (bulk delete — Epic 1.5 says this class should be mechanically prohibited; right now it's prohibited only by accident of not being built, not by policy)
   - `updateEmailTemplate`
   - `createObjectSchema`, `updateObjectSchema` (defines/changes a custom object's schema account-wide — bigger blast radius than a record)
   - `checkUrlSlug`, `getCalendarGroups`, `searchLocationTasks` (read-only, low priority, listed for completeness)
6. **`calendar cancel` is a hard delete that isn't named "delete."** The Sprint 1 baseline note ("delete commands exist on: contacts, invoices, media, objects, opportunities, products, social posts, email templates, location tags") missed it — `deleteAppointment` is a real `DELETE`. Same for `invoices void`, which isn't a delete verb but is an effectively irreversible financial state change; both need to be in the destructive/consequential bucket for Sprint 5's gating.
7. **`locations tag-delete` deletes the tag *definition* location-wide**, not a single contact's tag assignment — every contact carrying that tag loses it silently. Higher blast radius than a typical single-record delete; worth its own confirmation copy in Sprint 5, not the generic "delete a record" phrasing.
8. **`objects record-create` accepts an arbitrary JSON blob** (`--data`) merged directly into the request body with no shape validation. Not a Sprint 1 fix, but Epic 2.2 (reliable diffs / validation) should treat this command as needing schema-aware validation, not just a generic diff.
9. **`media upload`** takes a bare `--url` and asks GHL to fetch-and-host it server-side (`hosted: true`), with no validation of the URL's origin. Low blast radius to GHL data itself, but worth a mention in Sprint 4/credential-hardening docs as an SSRF-adjacent input if this tool is ever exposed beyond a trusted operator.
10. **Workflows and surveys are 100% read-only** — `client.ts` has no write methods for either resource at all. Zero policy work needed there beyond registering the reads.

## Commands by group

### config (2) — `local`, not a GHL API surface

| Command | Action | Risk | Notes |
|---|---|---|---|
| `config set <key> <value>` | Writes `~/.ghl/config.json` | `local` | This is the plaintext-token path Sprint 4 must kill. Also sets `locationId`. |
| `config show` | Reads local file | `local` | Already truncates token to 8 chars in output. |

### contacts (9)

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /contacts/` | 2021-07-28 | read | |
| `get <id>` | `GET /contacts/:id` | 2021-07-28 | read | |
| `create` | `POST /contacts/` | 2021-07-28 | high_write | No duplicate check before create — Epic 2.6 target. |
| `update <id>` | `PUT /contacts/:id` | 2021-07-28 | high_write | Roadmap's canonical high_write example. |
| `delete <id>` | `DELETE /contacts/:id` | 2021-07-28 | destructive | **Prohibited per Epic 1.5** — replace with tag-for-deletion. |
| `tag <id> --add/--remove` | `POST`/`DELETE /contacts/:id/tags` | 2021-07-28 | high_write | Automation-sensitive (tag apply is a named Epic 2.3 trigger). |
| `note <id> --add` | `POST /contacts/:id/notes` | 2021-07-28 | low_write | Roadmap's canonical low_write example. |
| `note <id>` (no `--add`) | `GET /contacts/:id/notes` | 2021-07-28 | read | Same command, read branch. |
| `upsert` | `POST /contacts/upsert` | 2021-07-28 | high_write | Bypasses duplicate detection by design — Epic 2.6 says restrict to explicit request only. |
| `tasks <id> --add` | `POST /contacts/:id/tasks` | 2021-07-28 | low_write | Roadmap's canonical low_write example. |
| `tasks <id>` (no `--add`) | `GET /contacts/:id/tasks` | 2021-07-28 | read | Same command, read branch. |

### opportunities (6) — alias `opp`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `search` | `GET /opportunities/` | 2021-07-28 | read | |
| `get <id>` | `GET /opportunities/:id` | 2021-07-28 | read | |
| `create` | `POST /opportunities/` | 2021-07-28 | high_write | |
| `update <id>` | `PUT /opportunities/:id` | 2021-07-28 | high_write | **See finding #3** — also carries stage/status changes, but not through the dedicated `PATCH /status` endpoint. Automation-sensitive. |
| `delete <id>` | `DELETE /opportunities/:id` | 2021-07-28 | destructive | |
| `pipeline` | `GET /opportunities/pipelines` | 2021-07-28 | read | |

### conversations (3) — alias `conv`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `search` | `GET /conversations/search` | **2021-04-15** | read | |
| `messages <id>` | `GET /conversations/:id` | **2021-04-15** | read | |
| `send --type sms\|email` | `POST /conversations/messages` or `/conversations/emails` | **2021-04-15** | high_write | Automation-sensitive (message send is a named Epic 2.3 trigger). Customer-facing and irreversible once sent. |

Unwired client methods: `updateConversation` (`PUT`), `deleteConversation` (`DELETE`) — no CLI command today.

### calendar (5) — alias `cal`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /calendars/` | **2021-04-15** | read | See finding #2 on the version inconsistency. |
| `events <calendarId>` | `GET /calendars/:id/events` | 2021-07-28 | read | |
| `slots <calendarId>` | `POST /calendars/:id/free-slots` | 2021-07-28 | read | `POST` carries a date-range query body only, no state change. |
| `book` | `POST /calendars/appointments` | 2021-07-28 | high_write | Automation-sensitive (reminders/workflows on booking). |
| `cancel <appointmentId>` | `DELETE /calendars/appointments/:id` | 2021-07-28 | destructive | **See finding #6** — a real hard delete, not currently in the roadmap's destructive-surface list. Epic 1.3 explicitly requires dry-run here. |

### invoices (9) — alias `inv`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /invoices/` | 2021-07-28 | read | |
| `get <id>` | `GET /invoices/:id` | 2021-07-28 | read | |
| `create` | `POST /invoices/` | 2021-07-28 | high_write | |
| `send <id>` | `POST /invoices/:id/send` | 2021-07-28 | high_write | Automation-sensitive, customer-facing. |
| `delete <id>` | `DELETE /invoices/:id` | 2021-07-28 | destructive | |
| `void <id>` | `POST /invoices/:id/void` | 2021-07-28 | destructive | Not a delete verb, but effectively irreversible — treat with the same rigor. |
| `record-payment <id>` | `POST /invoices/:id/record-payment` | 2021-07-28 | high_write | Financial write, practically irreversible. |
| `number` | `GET /invoices/generate-number` | 2021-07-28 | read* | **See finding #4** — likely allocates a sequence number as a side effect; may need `low_write` treatment pending Sprint 2 verification. |
| `templates` | `GET /invoices/template` | 2021-07-28 | read | |

Unwired client methods: `createInvoiceTemplate`, `getInvoiceTemplate`, `deleteInvoiceTemplate` — no CLI command today.

### estimates (3) — alias `est`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /estimates/` | 2021-07-28 | read | |
| `create` | `POST /estimates/` | 2021-07-28 | high_write | |
| `send <id>` | `POST /estimates/:id/send` | 2021-07-28 | high_write | Automation-sensitive, customer-facing. |

### blog (6)

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `sites` | `GET /blogs/site/all` | 2021-07-28 | read | |
| `posts <blogId>` | `GET /blogs/posts/all` | 2021-07-28 | read | |
| `create` | `POST /blogs/posts` | 2021-07-28 | high_write | Public-facing content. |
| `update <postId>` | `PUT /blogs/posts/:id` | 2021-07-28 | high_write | Can change a live published post's content/status. |
| `authors` | `GET /blogs/authors` | 2021-07-28 | read | |
| `categories` | `GET /blogs/categories` | 2021-07-28 | read | |

No delete surface exists for blog posts, in the CLI or the client. Unwired: `checkUrlSlug`.

### locations (8) — alias `loc`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `get [id]` | `GET /locations/:id` | 2021-07-28 | read | Defaults to configured location. |
| `search` | `GET /locations/search` | 2021-07-28 | read | |
| `tags` | `GET /locations/:id/tags` | 2021-07-28 | read | |
| `tag-create` | `POST /locations/:id/tags` | 2021-07-28 | low_write | |
| `tag-delete <tagId>` | `DELETE /locations/:id/tags/:tagId` | 2021-07-28 | destructive | **See finding #7** — deletes the tag definition for every contact location-wide, not one assignment. |
| `fields` | `GET /locations/:id/customFields` | 2021-07-28 | read | |
| `values` | `GET /locations/:id/customValues` | 2021-07-28 | read | |
| `templates` | `GET /locations/:id/templates` | 2021-07-28 | read | |

Unwired client methods (whole categories with zero CLI surface today — keep it that way deliberately, not by accident): `createLocation`/`updateLocation`/`deleteLocation`, `createLocationCustomField`/`updateLocationCustomField`/`deleteLocationCustomField`, `createLocationCustomValue`/`updateLocationCustomValue`/`deleteLocationCustomValue`, `updateLocationTag`, `searchLocationTasks`.

### social (7)

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `POST /social-media-posting/:locationId/posts/list` | 2021-07-28 | read | `POST` carries a search body only. |
| `post` | `POST /social-media-posting/:locationId/posts` | 2021-07-28 | high_write | Automation-sensitive; publishes immediately if no `--scheduleDate`. |
| `get <postId>` | `GET .../posts/:id` | 2021-07-28 | read | |
| `update <postId>` | `PUT .../posts/:id` | 2021-07-28 | high_write | Can edit an already-published post. |
| `delete <postId>` | `DELETE .../posts/:id` | 2021-07-28 | destructive | |
| `accounts` | `GET .../accounts` | 2021-07-28 | read | |
| `schedule` | `POST .../posts` (same endpoint as `post`) | 2021-07-28 | high_write | Same underlying call as `post`, just requires `--scheduleDate`. Not a distinct API operation. |

Unwired client methods: `deleteSocialAccount`, `bulkDeleteSocialPosts` — the latter is exactly the class Epic 1.5 wants mechanically prohibited; currently prohibited only by not existing in the CLI.

### emails (4)

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `campaigns` | `GET /emails/schedule` | 2021-07-28 | read | |
| `templates` | `GET /emails/builder` | 2021-07-28 | read | |
| `template-create` | `POST /emails/builder` | 2021-07-28 | high_write | Templates may be referenced by live automations. |
| `template-delete <id>` | `DELETE /emails/builder/:locationId/:id` | 2021-07-28 | destructive | Deleting a template referenced by a live automation breaks that automation silently. |

Unwired: `updateEmailTemplate` (`POST /emails/builder/data`).

### media (3)

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /medias/files` | 2021-07-28 | read | |
| `upload` | `POST /medias/upload-file` | 2021-07-28 | low_write | **See finding #9** — server-side fetch of an arbitrary `--url`, no origin validation. |
| `delete <id>` | `DELETE /medias/:id` | 2021-07-28 | destructive | May be referenced by live emails/posts/blog content; deletion breaks those references silently. |

### workflows (1) — alias `wf`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /workflows/` | 2021-07-28 | read | Entirely read-only resource — no write methods exist in `client.ts` for workflows at all. |

### surveys (2)

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /surveys/` | 2021-07-28 | read | |
| `submissions` | `GET /locations/:id/surveys/submissions` | 2021-07-28 | read | Entirely read-only resource. |

### products (10) — alias `prod`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /products/` | 2021-07-28 | read | |
| `get <id>` | `GET /products/:id` | 2021-07-28 | read | |
| `create` | `POST /products/` | 2021-07-28 | high_write | |
| `update <id>` | `PUT /products/:id` | 2021-07-28 | high_write | Affects live checkout pages referencing this product. |
| `delete <id>` | `DELETE /products/:id` | 2021-07-28 | destructive | |
| `prices <productId>` | `GET /products/:id/price` | 2021-07-28 | read | |
| `price-create <productId>` | `POST /products/:id/price` | 2021-07-28 | high_write | No price update/delete exists in the API surface — additive only, old prices linger. |
| `collection-create` | `POST /products/collections` | 2021-07-28 | low_write | |
| `collections` | `GET /products/collections` | 2021-07-28 | read | |
| `inventory` | `GET /products/inventory` | 2021-07-28 | read | |

### payments (8) — alias `pay`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `orders` | `GET /payments/orders` | 2021-07-28 | read | |
| `order <id>` | `GET /payments/orders/:id` | 2021-07-28 | read | |
| `transactions` | `GET /payments/transactions` | 2021-07-28 | read | |
| `transaction <id>` | `GET /payments/transactions/:id` | 2021-07-28 | read | |
| `subscriptions` | `GET /payments/subscriptions` | 2021-07-28 | read | |
| `subscription <id>` | `GET /payments/subscriptions/:id` | 2021-07-28 | read | |
| `coupons` | `GET /payments/coupon/list` | 2021-07-28 | read | |
| `coupon-create` | `POST /payments/coupon` | 2021-07-28 | high_write | Immediately usable at checkout — a mistaken 100%-off/no-expiry coupon is real financial exposure. |

Almost entirely read-only; `coupon-create` is the one write in this group.

### objects (6) — alias `obj`

| Command | Method → Endpoint | Version | Risk | Notes |
|---|---|---|---|---|
| `list` | `GET /objects/` | 2021-07-28 | read | |
| `schema <key>` | `GET /objects/:key` | 2021-07-28 | read | |
| `records <schemaKey>` | `POST /objects/:key/records/search` | 2021-07-28 | read | `POST` carries a search body only. |
| `record-get <schemaKey> <recordId>` | `GET /objects/:key/records/:id` | 2021-07-28 | read | |
| `record-create <schemaKey> --data <json>` | `POST /objects/:key/records` | 2021-07-28 | high_write | **See finding #8** — `--data` is arbitrary JSON merged into the body with no shape validation. |
| `record-delete <schemaKey> <recordId>` | `DELETE /objects/:key/records/:id` | 2021-07-28 | destructive | |

Unwired client methods: `createObjectSchema`, `updateObjectSchema` — these define/change the custom object's schema itself, an account-wide structural change with a bigger blast radius than any single record. If ever exposed via CLI, treat as its own risk tier above `high_write`, not folded into "objects" generically.

## Totals

| Group | Commands | read | low_write | high_write | destructive | local |
|---|---|---|---|---|---|---|
| config | 2 | 1 | 0 | 0 | 0 | 1 (+1 show) |
| contacts | 9(11 branches) | 3 | 2 | 4 | 1 | 0 |
| opportunities | 6 | 3 | 0 | 2 | 1 | 0 |
| conversations | 3 | 2 | 0 | 1 | 0 | 0 |
| calendar | 5 | 3 | 0 | 1 | 1 | 0 |
| invoices | 9 | 4* | 0 | 2 | 2 | 0 |
| estimates | 3 | 1 | 0 | 2 | 0 | 0 |
| blog | 6 | 4 | 0 | 2 | 0 | 0 |
| locations | 8 | 6 | 1 | 0 | 1 | 0 |
| social | 7 | 3 | 0 | 3 | 1 | 0 |
| emails | 4 | 2 | 0 | 1 | 1 | 0 |
| media | 3 | 1 | 1 | 0 | 1 | 0 |
| workflows | 1 | 1 | 0 | 0 | 0 | 0 |
| surveys | 2 | 2 | 0 | 0 | 0 | 0 |
| products | 10 | 5 | 1 | 3 | 1 | 0 |
| payments | 8 | 7 | 0 | 1 | 0 | 0 |
| objects | 6 | 4 | 0 | 1 | 1 | 0 |
| **Total** | **92** | **52** | **5** | **23** | **11** | **2** |

\* `invoices number` counted under `read` pending the Sprint 2 side-effect check in finding #4.

`contacts note` and `contacts tasks` each branch into a read and a write path from one command name, which is why the raw command count (18 lines above, matching the 17 groups plus config) undercounts the 92 distinct read/write actions — this matches the roadmap's "~90 commands" estimate.

## Sprint 1 checkpoint

This inventory is the input to Sprint 3's policy registry. Before that sprint starts, resolve with Ken:

- Findings #3 and #4 (opportunity status endpoint choice, invoice-number side effect) — both need a Sprint 2 empirical answer, not a Sprint 1 guess.
- Whether `invoices void` and `locations tag-delete` get their own policy tier distinct from generic `destructive`, given their broader-than-single-record blast radius (findings #6, #7).
- Whether unwired client methods (finding #5) should get explicit `prohibited: true` policy entries now (cheap, and prevents a future command from being wired without going through review) or just get registered when/if a command is eventually built for them.
