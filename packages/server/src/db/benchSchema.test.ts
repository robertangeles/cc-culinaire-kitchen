import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { benchMention, benchPin } from "./schema.js";

/**
 * Production and dev enforce these bench constraints; schema.ts must say so, or a database
 * built from it (CI, a new environment) would allow rows production would reject.
 * addBenchPinUnique.ts relies on the unique constraint name matching Drizzle's default.
 */
describe("bench tables match the live database", () => {
  it("bench_pin is unique per message, under the name Drizzle and the script both use", () => {
    const column = getTableConfig(benchPin).columns.find((c) => c.name === "message_id");
    expect(column?.isUnique).toBe(true);
    expect(column?.uniqueName).toBe("bench_pin_message_id_unique");
  });

  it("declares the cascade foreign keys production already has", () => {
    const fks = [...getTableConfig(benchPin).foreignKeys, ...getTableConfig(benchMention).foreignKeys].map((fk) => {
      const ref = fk.reference();
      return `${getTableConfig(ref.columns[0].table).name}.${ref.columns[0].name} -> ${ref.foreignColumns[0].name} on delete ${fk.onDelete}`;
    });
    expect(fks.sort()).toEqual([
      "bench_mention.message_id -> message_id on delete cascade",
      "bench_pin.channel_id -> channel_id on delete cascade",
      "bench_pin.message_id -> message_id on delete cascade",
    ]);
  });

  it("indexes the unread-mentions lookup the way production does", () => {
    const idx = getTableConfig(benchMention).indexes.find((i) => i.config.name === "idx_bench_mention_user");
    expect(idx?.config.columns.map((c) => (c as { name: string }).name)).toEqual(["mentioned_user_id", "read_ind"]);
  });
});
