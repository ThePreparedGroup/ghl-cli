import assert from "node:assert/strict";
import { test } from "node:test";
import { GhlClient } from "../src/client.js";
import {
  AmbiguousMatchError,
  NoMatchError,
  diffContactUpdate,
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

test("a non-ID-shaped identifier searches, then follows up with a canonical getContact fetch", async () => {
  let searchedWith: unknown;
  let fetchedId: unknown;
  const client = fakeClient({
    searchContacts: (async (params: Record<string, string | number>) => {
      searchedWith = params;
      // Deliberately lowercased, like the real search endpoint returns —
      // proves the follow-up getContact call is what supplies the real casing.
      return { contacts: [{ id: "ox9b7oIZqhlAWufgJmgQ", firstName: "grace", email: "grace@example.com" }] };
    }) as GhlClient["searchContacts"],
    getContact: (async (id: string) => {
      fetchedId = id;
      return { contact: { id, firstName: "Grace", lastName: "Hopper", email: "grace@example.com" } };
    }) as GhlClient["getContact"],
  });
  const resolved = await resolveContact(client, "grace@example.com");
  assert.equal(resolved.id, "ox9b7oIZqhlAWufgJmgQ");
  assert.equal(resolved.name, "Grace Hopper");
  assert.equal(fetchedId, "ox9b7oIZqhlAWufgJmgQ");
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

test("diffContactUpdate only reports fields that actually change", () => {
  const current = { email: "old@example.com", firstName: "Old", tags: ["vip"] };
  const diffs = diffContactUpdate(current, { email: "old@example.com", firstName: "New" });
  assert.deepEqual(diffs, [{ field: "firstName", from: "Old", to: "New" }]);
});

test("diffContactUpdate omits fields the caller didn't pass, rather than treating them as cleared", () => {
  const current = { email: "keep@example.com", firstName: "Keep", phone: "555" };
  const diffs = diffContactUpdate(current, { firstName: "Changed" });
  assert.deepEqual(diffs, [{ field: "firstName", from: "Keep", to: "Changed" }]);
});

test("diffContactUpdate flags tags as a full-list replacement, order-insensitive", () => {
  const current = { tags: ["a", "b"] };
  assert.deepEqual(diffContactUpdate(current, { tags: "b,a" }), []);
  assert.deepEqual(diffContactUpdate(current, { tags: "a,c" }), [
    { field: "tags (replaces the full list)", from: ["a", "b"], to: ["a", "c"] },
  ]);
});
