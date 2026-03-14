/**
 * @module services/piiService
 *
 * Encrypt-on-write and decrypt-on-read helpers for PII fields.
 * Uses AES-256-GCM encryption with separate PII keys.
 *
 * Address fields are combined into a single encrypted JSON blob
 * to reduce the number of encryption columns.
 */

import { encryptPii, decryptPii, hashForLookup } from "../utils/crypto.js";

// ---------------------------------------------------------------------------
// User PII
// ---------------------------------------------------------------------------

export interface UserPiiPlain {
  userName: string;
  userEmail: string;
  userBio?: string | null;
  userAddressLine1?: string | null;
  userAddressLine2?: string | null;
  userSuburb?: string | null;
  userState?: string | null;
  userCountry?: string | null;
  userPostcode?: string | null;
}

export interface UserPiiEncrypted {
  userNameEnc: string | null;
  userNameIv: string | null;
  userNameTag: string | null;
  userEmailEnc: string | null;
  userEmailIv: string | null;
  userEmailTag: string | null;
  userEmailHash: string;
  userBioEnc: string | null;
  userBioIv: string | null;
  userBioTag: string | null;
  userAddressEnc: string | null;
  userAddressIv: string | null;
  userAddressTag: string | null;
}

/** Encrypt user PII fields for database storage. */
export function encryptUserPii(data: UserPiiPlain): UserPiiEncrypted {
  const nameEnc = encryptPii(data.userName);
  const emailEnc = encryptPii(data.userEmail);
  const emailHash = hashForLookup(data.userEmail);
  const bioEnc = encryptPii(data.userBio);

  const addressData = {
    line1: data.userAddressLine1 ?? null,
    line2: data.userAddressLine2 ?? null,
    suburb: data.userSuburb ?? null,
    state: data.userState ?? null,
    country: data.userCountry ?? null,
    postcode: data.userPostcode ?? null,
  };
  const hasAddress = Object.values(addressData).some(Boolean);
  const addressEnc = hasAddress ? encryptPii(JSON.stringify(addressData)) : null;

  return {
    userNameEnc: nameEnc?.enc ?? null,
    userNameIv: nameEnc?.iv ?? null,
    userNameTag: nameEnc?.tag ?? null,
    userEmailEnc: emailEnc?.enc ?? null,
    userEmailIv: emailEnc?.iv ?? null,
    userEmailTag: emailEnc?.tag ?? null,
    userEmailHash: emailHash,
    userBioEnc: bioEnc?.enc ?? null,
    userBioIv: bioEnc?.iv ?? null,
    userBioTag: bioEnc?.tag ?? null,
    userAddressEnc: addressEnc?.enc ?? null,
    userAddressIv: addressEnc?.iv ?? null,
    userAddressTag: addressEnc?.tag ?? null,
  };
}

interface AddressFields {
  line1: string | null;
  line2: string | null;
  suburb: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
}

/**
 * Decrypt user PII fields from a database row.
 * Falls back to plaintext columns if encrypted values are not yet populated.
 */
export function decryptUserPii(row: Record<string, unknown>): {
  userName: string;
  userEmail: string;
  userBio: string | null;
  userAddressLine1: string | null;
  userAddressLine2: string | null;
  userSuburb: string | null;
  userState: string | null;
  userCountry: string | null;
  userPostcode: string | null;
} {
  // Decrypt or fall back to plaintext
  const userName = decryptPii(
    row.userNameEnc as string | null,
    row.userNameIv as string | null,
    row.userNameTag as string | null,
  ) ?? (row.userName as string);

  const userEmail = decryptPii(
    row.userEmailEnc as string | null,
    row.userEmailIv as string | null,
    row.userEmailTag as string | null,
  ) ?? (row.userEmail as string);

  const userBio = decryptPii(
    row.userBioEnc as string | null,
    row.userBioIv as string | null,
    row.userBioTag as string | null,
  ) ?? (row.userBio as string | null);

  // Address: decrypt JSON blob or fall back to individual plaintext columns
  const addressJson = decryptPii(
    row.userAddressEnc as string | null,
    row.userAddressIv as string | null,
    row.userAddressTag as string | null,
  );

  let address: AddressFields;
  if (addressJson) {
    address = JSON.parse(addressJson) as AddressFields;
  } else {
    address = {
      line1: row.userAddressLine1 as string | null,
      line2: row.userAddressLine2 as string | null,
      suburb: row.userSuburb as string | null,
      state: row.userState as string | null,
      country: row.userCountry as string | null,
      postcode: row.userPostcode as string | null,
    };
  }

  return {
    userName,
    userEmail,
    userBio,
    userAddressLine1: address.line1,
    userAddressLine2: address.line2,
    userSuburb: address.suburb,
    userState: address.state,
    userCountry: address.country,
    userPostcode: address.postcode,
  };
}

// ---------------------------------------------------------------------------
// Organisation PII
// ---------------------------------------------------------------------------

export interface OrgPiiPlain {
  organisationName: string;
  organisationEmail?: string | null;
  organisationAddressLine1?: string | null;
  organisationAddressLine2?: string | null;
  organisationSuburb?: string | null;
  organisationState?: string | null;
  organisationCountry?: string | null;
  organisationPostcode?: string | null;
}

export interface OrgPiiEncrypted {
  orgNameEnc: string | null;
  orgNameIv: string | null;
  orgNameTag: string | null;
  orgEmailEnc: string | null;
  orgEmailIv: string | null;
  orgEmailTag: string | null;
  orgAddressEnc: string | null;
  orgAddressIv: string | null;
  orgAddressTag: string | null;
}

/** Encrypt organisation PII fields for database storage. */
export function encryptOrgPii(data: OrgPiiPlain): OrgPiiEncrypted {
  const nameEnc = encryptPii(data.organisationName);
  const emailEnc = encryptPii(data.organisationEmail);

  const addressData = {
    line1: data.organisationAddressLine1 ?? null,
    line2: data.organisationAddressLine2 ?? null,
    suburb: data.organisationSuburb ?? null,
    state: data.organisationState ?? null,
    country: data.organisationCountry ?? null,
    postcode: data.organisationPostcode ?? null,
  };
  const hasAddress = Object.values(addressData).some(Boolean);
  const addressEnc = hasAddress ? encryptPii(JSON.stringify(addressData)) : null;

  return {
    orgNameEnc: nameEnc?.enc ?? null,
    orgNameIv: nameEnc?.iv ?? null,
    orgNameTag: nameEnc?.tag ?? null,
    orgEmailEnc: emailEnc?.enc ?? null,
    orgEmailIv: emailEnc?.iv ?? null,
    orgEmailTag: emailEnc?.tag ?? null,
    orgAddressEnc: addressEnc?.enc ?? null,
    orgAddressIv: addressEnc?.iv ?? null,
    orgAddressTag: addressEnc?.tag ?? null,
  };
}

/**
 * Decrypt organisation PII fields from a database row.
 * Falls back to plaintext columns if encrypted values are not yet populated.
 */
export function decryptOrgPii(row: Record<string, unknown>): {
  organisationName: string;
  organisationEmail: string | null;
  organisationAddressLine1: string | null;
  organisationAddressLine2: string | null;
  organisationSuburb: string | null;
  organisationState: string | null;
  organisationCountry: string | null;
  organisationPostcode: string | null;
} {
  const organisationName = decryptPii(
    row.orgNameEnc as string | null,
    row.orgNameIv as string | null,
    row.orgNameTag as string | null,
  ) ?? (row.organisationName as string);

  const organisationEmail = decryptPii(
    row.orgEmailEnc as string | null,
    row.orgEmailIv as string | null,
    row.orgEmailTag as string | null,
  ) ?? (row.organisationEmail as string | null);

  const addressJson = decryptPii(
    row.orgAddressEnc as string | null,
    row.orgAddressIv as string | null,
    row.orgAddressTag as string | null,
  );

  let address: AddressFields;
  if (addressJson) {
    address = JSON.parse(addressJson) as AddressFields;
  } else {
    address = {
      line1: row.organisationAddressLine1 as string | null,
      line2: row.organisationAddressLine2 as string | null,
      suburb: row.organisationSuburb as string | null,
      state: row.organisationState as string | null,
      country: row.organisationCountry as string | null,
      postcode: row.organisationPostcode as string | null,
    };
  }

  return {
    organisationName,
    organisationEmail,
    organisationAddressLine1: address.line1,
    organisationAddressLine2: address.line2,
    organisationSuburb: address.suburb,
    organisationState: address.state,
    organisationCountry: address.country,
    organisationPostcode: address.postcode,
  };
}

/** Compute email hash for blind-index lookup. */
export { hashForLookup } from "../utils/crypto.js";
