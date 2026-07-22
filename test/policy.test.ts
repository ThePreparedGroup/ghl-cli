import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POLICY_REGISTRY,
  PolicyViolationError,
  enforcePolicy,
  isWriteRisk,
  resolveOperationId,
} from "../src/policy.js";

test("a registered read passes", () => {
  assert.doesNotThrow(() => enforcePolicy("contacts.list"));
});

test("isWriteRisk distinguishes writes from reads and local ops (Sprint 7 --account gate)", () => {
  assert.ok(isWriteRisk("low_write"));
  assert.ok(isWriteRisk("high_write"));
  assert.ok(isWriteRisk("destructive"));
  assert.ok(!isWriteRisk("read"));
  assert.ok(!isWriteRisk("local"));
});

test("a deliberately-unregistered operation is blocked", () => {
  assert.throws(
    () => enforcePolicy("contacts.beam-up"),
    PolicyViolationError,
  );
});

test("a prohibited operation is blocked even if registered", () => {
  const key = "__test.prohibited__";
  (POLICY_REGISTRY as Record<string, unknown>)[key] = {
    risk: "destructive",
    requiresExplicitAccount: true,
    requiresDryRun: true,
    requiresConfirmation: true,
    requiresIdentityResolution: true,
    prohibited: true,
  };
  try {
    assert.throws(() => enforcePolicy(key), PolicyViolationError);
  } finally {
    delete (POLICY_REGISTRY as Record<string, unknown>)[key];
  }
});

test("contacts note/tasks resolve to their read or write branch by --add", () => {
  assert.equal(resolveOperationId("contacts", "note", {}), "contacts.note.list");
  assert.equal(
    resolveOperationId("contacts", "note", { add: "hi" }),
    "contacts.note.add",
  );
  assert.equal(resolveOperationId("contacts", "tasks", {}), "contacts.tasks.list");
  assert.equal(
    resolveOperationId("contacts", "tasks", { add: "call back" }),
    "contacts.tasks.add",
  );
});

test("every command from the Sprint 1 inventory (93 actions) is registered", () => {
  // Guards against a future edit silently dropping an entry. 96 = 93 inventory
  // actions + 3 local config actions (set/unset/show) that sit outside the
  // GHL risk tiers — unset was added in Sprint 4. objects.record-update was
  // added after Sprint 1, wiring up a client method the README already
  // documented but no command exposed. Sprint 5 added 3 defensive prohibited
  // entries (locations.delete, locations.custom-field-delete,
  // social.bulk-delete) for capabilities with no CLI command yet. Sprint 6
  // added the 5 `account` commands (named profiles).
  assert.equal(Object.keys(POLICY_REGISTRY).length, 104);
});

test("contacts.delete is no longer destructive — Sprint 5 replaced it with tag-for-deletion", () => {
  const policy = enforcePolicy("contacts.delete");
  assert.equal(policy.risk, "high_write");
  assert.notEqual(policy.prohibited, true);
});

test("Sprint 5 defensive entries for unwired capabilities are prohibited", () => {
  for (const key of [
    "locations.delete",
    "locations.custom-field-delete",
    "social.bulk-delete",
  ]) {
    assert.throws(() => enforcePolicy(key), PolicyViolationError);
  }
});
