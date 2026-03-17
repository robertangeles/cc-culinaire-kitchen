// @ts-nocheck
/**
 * @module db/migrations/rename-permissions
 *
 * Migration script that renames the "Admin" role to "Administrator",
 * renames several permission keys, and updates all permission
 * descriptions to be more detailed.
 *
 * The script is idempotent: it checks for the old values before
 * attempting each rename, so it can be safely re-run.
 *
 * Usage:
 * ```sh
 * npx tsx src/db/migrations/rename-permissions.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function migrate() {
  console.log("Starting rename-permissions migration...");

  await sql.begin(async (tx) => {
    // -----------------------------------------------------------------
    // Rename role: Admin → Administrator
    // -----------------------------------------------------------------
    const roleResult = await tx`
      UPDATE role
      SET role_name = 'Administrator'
      WHERE role_name = 'Admin'
    `;
    if (roleResult.count > 0) {
      console.log("Renamed role: Admin → Administrator");
    } else {
      console.log("Role 'Admin' not found (already renamed or missing), skipping");
    }

    // -----------------------------------------------------------------
    // Rename permission keys
    // -----------------------------------------------------------------
    const keyRenames: [string, string][] = [
      ["admin:users", "admin:manage-users"],
      ["admin:roles", "admin:manage-roles"],
      ["admin:settings", "admin:manage-settings"],
      ["org:create", "org:create-organisation"],
      ["org:manage", "org:manage-organisation"],
    ];

    for (const [oldKey, newKey] of keyRenames) {
      const result = await tx`
        UPDATE permission
        SET permission_key = ${newKey}
        WHERE permission_key = ${oldKey}
      `;
      if (result.count > 0) {
        console.log(`Renamed permission key: ${oldKey} → ${newKey}`);
      } else {
        console.log(`Permission key '${oldKey}' not found (already renamed or missing), skipping`);
      }
    }

    // -----------------------------------------------------------------
    // Update permission descriptions
    // -----------------------------------------------------------------
    const descriptionUpdates: [string, string][] = [
      ["admin:dashboard", "Access the administrator dashboard and overview"],
      ["admin:manage-users", "View, edit, suspend, and delete user accounts"],
      ["admin:manage-roles", "Create, edit, and delete roles and assign permissions"],
      ["admin:manage-settings", "Manage site settings, prompts, and integrations"],
      ["chat:access", "Access the AI chat functionality"],
      ["chat:unlimited", "Unlimited chat sessions without usage limits"],
      ["org:create-organisation", "Create new organisations"],
      ["org:manage-organisation", "Manage organisation settings and members"],
    ];

    for (const [key, description] of descriptionUpdates) {
      const result = await tx`
        UPDATE permission
        SET permission_description = ${description}
        WHERE permission_key = ${key}
      `;
      if (result.count > 0) {
        console.log(`Updated description for: ${key}`);
      } else {
        console.log(`Permission '${key}' not found for description update, skipping`);
      }
    }
  });

  console.log("Migration complete!");
  await sql.end();
  process.exit(0);
}

migrate().catch(async (err) => {
  console.error("Migration failed:", err);
  await sql.end();
  process.exit(1);
});
