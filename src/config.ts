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

export interface AccountProfile {
  name: string;
  locationId: string;
  /** The NAME of an env var holding the token — never the token itself. */
  tokenEnv: string;
}

interface GhlConfig {
  token?: string;
  locationId?: string;
  defaultReadAccount?: string;
  accounts?: Record<string, AccountProfile>;
}

let plaintextTokenWarned = false;

/**
 * A real env var name is UPPER_SNAKE_CASE. A pasted token never is — this is
 * what lets us refuse a config that stores a literal secret where an env var
 * name belongs, per Epic 1.2's "refuse configs containing apparent literal
 * tokens."
 */
export const looksLikeEnvVarName = (value: string): boolean =>
  /^[A-Z_][A-Z0-9_]*$/.test(value);

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

// ── Named account profiles (Epic 1.2, Sprint 6) ──────────────────────

export const upsertAccountProfile = (alias: string, profile: AccountProfile): void => {
  if (!looksLikeEnvVarName(profile.tokenEnv)) {
    console.error(
      `Refusing to save account "${alias}": tokenEnv must be the NAME of an environment variable ` +
        `(e.g. GHL_TOKEN_${alias.toUpperCase()}), not a token itself. Got: "${profile.tokenEnv}".`,
    );
    process.exit(1);
  }
  const config = loadConfig();
  config.accounts = { ...config.accounts, [alias]: profile };
  saveConfig(config);
};

export const removeAccountProfile = (alias: string): void => {
  const config = loadConfig();
  if (!config.accounts?.[alias]) {
    console.error(`No account named "${alias}" is configured.`);
    process.exit(1);
  }
  delete config.accounts[alias];
  if (config.defaultReadAccount === alias) delete config.defaultReadAccount;
  saveConfig(config);
};

export const setDefaultAccount = (alias: string): void => {
  const config = loadConfig();
  if (!config.accounts?.[alias]) {
    console.error(`No account named "${alias}" is configured. Run \`ghl account add\` first.`);
    process.exit(1);
  }
  config.defaultReadAccount = alias;
  saveConfig(config);
};

export const listAccountProfiles = (): {
  accounts: Record<string, AccountProfile>;
  defaultReadAccount?: string;
} => {
  const config = loadConfig();
  return { accounts: config.accounts ?? {}, defaultReadAccount: config.defaultReadAccount };
};

export const getProfile = (alias: string): AccountProfile => {
  const profile = loadConfig().accounts?.[alias];
  if (!profile) {
    console.error(`No account named "${alias}" is configured. Run \`ghl account list\`.`);
    process.exit(1);
  }
  return profile;
};

export const getProfileToken = (profile: AccountProfile): string => {
  if (!looksLikeEnvVarName(profile.tokenEnv)) {
    console.error(
      `Account references "${profile.tokenEnv}" as its token source, which doesn't look like an ` +
        "env var name — refusing to use it. Fix this account's tokenEnv (see ghl account add --help).",
    );
    process.exit(1);
  }
  const token = process.env[profile.tokenEnv];
  if (!token) {
    console.error(`Account references env var ${profile.tokenEnv}, which is not set.`);
    process.exit(1);
  }
  return token;
};

type ResolvedCredentials = { token: string; locationId: string };

/**
 * The single source of truth getToken()/getLocationId() both delegate to, so
 * they can never disagree about which account they're resolving. A named
 * profile's token and locationId are always returned as a pair — the profile
 * layer only activates when NEITHER ambient env var is present, specifically
 * to avoid ever pairing an ambient value for one field with a profile's
 * value for the other (that mismatch is exactly the wrong-account risk this
 * whole system exists to prevent).
 */
const resolveCredentials = (): ResolvedCredentials | undefined => {
  const envToken = process.env.GHL_PRIVATE_TOKEN;
  const envLocation = process.env.GHL_LOCATION_ID;

  if (envToken && envLocation) {
    return { token: envToken, locationId: envLocation };
  }

  if (!envToken && !envLocation) {
    const config = loadConfig();
    const alias = config.defaultReadAccount;
    const profile = alias ? config.accounts?.[alias] : undefined;
    if (profile && looksLikeEnvVarName(profile.tokenEnv)) {
      const token = process.env[profile.tokenEnv];
      if (token) return { token, locationId: profile.locationId };
    }
  }

  const config = loadConfig();
  const token = envToken || config.token;
  const locationId = envLocation || config.locationId;
  if (config.token && !envToken) warnPlaintextToken();
  if (token && locationId) return { token, locationId };

  return undefined;
};

export const getToken = (): string => {
  const resolved = resolveCredentials();
  if (resolved) return resolved.token;
  console.error(
    "No Private Integration Token. Set GHL_PRIVATE_TOKEN, configure a named account " +
      "(ghl account add) and set it as default, or run: ghl config set token <token>",
  );
  process.exit(1);
};

export const getLocationId = (): string => {
  const resolved = resolveCredentials();
  if (resolved) return resolved.locationId;
  console.error(
    "No location ID. Set GHL_LOCATION_ID, configure a named account (ghl account add) " +
      "and set it as default, or run: ghl config set location <id>",
  );
  process.exit(1);
};
