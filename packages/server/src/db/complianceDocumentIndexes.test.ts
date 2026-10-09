import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { complianceDocument } from "./schema.js";

/**
 * House rule: every foreign key gets an index, because Postgres does not create
 * one and every parent-row delete (a user, a location) otherwise scans the whole
 * child table to check the constraint. Asserted on the schema definition so a
 * new FK on this table cannot ship unindexed.
 */
describe("compliance_document foreign-key indexes", () => {
  const config = getTableConfig(complianceDocument);
  const indexedLeadingColumns = new Set(
    config.indexes.map((i) => (i.config.columns[0] as { name: string }).name),
  );

  it("indexes the leading column of every foreign key", () => {
    const unindexed = config.foreignKeys
      .map((fk) => fk.reference().columns[0].name)
      .filter((column) => !indexedLeadingColumns.has(column));
    expect(unindexed, "foreign keys with no index").toEqual([]);
  });

  it("covers uploaded_by and verified_by specifically", () => {
    expect(indexedLeadingColumns.has("uploaded_by")).toBe(true);
    expect(indexedLeadingColumns.has("verified_by")).toBe(true);
  });
});
