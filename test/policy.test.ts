import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POLICY_REGISTRY,
  PolicyViolationError,
  enforcePolicy,
  resolveOperationId,
} from "../src/policy.js";

test("a registered read passes", () => {
  assert.doesNotThrow(() => enforcePolicy("contacts.list"));
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

test("every command from the Sprint 1 inventory (92 actions) is registered", () => {
  // Guards against a future edit silently dropping an entry. 95 = 92 inventory
  // actions + 3 local config actions (set/unset/show) that sit outside the
  // GHL risk tiers — unset was added in Sprint 4.
  assert.equal(Object.keys(POLICY_REGISTRY).length, 95);
});
