#!/usr/bin/env node
import { program } from "commander";
import { showBanner } from "./banner.js";
import { accountCommand } from "./commands/account.js";
import { calendarCommand } from "./commands/calendar.js";
import { configCommand } from "./commands/config-cmd.js";
import { contactsCommand } from "./commands/contacts.js";
import { conversationsCommand } from "./commands/conversations.js";
import { invoicesCommand } from "./commands/invoices.js";
import { locationsCommand } from "./commands/locations.js";
import { opportunitiesCommand } from "./commands/opportunities.js";
import { socialCommand } from "./commands/social.js";
import { surveysCommand } from "./commands/surveys.js";
import { workflowsCommand } from "./commands/workflows.js";
import { blogCommand } from "./commands/blog.js";
import { productsCommand } from "./commands/products.js";
import { paymentsCommand } from "./commands/payments.js";
import { mediaCommand } from "./commands/media.js";
import { emailsCommand } from "./commands/emails.js";
import { objectsCommand } from "./commands/objects.js";
import { estimatesCommand } from "./commands/estimates.js";
import {
  PolicyViolationError,
  enforcePolicy,
  isWriteRisk,
  resolveOperationId,
} from "./policy.js";
import { getProfile, getProfileToken, redactSecrets } from "./config.js";
import { DryRunHalt } from "./client.js";

program
  .name("ghl")
  .description("GoHighLevel CLI — CRM operations from the terminal")
  .version("0.1.0")
  .option(
    "--account <alias>",
    "Named account profile to use (required for writes; see `ghl account`)",
  )
  .option(
    "--dry-run",
    "Preview the request a write would send, without sending it (writes only)",
  );

// Show banner on `ghl` (no args) or `ghl --help`
const args = process.argv.slice(2);
const hasSubcommand = args.some((a) => !a.startsWith("-"));
if (!hasSubcommand) {
  showBanner();
}

program.addCommand(configCommand);
program.addCommand(accountCommand);
program.addCommand(contactsCommand);
program.addCommand(opportunitiesCommand);
program.addCommand(conversationsCommand);
program.addCommand(calendarCommand);
program.addCommand(invoicesCommand);
program.addCommand(blogCommand);
program.addCommand(socialCommand);
program.addCommand(locationsCommand);
program.addCommand(workflowsCommand);
program.addCommand(surveysCommand);
program.addCommand(productsCommand);
program.addCommand(paymentsCommand);
program.addCommand(mediaCommand);
program.addCommand(emailsCommand);
program.addCommand(objectsCommand);
program.addCommand(estimatesCommand);

// Sprint 3 (Epic 1.1): every command passes through the risk-policy registry
// before its handler runs. An operation with no registry entry — or one
// explicitly marked prohibited — is refused here, before any GHL API call
// can happen. See src/policy.ts.
//
// Sprint 7 (Epic 1.2 part 2): every write additionally requires an explicit
// --account <alias>; reads may fall back to the configured default. When
// --account is given, it's resolved here and pushed into process.env for
// this invocation only — getToken()/getLocationId() in config.ts already
// treat ambient env vars as the highest-priority source (Sprint 6), so this
// is the only place that needs to know about the flag at all.
program.hook("preAction", (thisCommand, actionCommand) => {
  const group = actionCommand.parent?.name() ?? actionCommand.name();
  const operationId = resolveOperationId(
    group,
    actionCommand.name(),
    actionCommand.opts(),
  );
  let policy;
  try {
    policy = enforcePolicy(operationId);
  } catch (err) {
    if (err instanceof PolicyViolationError) {
      console.error(`Blocked by policy: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const accountAlias: string | undefined = thisCommand.opts().account;

  if (isWriteRisk(policy.risk) && !accountAlias) {
    console.error(
      `Blocked by policy: "${operationId}" is a ${policy.risk} operation and requires an explicit account. ` +
        "Pass --account <alias> before the command, e.g. `ghl --account demo " +
        `${operationId.replace(".", " ")}\`. Run \`ghl account list\` to see configured accounts.`,
    );
    process.exit(1);
  }

  if (accountAlias) {
    const profile = getProfile(accountAlias);
    const token = getProfileToken(profile);
    process.env.GHL_PRIVATE_TOKEN = token;
    process.env.GHL_LOCATION_ID = profile.locationId;
    console.error(`Using account "${accountAlias}": ${profile.name} (${profile.locationId})`);
  }

  // Sprint 8 (Epic 1.3, part 1): --dry-run only takes effect for writes.
  // GhlClient's request interceptor checks this env var and halts before
  // sending, regardless of which of the 17 command files made the call.
  if (isWriteRisk(policy.risk) && thisCommand.opts().dryRun) {
    process.env.GHL_DRY_RUN = "1";
  }
});

program.parseAsync().catch((err) => {
  if (err instanceof DryRunHalt) {
    console.log("=== DRY RUN — no request was sent ===");
    console.log(`${err.method} ${redactSecrets(err.url)}`);
    if (err.params && Object.keys(err.params as object).length > 0) {
      console.log("Query params:", redactSecrets(JSON.stringify(err.params, null, 2)));
    }
    if (err.data) {
      console.log("Body:", redactSecrets(JSON.stringify(err.data, null, 2)));
    }
    console.log(
      "\nNote: this shows the exact request that would be sent. It does not yet show " +
        "current-vs-proposed state, automation-impact warnings, or the verification that " +
        "would run afterward — those need identity resolution and a diff engine (Milestone 2).",
    );
    process.exit(0);
  }
  if (err.response?.data) {
    console.error(redactSecrets(JSON.stringify(err.response.data, null, 2)));
  } else {
    console.error(redactSecrets(String(err.message || err)));
  }
  process.exit(1);
});
