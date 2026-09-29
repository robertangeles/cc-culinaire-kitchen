export interface Organisation {
  organisationId: number;
  organisationName: string;
  organisationAddressLine1: string | null;
  organisationAddressLine2: string | null;
  organisationSuburb: string | null;
  organisationState: string | null;
  organisationCountry: string | null;
  organisationPostcode: string | null;
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
  joinedAt: string;
}
