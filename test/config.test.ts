import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getLocationId,
  getToken,
  looksLikeEnvVarName,
  redactSecrets,
  redactToken,
} from "../src/config.js";

// Deliberately does not touch ~/.ghl/config.json — that path is real user
// state, not a test fixture. The file-perms, legacy-plaintext-warning, and
// named-profile-resolution behavior in config.ts were verified live instead
// (see the Sprint 4 and Sprint 6 commits).

test("redactToken never returns the full secret", () => {
  const token = "pit-82a78764-58e6-40f2-8a01-4fd9c21fdd88";
  const redacted = redactToken(token);
  assert.ok(redacted.length < token.length);
  assert.ok(!redacted.includes(token));
  assert.equal(redacted, "pit-82a7...");
});

test("redactToken handles an unset token", () => {
  assert.equal(redactToken(undefined), "(not set)");
});

test("redactSecrets strips a token sourced from the environment", () => {
  const original = process.env.GHL_PRIVATE_TOKEN;
  process.env.GHL_PRIVATE_TOKEN = "pit-testtoken-12345";
  try {
    const text = `Authorization: Bearer pit-testtoken-12345 failed`;
    const cleaned = redactSecrets(text);
    assert.ok(!cleaned.includes("pit-testtoken-12345"));
    assert.ok(cleaned.includes("pit-test..."));
  } finally {
    if (original === undefined) delete process.env.GHL_PRIVATE_TOKEN;
    else process.env.GHL_PRIVATE_TOKEN = original;
  }
});

test("looksLikeEnvVarName accepts real env var names, rejects pasted tokens", () => {
  assert.ok(looksLikeEnvVarName("GHL_TOKEN_DEMO"));
  assert.ok(looksLikeEnvVarName("GHL_PRIVATE_TOKEN"));
  assert.ok(!looksLikeEnvVarName("pit-82a78764-58e6-40f2-8a01-4fd9c21fdd88"));
  assert.ok(!looksLikeEnvVarName("ghl_token_demo"));
  assert.ok(!looksLikeEnvVarName(""));
});

test("a full ambient env pair resolves without touching disk", () => {
  const savedToken = process.env.GHL_PRIVATE_TOKEN;
  const savedLocation = process.env.GHL_LOCATION_ID;
  process.env.GHL_PRIVATE_TOKEN = "pit-ambient-test-token";
  process.env.GHL_LOCATION_ID = "ambient-test-location";
  try {
    assert.equal(getToken(), "pit-ambient-test-token");
    assert.equal(getLocationId(), "ambient-test-location");
  } finally {
    if (savedToken === undefined) delete process.env.GHL_PRIVATE_TOKEN;
    else process.env.GHL_PRIVATE_TOKEN = savedToken;
    if (savedLocation === undefined) delete process.env.GHL_LOCATION_ID;
    else process.env.GHL_LOCATION_ID = savedLocation;
  }
});
