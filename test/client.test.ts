import assert from "node:assert/strict";
import { test } from "node:test";
import { DryRunHalt, GhlClient } from "../src/client.js";

// The request interceptor throws before axios ever dispatches over the
// network, so this is safe to run with no real token/location and no
// network access.

test("GHL_DRY_RUN halts a write before any network call, carrying the request details", async () => {
  const original = process.env.GHL_DRY_RUN;
  process.env.GHL_DRY_RUN = "1";
  try {
    const client = new GhlClient("fake-token", "fake-location");
    await assert.rejects(
      () => client.updateContact("abc123", { firstName: "Test" }),
      (err: unknown) => {
        assert.ok(err instanceof DryRunHalt);
        assert.equal(err.method, "PUT");
        assert.ok(err.url.endsWith("/contacts/abc123"));
        assert.deepEqual(err.data, { firstName: "Test" });
        return true;
      },
    );
  } finally {
    if (original === undefined) delete process.env.GHL_DRY_RUN;
    else process.env.GHL_DRY_RUN = original;
  }
});

test("without GHL_DRY_RUN, the interceptor does not interfere (request proceeds to the network layer)", async () => {
  const original = process.env.GHL_DRY_RUN;
  delete process.env.GHL_DRY_RUN;
  try {
    const client = new GhlClient("fake-token", "fake-location");
    // Real network call would fail (fake credentials) — what matters here is
    // that it's NOT a DryRunHalt, proving the interceptor is a no-op when
    // the flag isn't set.
    await assert.rejects(
      () => client.updateContact("abc123", { firstName: "Test" }),
      (err: unknown) => {
        assert.ok(!(err instanceof DryRunHalt));
        return true;
      },
    );
  } finally {
    if (original === undefined) delete process.env.GHL_DRY_RUN;
    else process.env.GHL_DRY_RUN = original;
  }
});
