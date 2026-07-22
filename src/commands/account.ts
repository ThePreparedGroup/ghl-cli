import { Command } from "commander";
import { GhlClient } from "../client.js";
import {
  getProfile,
  getProfileToken,
  listAccountProfiles,
  removeAccountProfile,
  setDefaultAccount,
  upsertAccountProfile,
} from "../config.js";

// Sprint 6 (Epic 1.2), part 1: named account profiles. A profile stores an
// alias, a human-readable name, a locationId, and the NAME of an env var
// holding the token — never the token itself. Command-level `--account`
// enforcement on writes is part 2 (a later sprint); for now, a profile set
// as the default is used automatically by any command when no ambient
// GHL_PRIVATE_TOKEN/GHL_LOCATION_ID pair is set.

export const accountCommand = new Command("account").description(
  "Manage named GHL account profiles",
);

accountCommand
  .command("add <alias>")
  .description("Add or update a named account profile")
  .requiredOption("--name <name>", "Human-readable account name")
  .requiredOption("--location <locationId>", "GHL location ID")
  .requiredOption(
    "--token-env <ENV_VAR>",
    "Name of the environment variable holding this account's token (not the token itself)",
  )
  .action((alias, opts) => {
    upsertAccountProfile(alias, {
      name: opts.name,
      locationId: opts.location,
      tokenEnv: opts.tokenEnv,
    });
    if (!process.env[opts.tokenEnv]) {
      console.error(
        `Note: ${opts.tokenEnv} is not currently set in this shell — set it before using this account.`,
      );
    }
    console.log(`Account "${alias}" saved.`);
  });

accountCommand
  .command("remove <alias>")
  .description("Remove a named account profile")
  .action((alias) => {
    removeAccountProfile(alias);
    console.log(`Account "${alias}" removed.`);
  });

accountCommand
  .command("list")
  .description("List configured account profiles")
  .action(() => {
    const { accounts, defaultReadAccount } = listAccountProfiles();
    const aliases = Object.keys(accounts);
    if (aliases.length === 0) {
      console.log("No accounts configured. Add one with `ghl account add <alias>`.");
      return;
    }
    for (const alias of aliases) {
      const profile = accounts[alias];
      const marker = alias === defaultReadAccount ? " (default for reads)" : "";
      console.log(
        `${alias}${marker}: ${profile.name} — location ${profile.locationId}, token from $${profile.tokenEnv}`,
      );
    }
  });

accountCommand
  .command("set-default <alias>")
  .description("Set the default account used for reads when no ambient env vars are set")
  .action((alias) => {
    setDefaultAccount(alias);
    console.log(`Default read account set to "${alias}".`);
  });

accountCommand
  .command("verify <alias>")
  .description("Check that this account's token can reach its configured location, and only that location")
  .action(async (alias) => {
    const profile = getProfile(alias);
    const token = getProfileToken(profile);
    const client = new GhlClient(token, profile.locationId);
    const { canAccessConfiguredLocation, looksAgencyScoped } = await client.checkScope();

    if (!canAccessConfiguredLocation) {
      console.error(
        `FAIL: this token cannot access location ${profile.locationId} (${profile.name}). Check the token and locationId are correct.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(`OK: token can access ${profile.name} (${profile.locationId}).`);

    if (looksAgencyScoped) {
      console.error(
        "WARNING: this token can also reach an agency-level endpoint (/locations/search). " +
          "It may not be scoped to just this one location and could potentially reach others. " +
          "Prefer a location-scoped Private Integration Token for this account.",
      );
    } else {
      console.log("Token is correctly scoped — it cannot reach other locations.");
    }
  });
