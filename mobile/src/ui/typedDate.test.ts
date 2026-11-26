import { describe, it, expect } from "vitest";
import { isTime, maskDate, maskTime, parseTypedDate, typedDate } from "./typedDate";

describe("dates and times typed on a number pad", () => {
  it("puts the separators in as the digits arrive, and lets them be deleted", () => {
    expect(["0", "03", "031", "0312", "03122", "03122026", "031220269"].map(maskDate)).toEqual(["0", "03", "03/1", "03/12", "03/12/2", "03/12/2026", "03/12/2026"]);
    expect(["0", "09", "093", "0930", "09:3"].map(maskTime)).toEqual(["0", "09", "09:3", "09:30", "09:3"]);
  });

  it("reads the day first and refuses a day that does not exist", () => {
    expect(parseTypedDate("08/07/2026")).toBe("2026-07-08");
    expect(parseTypedDate("29/02/2028")).toBe("2028-02-29");
    for (const bad of ["", "8/7/2026", "29/02/2026", "31/04/2026", "01/13/2026", "01/01/0001"]) expect(parseTypedDate(bad)).toBeNull();
  });

  it("fills a field from the server's day", () => {
    expect(typedDate("2026-07-08")).toBe("08/07/2026");
    expect(typedDate(null)).toBe("");
  });

  it("knows a 24-hour time", () => {
    expect(["09:30", "23:59", "00:00"].every(isTime)).toBe(true);
    expect(["24:00", "9:30", "09:60", ""].some(isTime)).toBe(false);
  });
});
