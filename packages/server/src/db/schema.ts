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
  uniqueIndex,
  index,
  jsonb,
  uuid,
  smallint,
  numeric,
  date,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  modelId: varchar("model_id", { length: 150 }),
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
  modelId: varchar("model_id", { length: 150 }),
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
  // Active store location selection (persisted for cross-device consistency)
  selectedLocationId: uuid("selected_location_id"),
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
  role: varchar("role", { length: 20 }).default("member").notNull(),
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
 * The `model_option` table stores the admin-curated list of AI models
 * available for selection in prompt configurations.
 *
 * Models are sourced from OpenRouter's catalog and selectively enabled
 * by the admin via the AI Configuration → Model Registry tab. Only rows
 * with `enabled_ind = true` appear in the per-prompt model dropdown.
 *
 * Pricing fields (`input_cost_per_m`, `output_cost_per_m`) are stored as
 * NUMERIC to preserve decimal precision and represent USD cost per 1 million
 * tokens. These are synced from OpenRouter's `/models` endpoint.
 *
 * OLTP table, 2NF — every non-key column depends solely on the PK.
 * Every FK (none currently) would have an index.
 */
export const modelOption = pgTable("model_option", {
  modelOptionId: serial("model_option_id").primaryKey(),
  modelId: varchar("model_id", { length: 150 }).notNull().unique(),
  displayName: varchar("display_name", { length: 200 }).notNull(),
  provider: varchar("provider", { length: 80 }).notNull(),
  category: varchar("category", { length: 30 }).notNull().default("chat"),
  contextLength: integer("context_length"),
  inputCostPerM: numeric("input_cost_per_m", { precision: 10, scale: 4 }),
  outputCostPerM: numeric("output_cost_per_m", { precision: 10, scale: 4 }),
  sortOrder: integer("sort_order").notNull().default(0),
  enabledInd: boolean("enabled_ind").notNull().default(true),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `knowledge_document` table stores curated culinary knowledge base
 * documents managed via the admin Knowledge Base tab.
 *
 * Documents are ingested from multiple sources (PDF, DOCX, TXT, MD, URL,
 * manual text entry). The full extracted text is stored in `body`, while
 * individual chunks with embeddings live in `knowledge_chunk`.
 *
 * The `content_hash` (SHA-256 of extracted text) detects duplicates.
 * Source metadata (`source_url`, `original_filename`) is admin-only and
 * is NEVER exposed to the AI or end users — all knowledge is presented
 * as internally curated.
 *
 * Status flow: processing → ready | failed
 */
export const knowledgeDocument = pgTable("knowledge_document", {
  documentId: serial("document_id").primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  tags: text("tags").array().notNull().default([]),
  body: text("body").notNull(),
  contentHash: varchar("content_hash", { length: 64 }).notNull(),
  sourceType: varchar("source_type", { length: 20 }).notNull().default("manual"),
  sourceUrl: varchar("source_url", { length: 2000 }),
  originalFilename: varchar("original_filename", { length: 500 }),
  fileSizeBytes: integer("file_size_bytes"),
  chunkCount: integer("chunk_count").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("processing"),
  errorMessage: text("error_message"),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `knowledge_chunk` table stores text segments of knowledge documents
 * with their vector embeddings for semantic (RAG) search.
 *
 * Each document is split into ~1000-token chunks with 200-token overlap
 * for context continuity. Search queries are embedded and compared against
 * chunk embeddings via cosine similarity (`<=>` pgvector operator).
 *
 * Linked to `knowledge_document` via `document_id` with CASCADE delete —
 * deleting a document automatically removes all its chunks.
 */
export const knowledgeChunk = pgTable("knowledge_chunk", {
  chunkId: serial("chunk_id").primaryKey(),
  documentId: integer("document_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  embedding: vector1536("embedding"),
  embeddedAtDttm: timestamp("embedded_at"),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
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
  // Restaurant / business profile fields
  restaurantName: varchar("restaurant_name", { length: 200 }),
  establishmentType: varchar("establishment_type", { length: 50 }),
  cuisineIdentity: varchar("cuisine_identity", { length: 200 }),
  targetDiner: varchar("target_diner", { length: 200 }),
  pricePoint: varchar("price_point", { length: 20 }),
  restaurantVoice: varchar("restaurant_voice", { length: 200 }),
  sourcingValues: text("sourcing_values").array().default([]),
  platingStyle: varchar("plating_style", { length: 20 }),
  kitchenConstraints: text("kitchen_constraints").array().default([]),
  menuNeeds: text("menu_needs").array().default([]),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `kitchen_profile_option` table stores the admin-managed set of
 * selectable options for each personalization dimension.
 *
 * option_type values: 'skill_level' | 'cuisine' | 'dietary' | 'equipment'
 *
 * Admins can add, edit, or remove options via Settings → Personalisation
 * without a code deploy. The KitchenWizard and My Kitchen tab fetch
 * active options from the API at runtime.
 */
export const kitchenProfileOption = pgTable(
  "kitchen_profile_option",
  {
    optionId:          serial("option_id").primaryKey(),
    optionType:        varchar("option_type", { length: 50 }).notNull(),
    optionValue:       varchar("option_value", { length: 100 }).notNull(),
    optionLabel:       varchar("option_label", { length: 200 }).notNull(),
    optionDescription: varchar("option_description", { length: 500 }),
    sortOrder:         integer("sort_order").notNull().default(0),
    activeInd:         boolean("active_ind").notNull().default(true),
    createdDttm:       timestamp("created_dttm").notNull().defaultNow(),
    updatedDttm:       timestamp("updated_dttm").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_kpo_type_value").on(table.optionType, table.optionValue),
  ]
);

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

/**
 * The `recipe` table persists generated recipes for the Recipe Lab.
 *
 * Each recipe has a UUID primary key (used as the shareable URL slug).
 * The `recipe_data` JSONB column stores the full structured output
 * (ingredients, steps, flavor balance, nutrition, etc.) while
 * `editorial_content` holds the rich markdown for PDF/email/social.
 *
 * Recipes can be made public (`is_public_ind`) to appear in the
 * Recipe Lab Gallery. Admins can feature recipes (`gallery_featured_ind`).
 *
 * The `kitchen_context` snapshot captures the user's profile at generation
 * time so the recipe's personalization is preserved even if the user
 * later changes their profile.
 */
export const recipe = pgTable("recipe", {
  recipeId: uuid("recipe_id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 400 }).unique(),
  userId: integer("user_id"),
  domain: varchar("domain", { length: 20 }).notNull().default("recipe"),
  title: varchar("title", { length: 300 }).notNull(),
  description: text("description"),
  recipeData: jsonb("recipe_data").notNull(),
  editorialContent: text("editorial_content"),
  imageUrl: varchar("image_url", { length: 500 }),
  imagePrompt: text("image_prompt"),
  kitchenContext: text("kitchen_context"),
  requestParams: jsonb("request_params"),
  isPublicInd: boolean("is_public_ind").notNull().default(false),
  galleryFeaturedInd: boolean("gallery_featured_ind").notNull().default(false),
  archivedInd: boolean("archived_ind").notNull().default(false),
  archivedAtDttm: timestamp("archived_at"),
  viewCount: integer("view_count").notNull().default(0),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `recipe_version` table stores versioned snapshots of recipe content
 * for the Recipe Editor. Each edit (manual, AI refinement, or revert)
 * creates a new version row so users can browse history and roll back.
 *
 * `recipe_data` is a full JSONB snapshot of the recipe at that point in time.
 * `change_type` categorises the edit: "original", "manual", "ai_refinement", "revert".
 */
export const recipeVersion = pgTable("recipe_version", {
  versionId: uuid("version_id").defaultRandom().primaryKey(),
  recipeId: uuid("recipe_id").notNull().references(() => recipe.recipeId),
  versionNumber: integer("version_number").notNull(),
  recipeData: jsonb("recipe_data").notNull(),
  editorialContent: text("editorial_content"),
  changeDescription: text("change_description"),
  changedBy: integer("changed_by").references(() => user.userId),
  changeType: varchar("change_type", { length: 20 }).notNull(), // "original" | "manual" | "ai_refinement" | "revert"
  createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * The `recipe_rating` table stores per-user star ratings (1-5) for recipes.
 * One rating per user per recipe (upsert on conflict).
 */
export const recipeRating = pgTable(
  "recipe_rating",
  {
    ratingId: serial("rating_id").primaryKey(),
    recipeId: uuid("recipe_id").notNull(),
    userId: integer("user_id").notNull(),
    rating: smallint("rating").notNull(),
    createdDttm: timestamp("created_dttm").notNull().defaultNow(),
    updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_recipe_rating_unique").on(table.recipeId, table.userId),
  ],
);

/**
 * The `recipe_review` table stores text reviews for recipes.
 * Each review is tied to the user's star rating.
 */
export const recipeReview = pgTable("recipe_review", {
  reviewId: serial("review_id").primaryKey(),
  recipeId: uuid("recipe_id").notNull(),
  userId: integer("user_id").notNull(),
  userName: varchar("user_name", { length: 100 }).notNull(),
  reviewTitle: varchar("review_title", { length: 200 }),
  reviewBody: text("review_body").notNull(),
  rating: smallint("rating").notNull(),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// The Bench — Community Chat
// ---------------------------------------------------------------------------

/**
 * The `bench_channel` table defines chat channels.
 * "everyone" is a global channel for all registered users.
 * Organisation channels are created on demand (one per org).
 */
export const benchChannel = pgTable("bench_channel", {
  channelId: serial("channel_id").primaryKey(),
  channelKey: varchar("channel_key", { length: 50 }).notNull().unique(),
  channelName: varchar("channel_name", { length: 200 }).notNull(),
  channelType: varchar("channel_type", { length: 20 }).notNull(), // "global" | "organisation"
  organisationId: integer("organisation_id"),
  channelBanner: varchar("channel_banner", { length: 500 }),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * The `bench_message` table stores all community chat messages.
 * Supports text messages and recipe card shares.
 */
export const benchMessage = pgTable("bench_message", {
  messageId: uuid("message_id").defaultRandom().primaryKey(),
  channelId: integer("channel_id"),
  dmThreadId: integer("dm_thread_id"),
  userId: integer("user_id").notNull(),
  messageBody: text("message_body").notNull(),
  messageType: varchar("message_type", { length: 20 }).notNull().default("text"), // "text" | "recipe_share"
  recipeId: uuid("recipe_id"),
  editedInd: boolean("edited_ind").notNull().default(false),
  deletedInd: boolean("deleted_ind").notNull().default(false),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `bench_reaction` table stores emoji reactions on messages.
 * One reaction type per user per message.
 */
export const benchReaction = pgTable(
  "bench_reaction",
  {
    reactionId: serial("reaction_id").primaryKey(),
    messageId: uuid("message_id").notNull(),
    userId: integer("user_id").notNull(),
    emoji: varchar("emoji", { length: 20 }).notNull(),
    createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_bench_reaction_unique").on(table.messageId, table.userId, table.emoji),
  ],
);

/**
 * The `bench_mention` table tracks @mentions for notifications.
 */
export const benchMention = pgTable("bench_mention", {
  mentionId: serial("mention_id").primaryKey(),
  messageId: uuid("message_id").notNull(),
  mentionedUserId: integer("mentioned_user_id").notNull(),
  readInd: boolean("read_ind").notNull().default(false),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * The `bench_pin` table stores pinned messages per channel.
 * Admin-only in organisation channels.
 */
export const benchPin = pgTable("bench_pin", {
  pinId: serial("pin_id").primaryKey(),
  messageId: uuid("message_id").notNull().unique(),
  channelId: integer("channel_id").notNull(),
  pinnedBy: integer("pinned_by").notNull(),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * The `bench_dm_thread` table represents a direct message conversation
 * between two users. user_a_id is always the lower userId to ensure
 * a single unique row per pair.
 */
export const benchDmThread = pgTable(
  "bench_dm_thread",
  {
    dmThreadId: serial("dm_thread_id").primaryKey(),
    userAId: integer("user_a_id").notNull(),
    userBId: integer("user_b_id").notNull(),
    lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
    createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_bench_dm_thread_pair").on(table.userAId, table.userBId),
  ],
);

// ---------------------------------------------------------------------------
// Menu Intelligence
// ---------------------------------------------------------------------------

/**
 * The `menu_item` table stores a user's menu items with calculated
 * cost metrics and menu engineering classification.
 */
export const menuItem = pgTable("menu_item", {
  menuItemId: uuid("menu_item_id").defaultRandom().primaryKey(),
  userId: integer("user_id").notNull(),
  storeLocationId: uuid("store_location_id"),
  name: varchar("name", { length: 200 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  sellingPrice: numeric("selling_price", { precision: 10, scale: 2 }).notNull(),
  foodCost: numeric("food_cost", { precision: 10, scale: 2 }),
  foodCostPct: numeric("food_cost_pct", { precision: 5, scale: 2 }),
  contributionMargin: numeric("contribution_margin", { precision: 10, scale: 2 }),
  unitsSold: integer("units_sold").notNull().default(0),
  menuMixPct: numeric("menu_mix_pct", { precision: 5, scale: 2 }),
  classification: varchar("classification", { length: 20 }).notNull().default("unclassified"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
  updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
});

/**
 * The `menu_item_ingredient` table stores ingredients and their costs
 * for each menu item. Line cost = (quantity × unit_cost) / (yield_pct / 100).
 */
export const menuItemIngredient = pgTable("menu_item_ingredient", {
  id: serial("id").primaryKey(),
  menuItemId: uuid("menu_item_id").notNull(),
  ingredientName: varchar("ingredient_name", { length: 200 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 10, scale: 2 }).notNull(),
  yieldPct: numeric("yield_pct", { precision: 5, scale: 2 }).notNull().default("100"),
  lineCost: numeric("line_cost", { precision: 10, scale: 2 }),
  createdDttm: timestamp("created_dttm").notNull().defaultNow(),
});

/**
 * The `menu_category_setting` table stores configurable target
 * food cost percentage per menu category per user.
 */
export const menuCategorySetting = pgTable(
  "menu_category_setting",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    categoryName: varchar("category_name", { length: 100 }).notNull(),
    targetFoodCostPct: numeric("target_food_cost_pct", { precision: 5, scale: 2 }).notNull().default("30"),
    createdDttm: timestamp("created_dttm").notNull().defaultNow(),
    updatedDttm: timestamp("updated_dttm").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_menu_cat_user").on(table.userId, table.categoryName),
  ],
);

// ---------------------------------------------------------------------------
// Waste Intelligence
// ---------------------------------------------------------------------------

/**
 * The `waste_log` table tracks ingredient waste entries for kitchen
 * waste analysis and AI-powered reuse suggestions.
 *
 * Each entry records what was wasted, how much, estimated cost, and the
 * reason (e.g. spoilage, overproduction, trim). Aggregated via
 * getWasteSummary() for dashboard metrics and trend analysis.
 */
export const wasteLog = pgTable("waste_log", {
  wasteLogId: uuid("waste_log_id").defaultRandom().primaryKey(),
  userId: integer("user_id").notNull().references(() => user.userId),
  organisationId: integer("organisation_id").references(() => organisation.organisationId),
  storeLocationId: uuid("store_location_id"),
  ingredientName: text("ingredient_name").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 2 }),
  reason: varchar("reason", { length: 30 }),
  notes: text("notes"),
  shift: varchar("shift", { length: 20 }),
  loggedAt: timestamp("logged_at", { withTimezone: true }).defaultNow().notNull(),
  createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
  updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Kitchen Operations Copilot Lite
// ---------------------------------------------------------------------------

/**
 * The `prep_session` table tracks daily prep planning sessions.
 *
 * Each session represents a day's prep plan with expected/actual covers
 * and task completion counts. Tasks are generated from the user's recipe
 * library and menu items, prioritised by cross-usage and classification.
 */
export const prepSession = pgTable("prep_session", {
  prepSessionId: uuid("prep_session_id").defaultRandom().primaryKey(),
  userId: integer("user_id").notNull().references(() => user.userId),
  organisationId: integer("organisation_id").references(() => organisation.organisationId),
  storeLocationId: uuid("store_location_id"),
  prepDate: date("prep_date").notNull(),
  expectedCovers: integer("expected_covers"),
  actualCovers: integer("actual_covers"),
  tasksTotal: integer("tasks_total").default(0).notNull(),
  tasksCompleted: integer("tasks_completed").default(0).notNull(),
  tasksSkipped: integer("tasks_skipped").default(0).notNull(),
  notes: text("notes"),
  createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
  updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * The `prep_task` table stores individual prep tasks within a session.
 *
 * Each task is an ingredient-level prep item derived from the user's
 * recipes, with a calculated priority score based on cross-usage,
 * prep time, and menu classification weight.
 */
export const prepTask = pgTable("prep_task", {
  prepTaskId: uuid("prep_task_id").defaultRandom().primaryKey(),
  prepSessionId: uuid("prep_session_id").notNull().references(() => prepSession.prepSessionId),
  userId: integer("user_id").notNull().references(() => user.userId),
  menuItemId: uuid("menu_item_id").references(() => menuItem.menuItemId),
  recipeId: uuid("recipe_id").references(() => recipe.recipeId),
  taskDescription: text("task_description").notNull(),
  ingredientName: varchar("ingredient_name", { length: 200 }).notNull(),
  quantityNeeded: numeric("quantity_needed", { precision: 10, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  prepTimeMinutes: integer("prep_time_minutes"),
  priorityScore: numeric("priority_score", { precision: 8, scale: 2 }).notNull(),
  priorityTier: varchar("priority_tier", { length: 20 }).notNull(),
  station: varchar("station", { length: 50 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  assignedTo: varchar("assigned_to", { length: 100 }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
  updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * The `ingredient_cross_usage` table tracks ingredients used across
 * multiple dishes within a prep session. Helps identify batching
 * opportunities for common ingredients.
 */
// ---------------------------------------------------------------------------
// User Guide
// ---------------------------------------------------------------------------

/**
 * The `guide` table stores admin-managed user guide content for each
 * module (e.g. Waste Intelligence, Kitchen Copilot, Menu Intelligence).
 *
 * Each guide is identified by a unique `guide_key` slug and contains
 * markdown content that is rendered on the frontend. Admins can edit
 * guide content via the admin panel; all authenticated users can read.
 */
export const guide = pgTable("guide", {
  guideId: serial("guide_id").primaryKey(),
  guideKey: varchar("guide_key", { length: 50 }).unique().notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  content: text("content").notNull().default(""),
  updatedBy: integer("updated_by").references(() => user.userId),
  createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
  updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * The `prep_menu_selection` table stores the chef's selected dishes
 * for a prep session. This is the menu-driven approach: instead of
 * auto-generating tasks from all recipes, the chef picks which dishes
 * they're prepping for today.
 */
export const prepMenuSelection = pgTable("prep_menu_selection", {
  selectionId: uuid("selection_id").defaultRandom().primaryKey(),
  prepSessionId: uuid("prep_session_id").notNull().references(() => prepSession.prepSessionId),
  recipeId: uuid("recipe_id").references(() => recipe.recipeId),
  menuItemId: uuid("menu_item_id").references(() => menuItem.menuItemId),
  dishName: varchar("dish_name", { length: 200 }).notNull(),
  expectedPortions: integer("expected_portions").notNull(),
  category: varchar("category", { length: 50 }),
  createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
});

export const ingredientCrossUsage = pgTable("ingredient_cross_usage", {
  crossUsageId: uuid("cross_usage_id").defaultRandom().primaryKey(),
  userId: integer("user_id").notNull().references(() => user.userId),
  prepSessionId: uuid("prep_session_id").notNull().references(() => prepSession.prepSessionId),
  ingredientName: varchar("ingredient_name", { length: 200 }).notNull(),
  dishCount: integer("dish_count").notNull(),
  totalQuantity: numeric("total_quantity", { precision: 10, scale: 3 }).notNull(),
  unit: varchar("unit", { length: 20 }).notNull(),
  dishNames: jsonb("dish_names").notNull(),
  createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Store Locations — Multi-Location Support
// ---------------------------------------------------------------------------

/**
 * The `store_location` table represents a physical kitchen location
 * within an organisation. Each org has at least one location (the HQ),
 * and can have multiple branches, commissaries, or satellite kitchens.
 *
 * Classifications:
 *   hq         — one per org, admin default landing. Partial unique enforced.
 *   branch     — standard operating location.
 *   commissary — production kitchen supplying other locations.
 *   satellite  — temporary/pop-up location.
 *
 * Address fields follow the same PII encryption pattern as organisation.
 * The `store_key` is the location-level join key (prefix: KITCHEN-).
 *
 * OLTP table, 2NF — every non-key column depends solely on the PK.
 */
export const storeLocation = pgTable(
  "store_location",
  {
    storeLocationId: uuid("store_location_id").defaultRandom().primaryKey(),
    organisationId: integer("organisation_id").notNull().references(() => organisation.organisationId),
    locationName: varchar("location_name", { length: 200 }).notNull(),
    classification: varchar("classification", { length: 20 }).notNull().default("branch"),
    // Physical address
    addressLine1: varchar("address_line_1", { length: 200 }),
    addressLine2: varchar("address_line_2", { length: 200 }),
    suburb: varchar("suburb", { length: 100 }),
    state: varchar("state", { length: 100 }),
    country: varchar("country", { length: 100 }),
    postcode: varchar("postcode", { length: 20 }),
    // PII encryption for address (combined JSON blob)
    locationAddressEnc: text("location_address_enc"),
    locationAddressIv: varchar("location_address_iv", { length: 24 }),
    locationAddressTag: varchar("location_address_tag", { length: 32 }),
    // PII encryption for location name
    locationNameEnc: text("location_name_enc"),
    locationNameIv: varchar("location_name_iv", { length: 24 }),
    locationNameTag: varchar("location_name_tag", { length: 32 }),
    // Identity & branding
    storeKey: varchar("store_key", { length: 25 }).notNull().unique(),
    colorAccent: varchar("color_accent", { length: 7 }),
    photoPath: varchar("photo_path", { length: 500 }),
    isActiveInd: boolean("is_active_ind").notNull().default(true),
    createdBy: integer("created_by").notNull().references(() => user.userId),
    createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
    updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // FK index: "get all locations for an org"
    index("idx_store_location_org").on(table.organisationId),
    // Composite index: "get active locations for an org"
    index("idx_store_location_org_active").on(table.organisationId, table.isActiveInd),
    // Partial unique: enforce exactly one HQ per org
    uniqueIndex("idx_store_location_hq_unique")
      .on(table.organisationId)
      .where(sql`classification = 'hq'`),
  ],
);

/**
 * The `user_store_location` join table assigns staff to store locations.
 *
 * Staff can be assigned to one or more locations. `assigned_by` is NULL
 * for self-serve joins (via store key) and populated for admin-led
 * assignments, providing an audit trail.
 *
 * Org Admins are NOT inserted here for every location — their access
 * is resolved dynamically by locationContextService.
 *
 * OLTP table, 2NF — join table with audit metadata.
 */
export const userStoreLocation = pgTable(
  "user_store_location",
  {
    userStoreLocationId: uuid("user_store_location_id").defaultRandom().primaryKey(),
    userId: integer("user_id").notNull().references(() => user.userId),
    storeLocationId: uuid("store_location_id").notNull().references(() => storeLocation.storeLocationId),
    assignedBy: integer("assigned_by").references(() => user.userId),
    assignedAtDttm: timestamp("assigned_at_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One assignment per user per location
    uniqueIndex("idx_user_store_location_unique").on(table.userId, table.storeLocationId),
    // FK index: "get all staff at a location"
    index("idx_user_store_location_loc").on(table.storeLocationId),
    // FK index: "get all locations for a user"
    index("idx_user_store_location_user").on(table.userId),
  ],
);

/**
 * The `store_location_hour` table stores operating hours per day
 * for each store location.
 *
 * day_of_week: 0 = Sunday, 6 = Saturday.
 * Times stored as "HH:MM" strings (24-hour format).
 * is_closed_ind overrides open/close times for that day.
 *
 * OLTP table, 2NF — every non-key column depends on (store_location_id, day_of_week).
 */
export const storeLocationHour = pgTable(
  "store_location_hour",
  {
    storeLocationHourId: uuid("store_location_hour_id").defaultRandom().primaryKey(),
    storeLocationId: uuid("store_location_id").notNull().references(() => storeLocation.storeLocationId),
    dayOfWeek: smallint("day_of_week").notNull(),
    openTime: varchar("open_time", { length: 5 }).notNull(),
    closeTime: varchar("close_time", { length: 5 }).notNull(),
    isClosedInd: boolean("is_closed_ind").notNull().default(false),
  },
  (table) => [
    // One entry per location per day
    uniqueIndex("idx_store_location_hour_unique").on(table.storeLocationId, table.dayOfWeek),
    // FK index: "get all hours for a location"
    index("idx_store_location_hour_loc").on(table.storeLocationId),
  ],
);

/**
 * The `user_location_preference` table stores per-module location memory.
 *
 * Tracks the last-used location for each Kitchen Ops module per user,
 * so switching to Waste Intelligence auto-selects the location the user
 * was last working in for that module.
 *
 * module_key values: 'waste-intelligence', 'kitchen-copilot', 'menu-intelligence'
 *
 * OLTP table, 2NF — every non-key column depends on (user_id, module_key).
 */
export const userLocationPreference = pgTable(
  "user_location_preference",
  {
    userLocationPreferenceId: uuid("user_location_preference_id").defaultRandom().primaryKey(),
    userId: integer("user_id").notNull().references(() => user.userId),
    moduleKey: varchar("module_key", { length: 50 }).notNull(),
    storeLocationId: uuid("store_location_id").notNull().references(() => storeLocation.storeLocationId),
    updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One preference per user per module
    uniqueIndex("idx_user_location_pref_unique").on(table.userId, table.moduleKey),
    // FK index: "get all preferences for a user"
    index("idx_user_location_pref_user").on(table.userId),
  ],
);

// ═══════════════════════════════════════════════════════════════════════
//  INVENTORY SYSTEM — Phase 1
// ═══════════════════════════════════════════════════════════════════════

/**
 * The `ingredient` table is the org-wide canonical ingredient catalog.
 *
 * Every ingredient exists once per organisation. Locations customise via
 * the `location_ingredient` junction table (par levels, unit overrides).
 *
 * ingredient_category values: 'proteins', 'produce', 'dairy', 'dry_goods',
 *   'beverages', 'spirits', 'frozen', 'bakery', 'condiments', 'other'
 *
 * base_unit is the smallest meaningful unit for this ingredient — all
 * stock levels, transfers, and variance calculations use this unit.
 *
 * OLTP table, 2NF — every non-key column depends only on ingredient_id.
 */
export const ingredient = pgTable(
  "ingredient",
  {
    ingredientId: uuid("ingredient_id").defaultRandom().primaryKey(),
    organisationId: integer("organisation_id").notNull().references(() => organisation.organisationId),
    ingredientName: text("ingredient_name").notNull(),
    ingredientCategory: varchar("ingredient_category", { length: 50 }).notNull(),
    baseUnit: varchar("base_unit", { length: 20 }).notNull(),
    createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
    updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One ingredient name per org
    uniqueIndex("idx_ingredient_org_name").on(table.organisationId, table.ingredientName),
    // FK index: "get all ingredients for an org"
    index("idx_ingredient_org").on(table.organisationId),
  ],
);

/**
 * The `location_ingredient` table stores per-location configuration
 * for an ingredient — par levels, reorder quantities, unit overrides,
 * and whether the ingredient is active at that location.
 *
 * HQ sets org-wide defaults on the `ingredient` table; locations
 * override here. Nullable fields inherit from the parent ingredient.
 *
 * OLTP table, 2NF — every non-key column depends on
 * the composite (ingredient_id, store_location_id).
 */
export const locationIngredient = pgTable(
  "location_ingredient",
  {
    locationIngredientId: uuid("location_ingredient_id").defaultRandom().primaryKey(),
    ingredientId: uuid("ingredient_id").notNull().references(() => ingredient.ingredientId),
    storeLocationId: uuid("store_location_id").notNull().references(() => storeLocation.storeLocationId),
    parLevel: numeric("par_level"),
    reorderQty: numeric("reorder_qty"),
    unitOverride: varchar("unit_override", { length: 20 }),
    categoryOverride: varchar("category_override", { length: 50 }),
    activeInd: boolean("active_ind").notNull().default(true),
    createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
    updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One config per ingredient per location
    uniqueIndex("idx_loc_ingredient_unique").on(table.ingredientId, table.storeLocationId),
    // FK index: "get all ingredients at a location"
    index("idx_loc_ingredient_location").on(table.storeLocationId),
    // FK index: "get all locations for an ingredient"
    index("idx_loc_ingredient_ingredient").on(table.ingredientId),
  ],
);

/**
 * The `unit_conversion` table maps alternative counting units to an
 * ingredient's canonical base unit.
 *
 * Example: if base_unit is 'each' and from_unit is 'case',
 * to_base_factor = 12.0 means 1 case = 12 each.
 *
 * Staff count in any unit; the system converts to base on save.
 *
 * OLTP table, 2NF — every non-key column depends on
 * the composite (ingredient_id, from_unit).
 */
export const unitConversion = pgTable(
  "unit_conversion",
  {
    conversionId: uuid("conversion_id").defaultRandom().primaryKey(),
    ingredientId: uuid("ingredient_id").notNull().references(() => ingredient.ingredientId),
    fromUnit: varchar("from_unit", { length: 20 }).notNull(),
    toBaseFactor: numeric("to_base_factor").notNull(),
    createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One conversion per ingredient per unit
    uniqueIndex("idx_unit_conversion_unique").on(table.ingredientId, table.fromUnit),
    // FK index: "get all conversions for an ingredient"
    index("idx_unit_conversion_ingredient").on(table.ingredientId),
  ],
);

/**
 * The `stock_take_session` table represents a single counting event
 * at a location. Sessions are opened by a Location Admin, worked on
 * by staff (via stock_take_category), and reviewed by HQ.
 *
 * State machine:
 *   OPEN → PENDING_REVIEW → APPROVED | FLAGGED
 *   FLAGGED → OPEN (reopened for recount) → PENDING_REVIEW
 *   APPROVED → ARCHIVED (after retention period)
 *
 * Only one OPEN session per location is allowed at a time.
 *
 * OLTP table, 2NF — every non-key column depends only on session_id.
 */
export const stockTakeSession = pgTable(
  "stock_take_session",
  {
    sessionId: uuid("session_id").defaultRandom().primaryKey(),
    storeLocationId: uuid("store_location_id").notNull().references(() => storeLocation.storeLocationId),
    organisationId: integer("organisation_id").notNull().references(() => organisation.organisationId),
    sessionStatus: varchar("session_status", { length: 20 }).notNull().default("OPEN"),
    openedByUserId: integer("opened_by_user_id").notNull().references(() => user.userId),
    approvedByUserId: integer("approved_by_user_id").references(() => user.userId),
    flagReason: text("flag_reason"),
    openedDttm: timestamp("opened_dttm", { withTimezone: true }).defaultNow().notNull(),
    submittedDttm: timestamp("submitted_dttm", { withTimezone: true }),
    closedDttm: timestamp("closed_dttm", { withTimezone: true }),
    createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
    updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // FK index: "get sessions for a location"
    index("idx_stock_take_session_location").on(table.storeLocationId),
    // FK index: "get sessions for an org"
    index("idx_stock_take_session_org").on(table.organisationId),
    // Composite: "get active (non-archived) sessions at a location"
    index("idx_stock_take_session_active").on(table.storeLocationId, table.sessionStatus),
  ],
);

/**
 * The `stock_take_category` table represents one ingredient category
 * within a stock take session. Multiple staff can work in parallel —
 * each claims a different category.
 *
 * State machine:
 *   NOT_STARTED → IN_PROGRESS → SUBMITTED → APPROVED | FLAGGED
 *   FLAGGED → IN_PROGRESS (recount)
 *
 * Session auto-advances to PENDING_REVIEW when all categories are SUBMITTED.
 * HQ can approve or flag individual categories.
 *
 * OLTP table, 2NF — every non-key column depends on category_id.
 */
export const stockTakeCategory = pgTable(
  "stock_take_category",
  {
    categoryId: uuid("category_id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull().references(() => stockTakeSession.sessionId),
    categoryName: varchar("category_name", { length: 50 }).notNull(),
    categoryStatus: varchar("category_status", { length: 20 }).notNull().default("NOT_STARTED"),
    claimedByUserId: integer("claimed_by_user_id").references(() => user.userId),
    flagReason: text("flag_reason"),
    submittedDttm: timestamp("submitted_dttm", { withTimezone: true }),
    createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
    updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One category per session
    uniqueIndex("idx_stock_take_category_unique").on(table.sessionId, table.categoryName),
    // FK index: "get all categories for a session"
    index("idx_stock_take_category_session").on(table.sessionId),
  ],
);

/**
 * The `stock_take_line` table stores individual ingredient counts
 * within a stock take category.
 *
 * raw_qty + counted_unit = what the staff entered.
 * counted_qty = raw_qty converted to the ingredient's base unit.
 * expected_qty = previous count + recorded usage (for variance calc).
 * variance_qty = counted_qty - expected_qty.
 * variance_pct = (variance_qty / expected_qty) * 100.
 *
 * OLTP table, 2NF — every non-key column depends on line_id.
 */
export const stockTakeLine = pgTable(
  "stock_take_line",
  {
    lineId: uuid("line_id").defaultRandom().primaryKey(),
    categoryId: uuid("category_id").notNull().references(() => stockTakeCategory.categoryId),
    ingredientId: uuid("ingredient_id").notNull().references(() => ingredient.ingredientId),
    countedQty: numeric("counted_qty").notNull(),
    countedUnit: varchar("counted_unit", { length: 20 }).notNull(),
    rawQty: numeric("raw_qty").notNull(),
    expectedQty: numeric("expected_qty"),
    varianceQty: numeric("variance_qty"),
    variancePct: numeric("variance_pct"),
    countedByUserId: integer("counted_by_user_id").notNull().references(() => user.userId),
    countedDttm: timestamp("counted_dttm", { withTimezone: true }).defaultNow().notNull(),
    createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
    updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One count per ingredient per category
    uniqueIndex("idx_stock_take_line_unique").on(table.categoryId, table.ingredientId),
    // FK index: "get all lines for a category"
    index("idx_stock_take_line_category").on(table.categoryId),
    // FK index: "get all counts for an ingredient (history)"
    index("idx_stock_take_line_ingredient").on(table.ingredientId),
    // FK index: "get all counts by a user"
    index("idx_stock_take_line_user").on(table.countedByUserId),
  ],
);

/**
 * The `stock_level` table is the materialized current stock position
 * for each ingredient at each location. Updated on:
 *   - Stock take approval (set to counted_qty)
 *   - Transfer confirmation (deduct from source, add to destination)
 *   - Waste log entry (deduct)
 *
 * Uses optimistic locking via the `version` column to prevent
 * concurrent transfer deductions from creating negative stock.
 *
 * OLTP table, 2NF — every non-key column depends on
 * the composite (store_location_id, ingredient_id).
 */
export const stockLevel = pgTable(
  "stock_level",
  {
    stockLevelId: uuid("stock_level_id").defaultRandom().primaryKey(),
    storeLocationId: uuid("store_location_id").notNull().references(() => storeLocation.storeLocationId),
    ingredientId: uuid("ingredient_id").notNull().references(() => ingredient.ingredientId),
    currentQty: numeric("current_qty").notNull().default("0"),
    lastCountedDttm: timestamp("last_counted_dttm", { withTimezone: true }),
    lastCountedByUserId: integer("last_counted_by_user_id").references(() => user.userId),
    version: integer("version").notNull().default(0),
    createdDttm: timestamp("created_dttm", { withTimezone: true }).defaultNow().notNull(),
    updatedDttm: timestamp("updated_dttm", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // One stock level per ingredient per location
    uniqueIndex("idx_stock_level_unique").on(table.storeLocationId, table.ingredientId),
    // FK index: "get all stock levels at a location"
    index("idx_stock_level_location").on(table.storeLocationId),
    // FK index: "get stock level for an ingredient across locations"
    index("idx_stock_level_ingredient").on(table.ingredientId),
  ],
);
