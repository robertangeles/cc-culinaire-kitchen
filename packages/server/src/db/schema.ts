/**
 * @module db/schema
 *
 * Drizzle ORM table definitions for the CulinAIre Kitchen database.
 * Each export defines a PostgreSQL table and its columns, used by
 * Drizzle for type-safe queries and by drizzle-kit for migrations.
 *
 * Naming conventions:
 * - Table names are **singular** (e.g. `prompt`, not `prompts`).
 * - Boolean columns use the `_ind` suffix (indicator).
 * - Timestamp columns use the `_dttm` suffix.
 */

import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  customType,
} from "drizzle-orm/pg-core";

/**
 * pgvector column type (1536 dimensions — OpenAI text-embedding-3-small).
 * Stored as a PostgreSQL `vector` type; retrieved as a number array.
 * All vector similarity operations are performed via raw SQL (`<=>` operator).
 */
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  fromDriver(value: string) {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(Number);
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
});

/**
 * The `prompt` table stores system prompt templates used by the AI chatbot.
 *
 * Each prompt has a name (e.g. "systemPrompt") and a body containing the
 * full prompt text. The `default_ind` flag distinguishes the immutable
 * factory-default prompt from the active (editable) copy.
 *
 * @example
 * ```ts
 * import { prompt } from "./schema.js";
 * const rows = await db.select().from(prompt);
 * ```
 */
export const prompt = pgTable("prompt", {
  promptId: serial("prompt_id").primaryKey(),
  promptName: varchar("prompt_name", { length: 100 }).notNull(),
  promptKey: varchar("prompt_key", { length: 100 }),
  promptBody: text("prompt_body").notNull(),
  defaultInd: boolean("default_ind").notNull().default(false),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `prompt_version` table stores historical snapshots of prompt content.
 *
 * A new version row is created every time a prompt is saved. The history
 * is capped at 7 entries per prompt; the oldest is pruned when a new
 * one would exceed the cap. Versions can be rolled back to restore previous
 * prompt content.
 *
 * Linked to `prompt` via `prompt_id` foreign key for efficient integer joins.
 */
export const promptVersion = pgTable("prompt_version", {
  versionId: serial("version_id").primaryKey(),
  promptId: integer("prompt_id").notNull(),
  promptBody: text("prompt_body").notNull(),
  versionNumber: integer("version_number").notNull(),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * The `conversation` table stores chat conversation metadata.
 *
 * Each conversation is identified by a client-generated UUID and has a
 * title auto-derived from the first user message. The `updated_dttm`
 * column is refreshed on every new message so conversations can be
 * sorted by most-recently-active.
 */
export const conversation = pgTable("conversation", {
  conversationId: varchar("conversation_id", { length: 36 }).primaryKey(),
  conversationTitle: varchar("conversation_title", { length: 200 }).notNull(),
  userId: integer("user_id"),
  guestSessionToken: varchar("guest_session_token", { length: 255 }),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `message` table stores individual chat messages within a conversation.
 *
 * Linked to `conversation` via `conversation_id` FK with application-level
 * cascade delete. Messages are ordered within a conversation by
 * `message_sequence`.
 */
export const message = pgTable("message", {
  messageId: varchar("message_id", { length: 36 }).primaryKey(),
  conversationId: varchar("conversation_id", { length: 36 }).notNull(),
  messageRole: varchar("message_role", { length: 20 }).notNull(),
  messageBody: text("message_body").notNull(),
  messageSequence: integer("message_sequence").notNull(),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * The `site_setting` table stores application-wide configuration as
 * key-value pairs. This design avoids migrations when new settings are
 * added — simply insert a new row with the desired key.
 *
 * Known keys: `page_title`, `meta_description`, `robots_meta`,
 * `favicon_path`, `logo_path`, `footer_text`, `chat_window_width`.
 */
export const siteSetting = pgTable("site_setting", {
  settingId: serial("setting_id").primaryKey(),
  settingKey: varchar("setting_key", { length: 100 }).notNull().unique(),
  settingValue: text("setting_value").notNull().default(""),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Auth & User Management Tables
// ---------------------------------------------------------------------------

/**
 * The `user` table stores registered user accounts.
 *
 * `user_password_hash` is nullable because OAuth-only users have no password.
 * `free_sessions` tracks remaining free chat sessions before an upgrade is
 * required. Subscription fields map to Stripe for payment tracking.
 */
export const user = pgTable("user", {
  userId: serial("user_id").primaryKey(),
  userName: varchar("user_name", { length: 100 }).notNull(),
  userEmail: varchar("user_email", { length: 255 }).notNull().unique(),
  userPasswordHash: varchar("user_password_hash", { length: 255 }),
  emailVerifiedInd: boolean("email_verified_ind").notNull().default(false),
  mfaEnabledInd: boolean("mfa_enabled_ind").notNull().default(false),
  mfaSecret: varchar("mfa_secret", { length: 255 }),
  userPhotoPath: varchar("user_photo_path", { length: 500 }),
  freeSessions: integer("free_sessions").notNull().default(5),
  subscriptionStatus: varchar("subscription_status", { length: 20 }).notNull().default("free"),
  subscriptionTier: varchar("subscription_tier", { length: 20 }).notNull().default("free"),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
  stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
  currentPeriodEndDttm: timestamp("current_period_end_dttm"),
  userBio: varchar("user_bio", { length: 300 }),
  userAddressLine1: varchar("user_address_line1", { length: 200 }),
  userAddressLine2: varchar("user_address_line2", { length: 200 }),
  userSuburb: varchar("user_suburb", { length: 100 }),
  userState: varchar("user_state", { length: 100 }),
  userCountry: varchar("user_country", { length: 100 }),
  userPostcode: varchar("user_postcode", { length: 20 }),
  // PII encryption columns (AES-256-GCM)
  userNameEnc: text("user_name_enc"),
  userNameIv: varchar("user_name_iv", { length: 24 }),
  userNameTag: varchar("user_name_tag", { length: 32 }),
  userEmailEnc: text("user_email_enc"),
  userEmailIv: varchar("user_email_iv", { length: 24 }),
  userEmailTag: varchar("user_email_tag", { length: 32 }),
  userEmailHash: varchar("user_email_hash", { length: 64 }),
  userBioEnc: text("user_bio_enc"),
  userBioIv: varchar("user_bio_iv", { length: 24 }),
  userBioTag: varchar("user_bio_tag", { length: 32 }),
  userAddressEnc: text("user_address_enc"),
  userAddressIv: varchar("user_address_iv", { length: 24 }),
  userAddressTag: varchar("user_address_tag", { length: 32 }),
  // Social media URLs (public-facing, no encryption needed)
  userFacebook: varchar("user_facebook", { length: 500 }),
  userInstagram: varchar("user_instagram", { length: 500 }),
  userTiktok: varchar("user_tiktok", { length: 500 }),
  userPinterest: varchar("user_pinterest", { length: 500 }),
  userLinkedin: varchar("user_linkedin", { length: 500 }),
  userStatus: varchar("user_status", { length: 20 }).notNull().default("active"),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `role` table defines permission groupings such as Admin, Subscriber,
 * and Paid Subscriber. Custom roles can be created by admins.
 */
export const role = pgTable("role", {
  roleId: serial("role_id").primaryKey(),
  roleName: varchar("role_name", { length: 50 }).notNull().unique(),
  roleDescription: text("role_description"),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * Many-to-many join table linking users to their assigned roles.
 */
export const userRole = pgTable("user_role", {
  userRoleId: serial("user_role_id").primaryKey(),
  userId: integer("user_id").notNull(),
  roleId: integer("role_id").notNull(),
});

/**
 * The `permission` table defines fine-grained access controls.
 *
 * Permissions use a namespaced key format: `admin:users`, `chat:access`, etc.
 * Roles are assigned sets of permissions via the `role_permission` join table.
 */
export const permission = pgTable("permission", {
  permissionId: serial("permission_id").primaryKey(),
  permissionKey: varchar("permission_key", { length: 100 }).notNull().unique(),
  permissionDescription: text("permission_description"),
});

/**
 * Many-to-many join table linking roles to their granted permissions.
 */
export const rolePermission = pgTable("role_permission", {
  rolePermissionId: serial("role_permission_id").primaryKey(),
  roleId: integer("role_id").notNull(),
  permissionId: integer("permission_id").notNull(),
});

/**
 * The `organisation` table stores organisation profiles.
 *
 * Users can create an organisation or join an existing one using the
 * unique `join_key`. The creator is tracked via `created_by`.
 */
export const organisation = pgTable("organisation", {
  organisationId: serial("organisation_id").primaryKey(),
  organisationName: varchar("organisation_name", { length: 200 }).notNull(),
  organisationAddressLine1: varchar("organisation_address_line1", { length: 200 }),
  organisationAddressLine2: varchar("organisation_address_line2", { length: 200 }),
  organisationSuburb: varchar("organisation_suburb", { length: 100 }),
  organisationState: varchar("organisation_state", { length: 100 }),
  organisationCountry: varchar("organisation_country", { length: 100 }),
  organisationPostcode: varchar("organisation_postcode", { length: 20 }),
  organisationWebsite: varchar("organisation_website", { length: 500 }),
  organisationEmail: varchar("organisation_email", { length: 255 }),
  // PII encryption columns
  orgNameEnc: text("org_name_enc"),
  orgNameIv: varchar("org_name_iv", { length: 24 }),
  orgNameTag: varchar("org_name_tag", { length: 32 }),
  orgEmailEnc: text("org_email_enc"),
  orgEmailIv: varchar("org_email_iv", { length: 24 }),
  orgEmailTag: varchar("org_email_tag", { length: 32 }),
  orgAddressEnc: text("org_address_enc"),
  orgAddressIv: varchar("org_address_iv", { length: 24 }),
  orgAddressTag: varchar("org_address_tag", { length: 32 }),
  // Social media URLs (public-facing, no encryption needed)
  organisationFacebook: varchar("organisation_facebook", { length: 500 }),
  organisationInstagram: varchar("organisation_instagram", { length: 500 }),
  organisationTiktok: varchar("organisation_tiktok", { length: 500 }),
  organisationPinterest: varchar("organisation_pinterest", { length: 500 }),
  organisationLinkedin: varchar("organisation_linkedin", { length: 500 }),
  joinKey: varchar("join_key", { length: 25 }).notNull().unique(),
  createdBy: integer("created_by").notNull(),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * Many-to-many join table linking users to organisations.
 */
export const userOrganisation = pgTable("user_organisation", {
  userOrganisationId: serial("user_organisation_id").primaryKey(),
  userId: integer("user_id").notNull(),
  organisationId: integer("organisation_id").notNull(),
});

/**
 * The `oauth_account` table links external OAuth providers (Google,
 * Microsoft) to user accounts. A user may have multiple linked providers.
 */
export const oauthAccount = pgTable("oauth_account", {
  oauthAccountId: serial("oauth_account_id").primaryKey(),
  userId: integer("user_id").notNull(),
  oauthProvider: varchar("oauth_provider", { length: 20 }).notNull(),
  oauthProviderId: varchar("oauth_provider_id", { length: 255 }).notNull(),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * The `refresh_token` table stores hashed JWT refresh tokens for session
 * management. Tokens can be revoked by deleting the row (logout, password
 * change, etc.).
 */
export const refreshToken = pgTable("refresh_token", {
  refreshTokenId: serial("refresh_token_id").primaryKey(),
  userId: integer("user_id").notNull(),
  tokenHash: varchar("token_hash", { length: 255 }).notNull(),
  expiresAtDttm: timestamp("expires_at_dttm").notNull(),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * The `email_verification` table stores one-time tokens sent to users
 * for email verification during registration.
 */
export const emailVerification = pgTable("email_verification", {
  emailVerificationId: serial("email_verification_id").primaryKey(),
  userId: integer("user_id").notNull(),
  verificationToken: varchar("verification_token", { length: 255 }).notNull(),
  expiresAtDttm: timestamp("expires_at_dttm").notNull(),
  usedInd: boolean("used_ind").notNull().default(false),
});

/**
 * The `credential` table stores encrypted integration credentials
 * (API keys, OAuth secrets) using AES-256-GCM. Unlike `site_setting`,
 * this table is never exposed through the public settings GET endpoint.
 *
 * The `credential_key` maps to the env var name (e.g. `GOOGLE_CLIENT_ID`).
 * The `credential_value` holds the hex-encoded ciphertext, while
 * `credential_iv` and `credential_tag` hold the GCM parameters needed
 * for decryption.
 */
/**
 * The `password_reset` table stores one-time tokens for email-based
 * password reset. Tokens expire after 1 hour and can only be used once.
 */
export const passwordReset = pgTable("password_reset", {
  passwordResetId: serial("password_reset_id").primaryKey(),
  userId: integer("user_id").notNull(),
  resetToken: varchar("reset_token", { length: 255 }).notNull(),
  expiresAtDttm: timestamp("expires_at_dttm").notNull(),
  usedInd: boolean("used_ind").notNull().default(false),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

export const credential = pgTable("credential", {
  credentialId: serial("credential_id").primaryKey(),
  credentialKey: varchar("credential_key", { length: 100 }).notNull().unique(),
  credentialValue: text("credential_value").notNull(),
  credentialIv: varchar("credential_iv", { length: 32 }).notNull(),
  credentialTag: varchar("credential_tag", { length: 32 }).notNull(),
  credentialCategory: varchar("credential_category", { length: 30 }).notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  updatedBy: integer("updated_by"),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `knowledge_document` table stores curated culinary knowledge base
 * documents with their vector embeddings for semantic (RAG) search.
 *
 * Populated at server startup by `syncDocuments()` in knowledgeService.
 * The `content_hash` column (SHA-256 of file contents) allows the sync
 * to skip documents that have not changed since they were last embedded.
 * The `embedding` column holds a 1536-dimensional OpenAI embedding vector;
 * cosine similarity search is performed via the `<=>` pgvector operator.
 */
export const knowledgeDocument = pgTable("knowledge_document", {
  documentId: serial("document_id").primaryKey(),
  filePath: varchar("file_path", { length: 500 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  tags: text("tags").array().notNull().default([]),
  body: text("body").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  embedding: vector1536("embedding"),
  embeddedAtDttm: timestamp("embedded_at"),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `kitchen_profile` table stores each user's culinary preferences.
 *
 * Populated via the My Kitchen onboarding wizard shown after first login,
 * and editable from the Profile → My Kitchen tab at any time.
 * The profile is injected as context into every AI chat and recipe request
 * so that responses are personalised to the user's skill level, equipment,
 * and dietary restrictions.
 *
 * `onboarding_done_ind` is set to TRUE once the user completes or skips
 * the wizard so it is never shown again.
 */
export const kitchenProfile = pgTable("kitchen_profile", {
  kitchenProfileId: serial("kitchen_profile_id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  skillLevel: varchar("skill_level", { length: 50 }).notNull().default("home_cook"),
  cuisinePreferences: text("cuisine_preferences").array().notNull().default([]),
  dietaryRestrictions: text("dietary_restrictions").array().notNull().default([]),
  kitchenEquipment: text("kitchen_equipment").array().notNull().default([]),
  servingsDefault: integer("servings_default").notNull().default(4),
  onboardingDoneInd: boolean("onboarding_done_ind").notNull().default(false),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `guest_session` table tracks anonymous guest users who can
 * chat without registering. Each session is identified by a UUID
 * token stored in the client's localStorage. Limited to 10 conversations.
 */
export const guestSession = pgTable("guest_session", {
  guestSessionId: serial("guest_session_id").primaryKey(),
  sessionToken: varchar("session_token", { length: 255 }).notNull().unique(),
  ipAddress: varchar("ip_address", { length: 45 }),
  sessionsUsed: integer("sessions_used").notNull().default(0),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  lastActiveDttm: timestamp("last_active_dttm").notNull().defaultNow(),
});
