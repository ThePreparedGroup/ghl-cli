import assert from "node:assert/strict";
import { test } from "node:test";
import { GhlClient } from "../src/client.js";
import {
  AmbiguousMatchError,
  NoMatchError,
  formatResolvedContact,
  resolveContact,
} from "../src/resolvers.js";

// resolveContact ultimately calls client.getContact / client.searchContacts,
// which hit the network — these tests stub those two methods on a real
// GhlClient instance rather than hitting the live API, so they're fast and
// don't need credentials. Live behavior against the real demo location was
// verified manually (see the Sprint 9 commit).

const fakeClient = (overrides: Partial<GhlClient>): GhlClient =>
  Object.assign(Object.create(GhlClient.prototype), overrides) as GhlClient;

test("a 20-char alphanumeric identifier resolves via direct getContact", async () => {
  const client = fakeClient({
    getContact: (async (id: string) => ({
      contact: { id, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    })) as GhlClient["getContact"],
  });
  const resolved = await resolveContact(client, "aWbXtA6BtPOUGmsnwb4I");
  assert.equal(resolved.id, "aWbXtA6BtPOUGmsnwb4I");
  assert.equal(resolved.name, "Ada Lovelace");
  assert.equal(formatResolvedContact(resolved), "Ada Lovelace <ada@example.com> (id: aWbXtA6BtPOUGmsnwb4I)");
});

test("a non-ID-shaped identifier searches instead of fetching directly", async () => {
  let searchedWith: unknown;
  const client = fakeClient({
    searchContacts: (async (params: Record<string, string | number>) => {
      searchedWith = params;
      return { contacts: [{ id: "ox9b7oIZqhlAWufgJmgQ", firstName: "Grace", email: "grace@example.com" }] };
    }) as GhlClient["searchContacts"],
  });
  const resolved = await resolveContact(client, "grace@example.com");
  assert.equal(resolved.id, "ox9b7oIZqhlAWufgJmgQ");
  assert.deepEqual(searchedWith, { query: "grace@example.com", limit: 10 });
});

test("zero search matches throws NoMatchError", async () => {
  const client = fakeClient({
    searchContacts: (async () => ({ contacts: [] })) as GhlClient["searchContacts"],
  });
  await assert.rejects(() => resolveContact(client, "nobody"), NoMatchError);
});

test("multiple search matches throws AmbiguousMatchError listing every candidate", async () => {
  const client = fakeClient({
    searchContacts: (async () => ({
      contacts: [
        { id: "aaaaaaaaaaaaaaaaaaaa", firstName: "Sam", email: "sam1@example.com" },
        { id: "bbbbbbbbbbbbbbbbbbbb", firstName: "Sam", email: "sam2@example.com" },
      ],
    })) as GhlClient["searchContacts"],
  });
  await assert.rejects(
    () => resolveContact(client, "sam"),
    (err: unknown) => {
      assert.ok(err instanceof AmbiguousMatchError);
      assert.ok(err.message.includes("sam1@example.com"));
      assert.ok(err.message.includes("sam2@example.com"));
      return true;
    },
  );
});
