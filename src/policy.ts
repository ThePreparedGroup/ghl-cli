// Sprint 3 (Epic 1.1): central risk-policy registry.
//
// Every command in src/commands/*.ts is registered here, keyed by
// "<group>.<command>" (see docs/command-inventory.md for the full audit this
// registry is built from). enforcePolicy() is the single gate every command
// passes through via the preAction hook in index.ts — an operation with no
// entry, or one marked `prohibited`, is refused before its handler ever runs.
//
// This sprint only wires the fail-closed check itself. The other flags below
// (requiresDryRun, requiresConfirmation, requiresIdentityResolution) describe
// what later sprints (1.3, 1.5, 2.x) must build against each operation — they
// are not yet enforced anywhere.

export type Risk = "read" | "low_write" | "high_write" | "destructive" | "local";

export type OperationPolicy = {
  risk: Risk;
  requiresExplicitAccount: boolean;
  requiresDryRun: boolean;
  requiresConfirmation: boolean;
  requiresIdentityResolution: boolean;
  verificationStrategy?: string;
  prohibited?: boolean;
  note?: string;
};

export class PolicyViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

const read = (note?: string): OperationPolicy => ({
  risk: "read",
  requiresExplicitAccount: false,
  requiresDryRun: false,
  requiresConfirmation: false,
  requiresIdentityResolution: false,
  note,
});

const lowWrite = (identity: boolean, note?: string): OperationPolicy => ({
  risk: "low_write",
  requiresExplicitAccount: true,
  requiresDryRun: false,
  requiresConfirmation: false,
  requiresIdentityResolution: identity,
  note,
});

const highWrite = (identity: boolean, note?: string): OperationPolicy => ({
  risk: "high_write",
  requiresExplicitAccount: true,
  requiresDryRun: true,
  requiresConfirmation: false,
  requiresIdentityResolution: identity,
  note,
});

const destructive = (identity: boolean, note?: string): OperationPolicy => ({
  risk: "destructive",
  requiresExplicitAccount: true,
  requiresDryRun: true,
  requiresConfirmation: true,
  requiresIdentityResolution: identity,
  note,
});

const local = (note?: string): OperationPolicy => ({
  risk: "local",
  requiresExplicitAccount: false,
  requiresDryRun: false,
  requiresConfirmation: false,
  requiresIdentityResolution: false,
  note,
});

export const POLICY_REGISTRY: Record<string, OperationPolicy> = {
  // ── config (local file only, never touches the GHL API) ──
  "config.set": local("Token storage here is deprecated as of Sprint 4 — warns and points to GHL_PRIVATE_TOKEN."),
  "config.unset": local("Added in Sprint 4 so users can remove a migrated plaintext token."),
  "config.show": local(),

  // ── contacts ──
  "contacts.list": read(),
  "contacts.get": read(),
  "contacts.create": highWrite(false, "No duplicate check yet — Epic 2.6."),
  "contacts.update": highWrite(true),
  "contacts.delete": highWrite(true, "Sprint 5: no longer calls DELETE /contacts/:id. Tags the contact pending-deletion instead — API deletion of contacts is prohibited; actual removal is a manual, reviewed step."),
  "contacts.tag": highWrite(true, "Automation-sensitive: tag apply/remove."),
  "contacts.note.add": lowWrite(true),
  "contacts.note.list": read(),
  "contacts.upsert": highWrite(false, "Bypasses duplicate detection by design — Epic 2.6."),
  "contacts.tasks.add": lowWrite(true),
  "contacts.tasks.list": read(),

  // ── opportunities (alias opp) ──
  "opportunities.search": read(),
  "opportunities.get": read(),
  "opportunities.create": highWrite(false),
  "opportunities.update": highWrite(true, "Also carries stage/status changes — automation-sensitive. See docs/command-inventory.md finding #3."),
  "opportunities.delete": destructive(true),
  "opportunities.pipeline": read(),

  // ── conversations (alias conv) ──
  "conversations.search": read(),
  "conversations.messages": read(),
  "conversations.send": highWrite(true, "Automation-sensitive: message send. Customer-facing and irreversible once sent."),

  // ── calendar (alias cal) ──
  "calendar.list": read(),
  "calendar.events": read(),
  "calendar.slots": read(),
  "calendar.book": highWrite(true, "Automation-sensitive: booking triggers reminders/workflows."),
  "calendar.cancel": destructive(true, "Real hard delete — see docs/command-inventory.md finding #6."),

  // ── invoices (alias inv) ──
  "invoices.list": read("Broken today — missing altType param. See docs/api-findings.md."),
  "invoices.get": read(),
  "invoices.create": highWrite(false),
  "invoices.send": highWrite(true, "Automation-sensitive, customer-facing."),
  "invoices.delete": destructive(true),
  "invoices.void": destructive(true, "Not a delete verb, but effectively irreversible."),
  "invoices.record-payment": highWrite(true, "Financial write, practically irreversible."),
  "invoices.number": read("Possible side effect on GHL's side — inconclusive per docs/api-findings.md."),
  "invoices.templates": read(),

  // ── estimates (alias est) ──
  "estimates.list": read(),
  "estimates.create": highWrite(false),
  "estimates.send": highWrite(true, "Automation-sensitive, customer-facing."),

  // ── blog ──
  "blog.sites": read(),
  "blog.posts": read(),
  "blog.create": highWrite(false, "Public-facing content."),
  "blog.update": highWrite(true, "Can change a live published post."),
  "blog.authors": read(),
  "blog.categories": read(),

  // ── locations (alias loc) ──
  "locations.get": read(),
  "locations.search": read(),
  "locations.tags": read(),
  "locations.tag-create": lowWrite(false),
  "locations.tag-delete": destructive(true, "Deletes the tag definition location-wide, not one contact's assignment. See docs/command-inventory.md finding #7. Sprint 5: gated behind a --confirm <tagId> match."),
  "locations.fields": read(),
  "locations.values": read(),
  "locations.templates": read(),

  // ── social ──
  "social.list": read(),
  "social.post": highWrite(false, "Automation-sensitive: publishes immediately without --scheduleDate."),
  "social.get": read(),
  "social.update": highWrite(true, "Can edit an already-published post."),
  "social.delete": destructive(true),
  "social.accounts": read(),
  "social.schedule": highWrite(false, "Same underlying call as social.post, requires --scheduleDate."),

  // ── emails ──
  "emails.campaigns": read(),
  "emails.templates": read(),
  "emails.template-create": highWrite(false, "Templates may be referenced by live automations."),
  "emails.template-delete": destructive(true, "May break automations referencing this template."),

  // ── media ──
  "media.list": read(),
  "media.upload": lowWrite(false, "Server-side fetch of an arbitrary --url, no origin validation."),
  "media.delete": destructive(true, "May be referenced by live emails/posts/blog content."),

  // ── workflows (alias wf) ──
  "workflows.list": read("Entirely read-only resource — no write methods exist for workflows at all."),

  // ── surveys ──
  "surveys.list": read(),
  "surveys.submissions": read(),

  // ── products (alias prod) ──
  "products.list": read(),
  "products.get": read(),
  "products.create": highWrite(false),
  "products.update": highWrite(true, "Affects live checkout pages."),
  "products.delete": destructive(true),
  "products.prices": read(),
  "products.price-create": highWrite(true, "Additive only — no price update/delete exists in the API surface."),
  "products.collection-create": lowWrite(false),
  "products.collections": read(),
  "products.inventory": read(),

  // ── payments (alias pay) ──
  "payments.orders": read(),
  "payments.order": read(),
  "payments.transactions": read(),
  "payments.transaction": read(),
  "payments.subscriptions": read(),
  "payments.subscription": read(),
  "payments.coupons": read(),
  "payments.coupon-create": highWrite(false, "Immediately usable at checkout — real financial exposure if misconfigured."),

  // ── objects (alias obj) ──
  "objects.list": read(),
  "objects.schema": read(),
  "objects.records": read(),
  "objects.record-get": read(),
  "objects.record-create": highWrite(true, "--data is an arbitrary JSON blob with no shape validation. See docs/command-inventory.md finding #8."),
  "objects.record-update": highWrite(true, "--data is an arbitrary JSON blob with no shape validation, same as record-create. See docs/command-inventory.md finding #8."),
  "objects.record-delete": destructive(true, "Sprint 5: gated behind a --confirm <recordId> match."),

  // ── Sprint 5 (Epic 1.5): structurally prohibited operations ──
  // No CLI command exposes any of these today — the client.ts methods exist
  // but are unwired (see docs/command-inventory.md finding #5). An
  // unregistered operation already fails closed by default (Sprint 3), so
  // these entries aren't load-bearing on their own; they exist so the intent
  // is explicit and documented, rather than a silent gap that could look
  // like an oversight to whoever adds the command later.
  //
  // The roadmap's Epic 1.5 also names "companies" as prohibited — this
  // codebase has no company resource in client.ts at all, so there's
  // nothing to register. Worth correcting in the roadmap doc.
  "locations.delete": {
    ...destructive(true, "Whole-location deletion — prohibited per Epic 1.5. No CLI command exists for this; entry is defensive."),
    prohibited: true,
  },
  "locations.custom-field-delete": {
    ...destructive(true, "Custom-field definitions: manual deletion in the GHL UI only, per Epic 1.5. No CLI command exists for this; entry is defensive."),
    prohibited: true,
  },
  "social.bulk-delete": {
    ...destructive(true, "Bulk deletion mechanically prohibited per Epic 1.5 until a dedicated, reviewed workflow exists. No CLI command exists for this; entry is defensive."),
    prohibited: true,
  },
};

/**
 * Resolves the registry key for a command invocation. Almost always
 * "<group>.<command>", except the two contacts commands that branch into a
 * read or a write depending on whether --add was passed.
 */
export function resolveOperationId(
  group: string,
  command: string,
  opts: Record<string, unknown>,
): string {
  if (group === "contacts" && command === "note") {
    return opts.add ? "contacts.note.add" : "contacts.note.list";
  }
  if (group === "contacts" && command === "tasks") {
    return opts.add ? "contacts.tasks.add" : "contacts.tasks.list";
  }
  return `${group}.${command}`;
}

/**
 * The single enforcement gate. Throws PolicyViolationError — rather than
 * exiting the process directly — so it stays unit-testable; the caller
 * (index.ts's preAction hook) is responsible for turning that into a clean
 * stderr message and a non-zero exit code.
 *
 * Deliberately fails closed for ANY unregistered operation, not just writes:
 * a future command nobody has classified yet could just as easily be a write
 * as a read, and there's no way to tell from the outside.
 */
export function enforcePolicy(operationId: string): OperationPolicy {
  const policy = POLICY_REGISTRY[operationId];
  if (!policy) {
    throw new PolicyViolationError(
      `"${operationId}" has no registered risk policy. Refusing to run an unregistered operation — register it in src/policy.ts before it can be used.`,
    );
  }
  if (policy.prohibited) {
    throw new PolicyViolationError(
      `"${operationId}" is prohibited by policy (risk: ${policy.risk}).`,
    );
  }
  return policy;
}
