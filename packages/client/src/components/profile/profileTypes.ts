export interface Organisation {
  organisationId: number;
  organisationName: string;
  organisationWebsite: string | null;
  organisationEmail: string | null;
  organisationPhone: string | null;
  organisationFacebook: string | null;
  organisationInstagram: string | null;
  organisationTiktok: string | null;
  organisationPinterest: string | null;
  organisationLinkedin: string | null;
  joinKey: string;
  createdBy: number;
}

export interface OrgMember {
  userId: number;
  displayName: string;
  photoPath: string | null;
  bio: string | null;
  role: "admin" | "member";
}
