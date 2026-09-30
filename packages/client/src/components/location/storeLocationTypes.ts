export interface StoreLocationFull {
  storeLocationId: string;
  organisationId: number;
  locationName: string;
  classification: string;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
  storeKey: string;
  colorAccent: string | null;
  photoPath: string | null;
  isActiveInd: boolean;
}

export interface StaffMember {
  userId: number;
  displayName: string;
  photoPath: string | null;
  assignedAt: string;
}

export const CLASSIFICATION_LABELS: Record<string, string> = {
  hq: "HQ",
  branch: "Branch",
  commissary: "Commissary",
  satellite: "Satellite",
};

export const CLASSIFICATION_BADGE: Record<string, string> = {
  hq: "bg-amber-600/15 text-amber-500",
  branch: "bg-blue-500/15 text-blue-400",
  commissary: "bg-emerald-500/15 text-emerald-400",
  satellite: "bg-purple-500/15 text-purple-400",
};

export const inputClass =
  "w-full px-3 py-2 text-sm rounded-lg bg-dark-50 border border-dark-200 text-white placeholder:text-dark-500 focus:outline-none focus:ring-2 focus:ring-gold/50 min-h-[44px]";

export const COLOR_PALETTE = [
  "#FF6B35", "#FFD700", "#4ECDC4", "#5B8DEF",
  "#A855F7", "#F43F5E", "#10B981", "#F59E0B",
];
