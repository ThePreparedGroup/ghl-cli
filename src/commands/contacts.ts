import { Command } from "commander";
import { GhlClient } from "../client.js";
import { getLocationId, getToken } from "../config.js";
import { print } from "../output.js";
import {
  diffContactUpdate,
  formatFieldDiff,
  formatResolvedContact,
  resolveContact,
} from "../resolvers.js";

const client = () => new GhlClient(getToken(), getLocationId());

export const contactsCommand = new Command("contacts").description(
  "Manage contacts",
);

// Sprint 5 (Epic 1.5): contact deletion via the API is prohibited. This tag
// is applied instead so a human can review and remove the contact through a
// separate, deliberate process.
const PENDING_DELETION_TAG = "pending-deletion";

contactsCommand
  .command("list")
  .description("Search/list contacts")
  .option("-q, --query <query>", "Search query")
  .option("-l, --limit <n>", "Limit results", "25")
  .option("--after <id>", "Start after this contact ID (pagination)")
  .option("--json", "Output raw JSON")
  .action(async (opts) => {
    const params: Record<string, string> = {
      limit: opts.limit,
    };
    if (opts.query) params.query = opts.query;
    if (opts.after) params.startAfterId = opts.after;
    const data = await client().searchContacts(params);
    print(data.contacts ?? data, opts, "contacts");
  });

contactsCommand
  .command("get <id>")
  .description("Get a contact by ID")
  .option("--json", "Output raw JSON")
  .action(async (id, opts) => {
    const data = await client().getContact(id);
    print(data.contact ?? data, opts, "contacts");
  });

contactsCommand
  .command("create")
  .description("Create a new contact")
  .requiredOption("--email <email>", "Email address")
  .option("--firstName <name>", "First name")
  .option("--lastName <name>", "Last name")
  .option("--phone <phone>", "Phone number")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output raw JSON")
  .action(async (opts) => {
    const body: Record<string, unknown> = {};
    if (opts.email) body.email = opts.email;
    if (opts.firstName) body.firstName = opts.firstName;
    if (opts.lastName) body.lastName = opts.lastName;
    if (opts.phone) body.phone = opts.phone;
    if (opts.tags) body.tags = opts.tags.split(",");
    const data = await client().createContact(body);
    print(data.contact ?? data, opts, "contacts");
  });

contactsCommand
  .command("update <contact>")
  .description("Update a contact (accepts a contact ID or a name/email search term)")
  .option("--email <email>", "Email address")
  .option("--firstName <name>", "First name")
  .option("--lastName <name>", "Last name")
  .option("--phone <phone>", "Phone number")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output raw JSON")
  .action(async (contact, opts) => {
    if (!opts.email && !opts.firstName && !opts.lastName && !opts.phone && !opts.tags) {
      console.error(
        "Refusing to send an empty update: pass at least one of --email, --firstName, --lastName, --phone, --tags.",
      );
      process.exit(1);
    }

    const resolved = await resolveContact(client(), contact);
    console.error(`Target: ${formatResolvedContact(resolved)}`);

    const diffs = diffContactUpdate(resolved.raw, opts);
    if (diffs.length === 0) {
      console.error("No changes: every field passed already matches the current value.");
      process.exit(0);
    }
    console.error("Fields changing:");
    for (const diff of diffs) console.error(formatFieldDiff(diff));

    const body: Record<string, unknown> = {};
    if (opts.email) body.email = opts.email;
    if (opts.firstName) body.firstName = opts.firstName;
    if (opts.lastName) body.lastName = opts.lastName;
    if (opts.phone) body.phone = opts.phone;
    if (opts.tags) body.tags = opts.tags.split(",");
    const data = await client().updateContact(resolved.id, body);
    print(data.contact ?? data, opts, "contacts");
  });

contactsCommand
  .command("delete <contact>")
  .description(
    "Mark a contact for deletion (accepts a contact ID or a name/email search term; API deletion is prohibited — adds a tag instead; see docs/command-inventory.md)",
  )
  .option("--json", "Output raw JSON")
  .action(async (contact, opts) => {
    const resolved = await resolveContact(client(), contact);
    console.error(`Target: ${formatResolvedContact(resolved)}`);
    const data = await client().addContactTags(resolved.id, [PENDING_DELETION_TAG]);
    console.error(
      `Contact ${resolved.id} tagged "${PENDING_DELETION_TAG}". API deletion of contacts is prohibited by policy — actual removal is a separate, manually reviewed step.`,
    );
    print(data, opts);
  });

contactsCommand
  .command("tag <contact>")
  .description("Add or remove tags on a contact (accepts a contact ID or a name/email search term)")
  .requiredOption("--add <tags>", "Comma-separated tags to add")
  .option("--remove <tags>", "Comma-separated tags to remove")
  .option("--json", "Output raw JSON")
  .action(async (contact, opts) => {
    const resolved = await resolveContact(client(), contact);
    console.error(`Target: ${formatResolvedContact(resolved)}`);
    if (opts.add) {
      const data = await client().addContactTags(resolved.id, opts.add.split(","));
      print(data, opts);
    }
    if (opts.remove) {
      const data = await client().removeContactTags(resolved.id, opts.remove.split(","));
      print(data, opts);
    }
  });

contactsCommand
  .command("note <contact>")
  .description("List or add notes on a contact (accepts a contact ID or a name/email search term)")
  .option("--add <text>", "Add a note with this text")
  .option("--json", "Output raw JSON")
  .action(async (contact, opts) => {
    const resolved = await resolveContact(client(), contact);
    console.error(`Target: ${formatResolvedContact(resolved)}`);
    if (opts.add) {
      const data = await client().createContactNote(resolved.id, opts.add);
      print(data, opts);
    } else {
      const data = await client().getContactNotes(resolved.id);
      print(data.notes ?? data, opts);
    }
  });

contactsCommand
  .command("upsert")
  .description("Create or update a contact (matches on email/phone)")
  .requiredOption("--email <email>", "Email address")
  .option("--firstName <name>", "First name")
  .option("--lastName <name>", "Last name")
  .option("--phone <phone>", "Phone number")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--json", "Output raw JSON")
  .action(async (opts) => {
    const body: Record<string, unknown> = {};
    if (opts.email) body.email = opts.email;
    if (opts.firstName) body.firstName = opts.firstName;
    if (opts.lastName) body.lastName = opts.lastName;
    if (opts.phone) body.phone = opts.phone;
    if (opts.tags) body.tags = opts.tags.split(",");
    const data = await client().upsertContact(body);
    print(data.contact ?? data, opts, "contacts");
  });

contactsCommand
  .command("tasks <contact>")
  .description("List or create tasks on a contact (accepts a contact ID or a name/email search term)")
  .option("--add <title>", "Create a task with this title")
  .option("--due <date>", "Due date (ISO 8601)")
  .option("--description <text>", "Task description")
  .option("--json", "Output raw JSON")
  .action(async (contact, opts) => {
    const resolved = await resolveContact(client(), contact);
    console.error(`Target: ${formatResolvedContact(resolved)}`);
    if (opts.add) {
      const body: Record<string, unknown> = { title: opts.add, completed: false };
      if (opts.due) body.dueDate = opts.due;
      if (opts.description) body.description = opts.description;
      const data = await client().createContactTask(resolved.id, body);
      print(data, opts);
    } else {
      const data = await client().getContactTasks(resolved.id);
      print(data.tasks ?? data, opts);
    }
  });
