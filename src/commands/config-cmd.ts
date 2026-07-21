import { Command } from "commander";
import { loadConfig, redactToken, saveConfig } from "../config.js";

export const configCommand = new Command("config").description(
  "Manage GHL CLI configuration",
);

configCommand
  .command("set <key> <value>")
  .description("Set a config value (token, location) — token storage is deprecated, see `ghl config set token --help`")
  .action((key: string, value: string) => {
    const config = loadConfig();
    if (key === "token") {
      console.error(
        "Warning: this stores your Private Integration Token in plaintext at ~/.ghl/config.json. " +
          "Deprecated — set GHL_PRIVATE_TOKEN as an environment variable instead.",
      );
      config.token = value;
    } else if (key === "location") {
      config.locationId = value;
    } else {
      console.error(`Unknown key: ${key}. Use 'token' or 'location'.`);
      process.exit(1);
    }
    saveConfig(config);
    console.log(`${key} saved.`);
  });

configCommand
  .command("unset <key>")
  .description("Remove a config value (token, location)")
  .action((key: string) => {
    const config = loadConfig();
    if (key === "token") {
      delete config.token;
    } else if (key === "location") {
      delete config.locationId;
    } else {
      console.error(`Unknown key: ${key}. Use 'token' or 'location'.`);
      process.exit(1);
    }
    saveConfig(config);
    console.log(`${key} removed.`);
  });

configCommand
  .command("show")
  .description("Show current configuration")
  .action(() => {
    const config = loadConfig();
    if (config.token) {
      console.error(
        "Warning: a plaintext token is stored at ~/.ghl/config.json. " +
          "Deprecated — set GHL_PRIVATE_TOKEN as an environment variable, then run `ghl config unset token`.",
      );
    }
    console.log(
      JSON.stringify(
        {
          token: redactToken(config.token),
          locationId: config.locationId || "(not set)",
        },
        null,
        2,
      ),
    );
  });
