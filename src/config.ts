import { config as loadEnv } from "dotenv";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

loadEnv({ quiet: true });

const CONFIG_DIR = join(homedir(), ".ghl");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

interface GhlConfig {
  token?: string;
  locationId?: string;
}

let plaintextTokenWarned = false;

/** Truncates a secret for display; never returns enough to reconstruct it. */
export const redactToken = (token: string | undefined): string =>
  token ? `${token.slice(0, 8)}...` : "(not set)";

/**
 * Replaces any occurrence of known secrets with their redacted form. Used on
 * error output so a stray full-object dump (e.g. an axios error) can't leak
 * the token, even though normal error paths don't include it today.
 */
export const redactSecrets = (text: string): string => {
  const token = process.env.GHL_PRIVATE_TOKEN || loadConfig().token;
  if (!token) return text;
  return text.split(token).join(redactToken(token));
};

export const loadConfig = (): GhlConfig => {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
};

export const saveConfig = (config: GhlConfig): void => {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  // Belt-and-suspenders: writeFileSync's mode only applies when creating the
  // file, so an existing file with looser perms from an older CLI version
  // needs an explicit chmod too.
  chmodSync(CONFIG_FILE, 0o600);
};

const warnPlaintextToken = (): void => {
  if (plaintextTokenWarned) return;
  plaintextTokenWarned = true;
  console.error(
    `Warning: using a Private Integration Token stored in plaintext at ${CONFIG_FILE}. ` +
      "This is deprecated. Set GHL_PRIVATE_TOKEN as an environment variable instead, " +
      "then run `ghl config unset token` to remove the plaintext copy.",
  );
};

export const getToken = (): string => {
  const envToken = process.env.GHL_PRIVATE_TOKEN;
  if (envToken) return envToken;

  const configToken = loadConfig().token;
  if (configToken) {
    warnPlaintextToken();
    return configToken;
  }

  console.error(
    "No Private Integration Token. Set GHL_PRIVATE_TOKEN or run: ghl config set token <token>",
  );
  process.exit(1);
};

export const getLocationId = (): string => {
  const id = process.env.GHL_LOCATION_ID || loadConfig().locationId;
  if (!id) {
    console.error(
      "No location ID. Set GHL_LOCATION_ID or run: ghl config set location <id>",
    );
    process.exit(1);
  }
  return id;
};
