import { z } from "zod";

/** What `/auth/login` and `/auth/me` return for a person (only the fields the phone reads). */
export const AuthUserSchema = z.object({
  userId: z.number(),
  userName: z.string().catch(""),
  userEmail: z.string().catch(""),
  mfaEnabled: z.boolean().catch(false),
  /** The profile picture's address; absent or null when there is none. */
  userPhotoPath: z.string().nullable().optional().catch(undefined),
  roles: z.array(z.string()).catch([]),
  permissions: z.array(z.string()).catch([]),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const TokensSchema = z.object({ accessToken: z.string(), refreshToken: z.string() });

/** `/auth/login`, `/auth/google/idtoken` and `/auth/mfa/verify`: tokens and a user, or an MFA challenge. */
export const LoginReplySchema = z.object({
  user: AuthUserSchema.optional(),
  tokens: TokensSchema.optional(),
  requiresMfa: z.boolean().optional().catch(undefined),
  mfaSessionToken: z.string().optional(),
});
export type LoginReply = z.infer<typeof LoginReplySchema>;

/** `/auth/refresh`: the refresh token is only present when the server rotates it. */
export const RefreshReplySchema = z.object({ tokens: z.object({ accessToken: z.string(), refreshToken: z.string().optional() }) });
export type RefreshReply = z.infer<typeof RefreshReplySchema>;

export const MeReplySchema = z.object({ user: AuthUserSchema });

export const RegisterReplySchema = z.object({ autoVerified: z.boolean().optional().catch(undefined) });

export const StoreLocationSchema = z.object({
  storeLocationId: z.string(),
  organisationId: z.number(),
  locationName: z.string(),
  classification: z.string().catch(""),
  /** The venue's IANA zone; absent from a session saved before the phone read it. */
  ianaTimezone: z.string().optional().catch(undefined),
});
export type StoreLocation = z.infer<typeof StoreLocationSchema>;

/** `/users/location-context`: the locations this person may use and the one the server has selected. */
export const LocationContextSchema = z.object({
  locations: z.array(StoreLocationSchema),
  selectedLocationId: z.string().nullable().catch(null),
  organisationId: z.number().nullable().catch(null),
  isOrgAdmin: z.boolean().catch(false),
  hasLocationAccess: z.boolean().catch(false),
});
export type LocationContext = z.infer<typeof LocationContextSchema>;
