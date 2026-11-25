import { describe, expect, it } from "vitest";
import type { Memory } from "@culinaire/shared/schemas/brain";
import { canRemove, memoryLabel, provenance, SOURCES } from "./brainView";

const memory = (over: Partial<Memory> = {}): Memory => ({ memoryId: "m1", title: null, body: "Salt the fish overnight", sourceType: "chat", scope: "user", isPinned: false, status: "ready", createdDttm: "2026-07-08T10:00:00Z", canManage: true, authorName: null, ...over });
const person = (permissions: string[], roles: string[] = []) => ({ userId: 1, userName: "A", userEmail: "a@x.test", mfaEnabled: false, roles, permissions });

describe("what a memory says", () => {
  it("is called by its title, or by the start of its text when it has none", () => {
    expect(memoryLabel(memory({ title: "Fish supplier" }))).toBe("Fish supplier");
    expect(memoryLabel(memory({ body: "x".repeat(200) }))).toBe("x".repeat(100));
  });

  it("says where it came from and when, and who shared it, in the web's words", () => {
    expect(provenance(memory({ sourceType: "waste" }))).toMatch(/^from the waste log · .*8/);
    expect(provenance(memory({ sourceType: "purchase_order", authorName: "Maria" }))).toMatch(/^Maria · from purchasing · /);
    expect(provenance(memory({ sourceType: "telepathy", createdDttm: "" }))).toBe("from telepathy");
    expect(provenance(memory({ sourceType: "", createdDttm: "" }))).toBe("");
  });

  it("offers the web's source filters, All first", () => {
    expect(SOURCES.map((s) => s.label)).toEqual(["All", "Chat", "Recipes", "Purchasing", "Waste", "Stock", "Menu", "Prep"]);
    expect(SOURCES[0].value).toBeNull();
  });
});

describe("who may remove a memory", () => {
  it("needs both the server's say on this row and the key its route asks for", () => {
    expect(canRemove(person(["brain:read", "brain:manage"]), memory())).toBe(true);
    expect(canRemove(person(["brain:read"]), memory())).toBe(false);
    expect(canRemove(person(["brain:read", "brain:manage"]), memory({ canManage: false }))).toBe(false);
    expect(canRemove(person([], ["Administrator"]), memory())).toBe(true);
    expect(canRemove(person([], ["Administrator"]), memory({ canManage: false }))).toBe(false);
  });
});
