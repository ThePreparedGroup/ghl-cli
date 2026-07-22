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
});

export const formatResolvedContact = (contact: ResolvedContact): string =>
  `${contact.name} <${contact.email ?? "no email"}> (id: ${contact.id})`;

export async function resolveContact(
  client: GhlClient,
  identifier: string,
): Promise<ResolvedContact> {
  if (GHL_ID_PATTERN.test(identifier)) {
    const data = await client.getContact(identifier);
    return toResolved((data.contact ?? data) as Record<string, unknown>);
  }

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

  return toResolved(matches[0]);
}
