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
import { PolicyViolationError, enforcePolicy, resolveOperationId } from "./policy.js";
import { redactSecrets } from "./config.js";

program
  .name("ghl")
  .description("GoHighLevel CLI — CRM operations from the terminal")
  .version("0.1.0");

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
program.hook("preAction", (_thisCommand, actionCommand) => {
  const group = actionCommand.parent?.name() ?? actionCommand.name();
  const operationId = resolveOperationId(
    group,
    actionCommand.name(),
    actionCommand.opts(),
  );
  try {
    enforcePolicy(operationId);
  } catch (err) {
    if (err instanceof PolicyViolationError) {
      console.error(`Blocked by policy: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
});

program.parseAsync().catch((err) => {
  if (err.response?.data) {
    console.error(redactSecrets(JSON.stringify(err.response.data, null, 2)));
  } else {
    console.error(redactSecrets(String(err.message || err)));
  }
  process.exit(1);
});
