import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../db/schema.js";
import { user } from "../db/schema.js";
import {
  scrubbedUserFields,
  KEPT_USER_COLUMNS,
  HANDLED_USER_REFERENCES,
  KEPT_USER_REFERENCES,
} from "./userAnonymisationService.js";

/**
 * Account deletion scrubs the user row but keeps its id, so business history stays
 * valid. The promise to users is "no personally identifiable information is retained",
 * so a new PII column on `user` must not be forgotten: every column has to be either
 * scrubbed or deliberately kept (with a reason, in KEPT_USER_COLUMNS).
 */
describe("scrubbedUserFields", () => {
  const scrubbed = scrubbedUserFields(42, new Date("2026-10-20T00:00:00Z"));
  const columns = Object.keys(getTableColumns(user));

  it("accounts for every column on the user table (scrubbed or deliberately kept)", () => {
    const accountedFor = new Set([...Object.keys(scrubbed), ...Object.keys(KEPT_USER_COLUMNS)]);
    const forgotten = columns.filter((c) => !accountedFor.has(c));
    expect(forgotten, "user columns neither scrubbed nor kept: decide, then add to the service").toEqual([]);
  });

  it("never lists a column as both scrubbed and kept", () => {
    const both = Object.keys(scrubbed).filter((c) => c in KEPT_USER_COLUMNS);
    expect(both).toEqual([]);
  });

  it("only scrubs columns that exist", () => {
    const unknown = Object.keys(scrubbed).filter((c) => !columns.includes(c));
    expect(unknown).toEqual([]);
  });

  it("replaces identity with a placeholder that is unique per user and cannot receive mail", () => {
    expect(scrubbed.userName).toBe("Deleted user");
    expect(scrubbed.userEmail).toBe("deleted-42@deleted.invalid");
    expect(scrubbedUserFields(43, new Date()).userEmail).not.toBe(scrubbed.userEmail);
  });

  it("removes every credential and encrypted PII value", () => {
    for (const key of [
      "userPasswordHash", "mfaSecret", "userPhotoPath", "userBio", "userEmailHash",
      "userNameEnc", "userNameIv", "userNameTag", "userEmailEnc", "userEmailIv", "userEmailTag",
      "userBioEnc", "userAddressEnc", "userAddressLine1", "userPostcode",
    ] as const) {
      expect(scrubbed[key], key).toBeNull();
    }
    expect(scrubbed.mfaEnabledInd).toBe(false);
    expect(scrubbed.userStatus).toBe("deleted");
  });
});

/**
 * Every table with a foreign key to `user` must be a conscious decision: removed or
 * detached by anonymiseUser (HANDLED), or kept as a business/audit record (KEPT).
 * A new table that points at a user fails here until someone decides which.
 */
describe("foreign keys to user", () => {
  const actual = Object.values(schema)
    .filter((v): v is PgTable => v instanceof PgTable)
    .flatMap((t) => {
      const cfg = getTableConfig(t);
      return cfg.foreignKeys
        .filter((fk) => getTableConfig(fk.reference().foreignTable as PgTable).name === "user")
        .map((fk) => `${cfg.name}.${fk.reference().columns[0].name}`);
    })
    .sort();
  const listed = [...HANDLED_USER_REFERENCES, ...KEPT_USER_REFERENCES];

  it("every foreign key to user is classified as handled or kept", () => {
    expect(actual.filter((r) => !listed.includes(r)), "unclassified references to user").toEqual([]);
  });

  it("lists no reference that no longer exists, and none twice", () => {
    expect(listed.filter((r) => !actual.includes(r)), "stale entries").toEqual([]);
    expect(listed.length).toBe(new Set(listed).size);
  });
});
