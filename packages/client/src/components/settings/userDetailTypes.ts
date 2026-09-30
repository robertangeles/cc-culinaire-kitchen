/** User data shape expected by the panel (same as UsersTab UserRow). */
export interface UserRow {
  userId: number;
  userName: string;
  userEmail: string;
  emailVerifiedInd: boolean;
  userPhotoPath: string | null;
  freeSessions: number;
  subscriptionStatus: string;
  subscriptionTier: string;
  userStatus: string;
  createdDttm: string;
  roles: string[];
  organisation: string | null;
}

export interface RoleOption {
  roleId: number;
  roleName: string;
}

/** Full profile returned by GET /api/users/:id */
export interface FullProfile {
  userBio?: string | null;
  userAddressLine1?: string | null;
  userAddressLine2?: string | null;
  userSuburb?: string | null;
  userState?: string | null;
  userCountry?: string | null;
  userPostcode?: string | null;
  userFacebook?: string | null;
  userInstagram?: string | null;
  userTiktok?: string | null;
  userPinterest?: string | null;
  userLinkedin?: string | null;
}

export interface OrgDetails {
  organisationId?: number;
  organisationName?: string;
  organisationEmail?: string | null;
  organisationAddressLine1?: string | null;
  organisationAddressLine2?: string | null;
  organisationSuburb?: string | null;
  organisationState?: string | null;
  organisationCountry?: string | null;
  organisationPostcode?: string | null;
  organisationWebsite?: string | null;
  organisationFacebook?: string | null;
  organisationInstagram?: string | null;
  organisationTiktok?: string | null;
  organisationPinterest?: string | null;
  organisationLinkedin?: string | null;
}

/** Props for {@link UserDetailPanel}. */
export interface UserDetailPanelProps {
  /** The user to display. */
  user: UserRow;
  /** Available roles for assignment. */
  availableRoles: RoleOption[];
  /** Called when the panel should close. */
  onClose: () => void;
  /** Called after any change so the parent can refresh. */
  onRefresh: () => void;
}
