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
