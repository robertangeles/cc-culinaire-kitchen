/**
 * @module db/seed
 *
 * Standalone seed script that populates the `prompt` table with the
 * system prompt read from `prompts/chatbot/systemPrompt.md`.
 *
 * Two rows are inserted per prompt name:
 *   - **active copy** (`default_ind = false`) — the version the app uses
 *     and that admins can edit at runtime.
 *   - **default copy** (`default_ind = true`) — an immutable factory
 *     baseline used for "reset to default" functionality.
 *
 * The script is idempotent: existing rows are skipped, not overwritten.
 *
 * Usage:
 * ```sh
 * npx tsx src/db/seed.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

// Dynamic imports are used so dotenv can load DATABASE_URL before
// the db module attempts to connect.
const { readFile } = await import("fs/promises");
const { join, dirname } = await import("path");
const { fileURLToPath } = await import("url");
const matter = (await import("gray-matter")).default;
const { db } = await import("./index.js");
const { prompt, role, permission, rolePermission } = await import("./schema.js");
const { eq, and } = await import("drizzle-orm");

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the chatbot prompts directory in the monorepo. */
const PROMPTS_DIR = join(__dirname, "../../../../prompts/chatbot");

/**
 * Reads the system prompt markdown file and seeds both the active and
 * default prompt rows into the database. Skips insertion if the rows
 * already exist.
 */
async function seed() {
  console.log("Seeding database...");

  // Read the system prompt markdown and strip front-matter via gray-matter
  const filePath = join(PROMPTS_DIR, "systemPrompt.md");
  const raw = await readFile(filePath, "utf-8");
  const { content } = matter(raw);
  const promptContent = content.trim();

  // --- Active prompt (default_ind = false) ---
  const existing = await db
    .select()
    .from(prompt)
    .where(and(eq(prompt.promptName, "systemPrompt"), eq(prompt.defaultInd, false)));

  if (existing.length === 0) {
    await db.insert(prompt).values({
      promptName: "systemPrompt",
      promptKey: "system-prompt",
      promptBody: promptContent,
      defaultInd: false,
    });
    console.log("Inserted active systemPrompt");
  } else {
    console.log("Active systemPrompt already exists, skipping");
  }

  // --- Default / factory-baseline prompt (default_ind = true) ---
  const existingDefault = await db
    .select()
    .from(prompt)
    .where(and(eq(prompt.promptName, "systemPrompt"), eq(prompt.defaultInd, true)));

  if (existingDefault.length === 0) {
    await db.insert(prompt).values({
      promptName: "systemPrompt",
      promptKey: "system-prompt",
      promptBody: promptContent,
      defaultInd: true,
    });
    console.log("Inserted default systemPrompt");
  } else {
    console.log("Default systemPrompt already exists, skipping");
  }

  // -----------------------------------------------------------------
  // Seed default roles
  // -----------------------------------------------------------------
  const defaultRoles = [
    { roleName: "Administrator", roleDescription: "Full system access" },
    { roleName: "Subscriber", roleDescription: "Default role after email verification (free tier)" },
    { roleName: "Paid Subscriber", roleDescription: "Paid subscription tier with unlimited access" },
  ];

  for (const r of defaultRoles) {
    const exists = await db
      .select()
      .from(role)
      .where(eq(role.roleName, r.roleName));
    if (exists.length === 0) {
      await db.insert(role).values(r);
      console.log(`Inserted role: ${r.roleName}`);
    } else {
      console.log(`Role ${r.roleName} already exists, skipping`);
    }
  }

  // -----------------------------------------------------------------
  // Seed default permissions
  // -----------------------------------------------------------------
  const defaultPermissions = [
    { permissionKey: "admin:dashboard", permissionDescription: "Access the administrator dashboard and overview" },
    { permissionKey: "admin:manage-users", permissionDescription: "View, edit, suspend, and delete user accounts" },
    { permissionKey: "admin:manage-roles", permissionDescription: "Create, edit, and delete roles and assign permissions" },
    { permissionKey: "admin:manage-settings", permissionDescription: "Manage site settings, prompts, and integrations" },
    { permissionKey: "chat:access", permissionDescription: "Access the AI chat functionality" },
    { permissionKey: "chat:unlimited", permissionDescription: "Unlimited chat sessions without usage limits" },
    { permissionKey: "org:create-organisation", permissionDescription: "Create new organisations" },
    { permissionKey: "org:manage-organisation", permissionDescription: "Manage organisation settings and members" },
  ];

  for (const p of defaultPermissions) {
    const exists = await db
      .select()
      .from(permission)
      .where(eq(permission.permissionKey, p.permissionKey));
    if (exists.length === 0) {
      await db.insert(permission).values(p);
      console.log(`Inserted permission: ${p.permissionKey}`);
    } else {
      console.log(`Permission ${p.permissionKey} already exists, skipping`);
    }
  }

  // -----------------------------------------------------------------
  // Seed role-permission mappings
  // -----------------------------------------------------------------
  const rolePermMappings: Record<string, string[]> = {
    Administrator: [
      "admin:dashboard", "admin:manage-users", "admin:manage-roles", "admin:manage-settings",
      "chat:access", "chat:unlimited", "org:create-organisation", "org:manage-organisation",
    ],
    Subscriber: ["chat:access", "org:create-organisation"],
    "Paid Subscriber": ["chat:access", "chat:unlimited", "org:create-organisation", "org:manage-organisation"],
  };

  const allRoles = await db.select().from(role);
  const allPerms = await db.select().from(permission);
  const existingRolePerms = await db.select().from(rolePermission);

  for (const [roleName, permKeys] of Object.entries(rolePermMappings)) {
    const r = allRoles.find((row) => row.roleName === roleName);
    if (!r) continue;

    for (const pk of permKeys) {
      const p = allPerms.find((row) => row.permissionKey === pk);
      if (!p) continue;

      const alreadyLinked = existingRolePerms.some(
        (rp) => rp.roleId === r.roleId && rp.permissionId === p.permissionId,
      );
      if (!alreadyLinked) {
        await db.insert(rolePermission).values({
          roleId: r.roleId,
          permissionId: p.permissionId,
        });
        console.log(`Linked ${roleName} → ${pk}`);
      }
    }
  }

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
