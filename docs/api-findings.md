# Live API Capability Probe (Milestone 0)

**Sprint:** 2 — Live API capability probe
**Date:** 2026-07-21
**Tested against:** location `0Yg3mjcgHEzcITghxTCD` ("The Freedom People"), via a location-scoped Private Integration Token (`pit-...`). Ken confirmed this location is safe to write throwaway test data to.
**Method:** A throwaway script hit the real endpoints directly with `axios` (bypassing `client.ts` so response headers were visible, not just `.data`). The script was not committed — see the commit for this sprint. Every write it made was cleaned up (test contact created, updated, then deleted).

No production code was touched. This document answers the Milestone 0 unknowns, plus the two open questions Sprint 1 raised.

## 0. A bug, found in passing — read this first

**`invoices list` is broken as shipped.** `GET /invoices/` **requires** an `altType` query param (`"location"` or `"company"`), confirmed by the live 422 response:

```
without altType: 422 {"message":["offset must be a string","offset should not be empty","altType should not be empty","altType must be a valid enum value"]}
with altType=location: 422 {"message":["offset must be a string","offset should not be empty"]}
```

`client.ts`'s `listInvoices` only sends `altId`, never `altType` — so every call to `ghl invoices list` fails with a 422 today, regardless of what the user passes. (The `offset must be a string` complaint is a red herring for the CLI specifically — `invoices.ts` always sends `offset` as a string default, so that half resolves itself once `altType` is added.)

The same `altId`-without-`altType` pattern appears in `client.ts` on **`getInvoice`, `createInvoice`, `updateInvoice`, `deleteInvoice`, `sendInvoice`, `generateInvoiceNumber`, and `sendEstimate`** — everywhere else in the file that touches this resource family (`voidInvoice`, `recordPayment`, `listInvoiceTemplates`, `createInvoiceTemplate`, `listEstimates`, `createEstimate`, products/payments collections) already sends both `altId` and `altType`. I did **not** independently verify all seven of those beyond `list` — creating/sending a real invoice or estimate on this location felt like a bigger footprint than a throwaway contact, and I didn't want to do that without checking with you first. But given how consistent the pattern is elsewhere in the same file, I'd bet on all seven being broken the same way.

**Recommendation:** this is a pre-existing bug in the forked baseline, not something Sprint 2 introduced. Fix it as a fast, separate micro-fix (add `altType: "location"` to those seven methods) before or alongside Sprint 4 — there's no reason to build dry-run/policy scaffolding around commands that 422 before they'd ever reach it. Want me to just fix it now, or verify the other six live first?

## 1. Concurrency primitives

**GHL provides both:** a real `ETag` header on `GET` responses, and a `dateUpdated` field in the resource body that changes on every write.

- `GET /contacts/` returned `etag: W/"46f-Crg/YCZkCTALQ8Ng6+dkZBzkiQ4"`.
- Creating a contact returned `dateUpdated` and `lastUpdatedBy` in the body immediately.
- After a `PUT` update, `dateUpdated` advanced from `2026-07-21T22:41:06.054Z` to `2026-07-21T22:41:07.064Z` — a clean, monotonic marker.

**Decision for Epic 2.4:** use `dateUpdated` as the concurrency fingerprint, not the `ETag`. The `ETag` is `weak` (`W/"..."`, hash of representation) and only confirmed present on plain `GET`s in this test — safer to build drift-detection on a field GHL's own docs describe as a timestamp than to depend on ETag support across every resource type without testing each one individually. Revisit per-resource if a specific verification adapter (Epic 2.5) needs finer granularity than a timestamp gives.

## 2. Read-after-write consistency

**No lag observed for contacts.** Immediate `GET` after `POST` reflected the new contact exactly (email match: `true`). Immediate `GET` after `PUT` reflected the updated `firstName` exactly, and `dateUpdated` had already advanced. No retry was needed.

**Decision for Epic 2.5:** bounded retry-with-backoff is still worth building as a safety net (this was one location, one resource type, low load) but it does not need to be the default assumption — a single immediate re-fetch is a reasonable first attempt, with retry as the fallback rather than the norm.

**Delete verification quirk:** after deleting the test contact, `GET /contacts/:id` did **not** return `404` — it returned:

```
400 {"message":"Contact not found for id:aWbXtA6BtPOUGmsnwb4I","error":"Bad Request","statusCode":400}
```

**Decision for Epic 2.5:** the "delete → confirm not found" verification adapter can't just check for a `404` status code. For contacts at least, it needs to check for `400` with a `"not found"`-shaped message. Other resource types should be checked individually before assuming this pattern generalizes — don't build one generic "was it deleted" check against a single status code.

## 3. Rate limits

Real headers, present on every request:

```
x-ratelimit-max: 100
x-ratelimit-remaining: 99
x-ratelimit-interval-milliseconds: 10000
x-ratelimit-limit-daily: 200000
x-ratelimit-daily-remaining: 199779
x-ratelimit-daily-reset: 49013000
```

So: **100 requests per 10-second sliding window**, plus a **200,000/day** ceiling. Both are visible on every response, not just on a 429 — the execution layer can track remaining budget proactively instead of waiting to get throttled.

**Decision:** the bulk-operation cap (Epic 2.6) and verification re-fetches (which roughly double call volume, per the roadmap) have real numbers to size against now: at 100 req/10s, a bulk op of the roadmap's proposed default cap (20 records, doubled for verification = ~40 calls) is comfortably inside one window. Worth building a simple token-bucket against `x-ratelimit-remaining` rather than a fixed sleep.

## 4. Scope granularity

This token is **correctly and narrowly scoped to its own location**:

- `GET /locations/search` (an agency-level endpoint) → `403 Forbidden`.
- `GET /locations/<a bogus 20-char id>` → `403 Forbidden` (not `404` — it doesn't even leak whether the ID exists, it just refuses).
- The same token successfully reads its own location (`GET /locations/0Yg3mjcgHEzcITghxTCD`, confirmed earlier in this sprint).

**This is good news, not a gap.** For a location-scoped Private Integration Token, cross-location writes appear structurally impossible rather than merely discouraged. The roadmap's biggest-named risk ("can a mis-scoped agency token write to the wrong sub-account") needs re-testing with an **agency-level** token specifically — this test used a location token and found it well-behaved. Epic 1.2's "verify the token can access the configured location and warn if it can reach others" logic should still be built (agency tokens are a different risk profile and TPG may use those elsewhere), but it's not an emergency for location-token workflows.

## 5. API surface reality (v1 vs v2)

Confirmed empirically, matching Sprint 1's finding #1: there is one host (`services.leadconnectorhq.com`), and the `Version` header, not a separate API version/host, is what varies.

**Calendar `Version` header (Sprint 1 finding #2):** tested `GET /calendars/` with both `2021-04-15` and `2021-07-28` — **identical response shape and count** either way. `GET /calendars/:id/events` returned `404` under both versions too (consistent between versions, though inconclusive on its own — see below).

**Decision:** the `calHeaders()` version pin in `client.ts` appears harmless rather than load-bearing — at least for `/calendars/` list, both versions behave the same, so this isn't an active bug worth rushing to fix. It's still worth cleaning up in a later pass for clarity (it's dead-looking code that implies a requirement that doesn't seem to exist), but it's not blocking anything.

**Calendar events 404, both versions:** inconclusive. This location's calendar returned an ID, but `/events` 404'd regardless of `Version`. Could mean "no events in the queried date range renders as 404 instead of an empty list" (a real API quirk worth knowing) or a params issue unrelated to versioning. Not chased further this sprint — flag for whoever builds calendar dry-run/verification (Epic 2.5) to confirm the actual empty-vs-error behavior before relying on either status code meaning something specific.

**Invoice generate-number side effect (Sprint 1 finding #4):** **inconclusive, not answered.** Both calls returned `500 Internal server error` regardless of `altType`. This didn't look like the `altType` bug (adding it didn't change the 500), so it's more likely this location doesn't have invoicing/billing fully provisioned. Needs a location with invoicing actually set up to test properly — can't conclude whether repeated calls burn sequence numbers from a 500.

## Milestone 0 exit check

| Unknown | Status |
|---|---|
| Concurrency primitives | **Answered** — use `dateUpdated`, not ETag |
| Read-after-write consistency | **Answered** — immediate for contacts; retry as fallback, not default assumption |
| Rate limits | **Answered** — 100/10s, 200k/day, both exposed in headers |
| Scope granularity (location token) | **Answered** — correctly restricted, no cross-location leakage |
| Scope granularity (agency token) | **Not tested** — no agency token available this sprint; re-test before trusting agency-token workflows |
| API surface / v1 vs v2 | **Answered** — one host, `Version` header is the only axis |
| Calendar Version inconsistency | **Answered (harmless)** for `/calendars/`; events endpoint inconclusive |
| Invoice-number side effect | **Not answered** — needs a location with invoicing enabled |
| **New: `altType` missing on 7 invoice/estimate client methods** | **`list` confirmed broken; other 6 inferred, not tested** |

## Sprint 2 checkpoint

Before Sprint 3 builds the policy engine on top of this:

1. Decide whether to fix the `altType` bug now (fast, isolated) or carry it as known-broken into the policy work — I'd rather not design dry-run/confirmation UX around commands that fail before they'd ever reach it.
2. If we want the invoice-number and agency-scope questions answered, that needs either a location with invoicing enabled, or an agency-level token — neither was available this sprint.
