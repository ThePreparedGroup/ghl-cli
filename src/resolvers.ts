import type { GhlClient } from "./client.js";

// Sprint 9 (Epic 2.1, part 1: contacts). "A numeric ID alone is insufficient
// for a consequential confirmation" — so even when the caller passes what
// looks like a real GHL ID, we still fetch and display the human identity
// behind it before a write proceeds, rather than trusting the ID blindly.
// An ambiguous name/email search stops and lists candidates instead of
// guessing which one was meant.

export class NoMatchError extends Error {}
export class AmbiguousMatchError extends Error {}

export type ResolvedContact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  /** The full canonical record, for diffing against a proposed update. */
  raw: Record<string, unknown>;
};

// Every GHL contact ID observed in this project's live testing has been a
// 20-character alphanumeric string. Anything else (contains @, spaces,
// punctuation, or a different length) is treated as a search term instead.
const GHL_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

const displayName = (contact: Record<string, unknown>): string => {
  const name = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || (contact.email as string) || (contact.phone as string) || "(no name)";
};

const toResolved = (contact: Record<string, unknown>): ResolvedContact => ({
  id: contact.id as string,
  name: displayName(contact),
  email: contact.email as string | undefined,
  phone: contact.phone as string | undefined,
  raw: contact,
});

export const formatResolvedContact = (contact: ResolvedContact): string =>
  `${contact.name} <${contact.email ?? "no email"}> (id: ${contact.id})`;

export async function resolveContact(
  client: GhlClient,
  identifier: string,
): Promise<ResolvedContact> {
  let id = identifier;

  if (!GHL_ID_PATTERN.test(identifier)) {
    const data = await client.searchContacts({ query: identifier, limit: 10 });
    const matches = (data.contacts ?? data ?? []) as Record<string, unknown>[];

    if (!Array.isArray(matches) || matches.length === 0) {
      throw new NoMatchError(`No contact found matching "${identifier}".`);
    }

    if (matches.length > 1) {
      const list = matches
        .map((c) => `  - ${formatResolvedContact(toResolved(c))}`)
        .join("\n");
      throw new AmbiguousMatchError(
        `"${identifier}" matches ${matches.length} contacts — re-run with a specific ID:\n${list}`,
      );
    }

    id = matches[0].id as string;
  }

  // Always follow up with a direct fetch, even after a search — the search
  // endpoint returns lowercased name fields, and diffing (Epic 2.2) needs
  // the full canonical record, not just what the search response includes.
  const data = await client.getContact(id);
  return toResolved((data.contact ?? data) as Record<string, unknown>);
}

// Sprint 10 (Epic 2.2, part 1): current-vs-proposed diffing for contact
// updates. Scope note: this covers scalar fields and the one collection
// field (tags) contacts update exposes. It does not yet handle explicit
// field-clearing (the CLI has no --clear-X flags to express that), currency/
// date/email format validation, or any other resource type — those are
// separate, later slices of Epic 2.2.

export type FieldDiff = {
  field: string;
  from: unknown;
  to: unknown;
};

const SCALAR_FIELDS = ["email", "firstName", "lastName", "phone"] as const;

/**
 * Compares the current contact record against the options an `update`
 * invocation was given, returning only the fields that would actually
 * change. Fields the caller didn't pass are omitted — never treated as "set
 * to undefined" — since the CLI has no way to express an explicit clear.
 */
export function diffContactUpdate(
  current: Record<string, unknown>,
  opts: Record<string, unknown>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  for (const field of SCALAR_FIELDS) {
    if (opts[field] === undefined) continue;
    if (current[field] !== opts[field]) {
      diffs.push({ field, from: current[field], to: opts[field] });
    }
  }

  if (typeof opts.tags === "string") {
    const proposedTags = (opts.tags as string).split(",");
    const currentTags = Array.isArray(current.tags) ? (current.tags as string[]) : [];
    const same =
      currentTags.length === proposedTags.length &&
      currentTags.every((t) => proposedTags.includes(t));
    if (!same) {
      diffs.push({ field: "tags (replaces the full list)", from: currentTags, to: proposedTags });
    }
  }

  return diffs;
}

export const formatFieldDiff = (diff: FieldDiff): string =>
  `  ${diff.field}: ${JSON.stringify(diff.from ?? null)} -> ${JSON.stringify(diff.to)}`;
