import { z } from "zod";

/** `GET /api/users/profile`: only what the delete-account screen needs to know about which proof to ask for. */
export const ProfileFactsReplySchema = z.object({
  profile: z.object({
    hasPassword: z.boolean(),
    mfaEnabledInd: z.boolean().catch(false),
    /** An older server does not say; then the account is treated as having no Apple link. */
    hasApple: z.boolean().catch(false),
    userEmail: z.string().catch(""),
  }),
});
export type ProfileFactsReply = z.infer<typeof ProfileFactsReplySchema>;

/** A text field the person may have left empty: null and absent both read as "". */
const text = z.string().nullable().optional().transform((v) => v ?? "").catch("");

/** The editable details on `GET /api/users/profile` (PATCH `/api/users/profile` takes the same names). */
export const PROFILE_DETAIL_FIELDS = [
  "userName",
  "userBio",
  "userAddressLine1",
  "userAddressLine2",
  "userSuburb",
  "userState",
  "userCountry",
  "userPostcode",
  "userFacebook",
  "userInstagram",
  "userTiktok",
  "userPinterest",
  "userLinkedin",
] as const;
export type ProfileDetailField = (typeof PROFILE_DETAIL_FIELDS)[number];
export type ProfileDetails = Record<ProfileDetailField, string>;

export const ProfileDetailsReplySchema = z.object({
  profile: z.object(Object.fromEntries(PROFILE_DETAIL_FIELDS.map((f) => [f, text])) as Record<ProfileDetailField, typeof text>).extend({
    userEmail: text,
    userPhotoPath: z.string().nullable().catch(null),
  }),
});

/** `POST /api/users/profile/avatar`: where the new picture is. */
export const AvatarReplySchema = z.object({ photoPath: z.string() });

/** `POST /api/auth/mfa/setup`: the secret to type into an authenticator app, and a QR image of it (a data: URL). */
export const MfaSetupReplySchema = z.object({ secret: z.string(), qrCodeDataUrl: z.string().catch("") });

/** `GET /api/users/kitchen-profile` (PUT answers the same). Every field falls back, so a profile never saved reads as the defaults. */
export const KitchenProfileSchema = z.object({
  skillLevel: z.string().catch("home_cook"),
  cuisinePreferences: z.array(z.string()).catch([]),
  dietaryRestrictions: z.array(z.string()).catch([]),
  kitchenEquipment: z.array(z.string()).catch([]),
  servingsDefault: z.number().int().catch(4),
  restaurantName: text,
  establishmentType: text,
  cuisineIdentity: text,
  targetDiner: text,
  pricePoint: text,
  restaurantVoice: text,
  sourcingValues: z.array(z.string()).catch([]),
  platingStyle: text,
  kitchenConstraints: z.array(z.string()).catch([]),
  menuNeeds: z.array(z.string()).catch([]),
});
export type KitchenProfile = z.infer<typeof KitchenProfileSchema>;

const option = z.object({ optionValue: z.string(), optionLabel: z.string(), optionDescription: z.string().nullable().catch(null) });
const options = z.array(z.unknown()).transform((rows) => rows.flatMap((r) => {
  const parsed = option.safeParse(r);
  return parsed.success ? [parsed.data] : [];
})).catch([]);

/** `GET /api/personalisation-options`: the admin-managed lists (skill level, cuisine, dietary, equipment). */
export const PersonalisationOptionsSchema = z.object({ skill_level: options, cuisine: options, dietary: options, equipment: options });
export type PersonalisationOptions = z.infer<typeof PersonalisationOptionsSchema>;
