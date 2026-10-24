import { describe, expect, it } from "vitest";
import { HQ_SECTIONS, MONEY_TABS, sectionFor } from "../../app/(app)/hq/sections";

describe("the admin panel's pages", () => {
  it("are grouped into Home, People, Insights, Money and Settings, in that order", () => {
    expect([...new Set(HQ_SECTIONS.map((s) => s.group))]).toEqual(["Home", "People", "Insights", "Money", "Settings"]);
  });

  it("have one menu item for all of Money, whose pages are tabs", () => {
    expect(HQ_SECTIONS.filter((s) => s.group === "Money").map((s) => s.href)).toEqual(["/hq/money"]);
    expect(MONEY_TABS.map((t) => t.href)).toEqual(["/hq/money", "/hq/money/payouts", "/hq/money/setup"]);
  });

  it("list each address once", () => {
    const hrefs = HQ_SECTIONS.map((s) => s.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("let a moderator open only Members, Reports and Activity", () => {
    expect(HQ_SECTIONS.filter((s) => s.staff).map((s) => s.label).sort()).toEqual(["Activity", "Members", "Reports"]);
  });

  it("know which section and tab a path belongs to", () => {
    expect(sectionFor("/hq").section?.label).toBe("Overview");
    expect(sectionFor("/hq/members").section?.group).toBe("People");
    expect(sectionFor("/hq/cases/CASE-000001").section?.label).toBe("Reports");
    const money = sectionFor("/hq/money/setup");
    expect(money.section?.label).toBe("Money");
    expect(money.tab?.label).toBe("Polar setup");
    expect(sectionFor("/hq/money").tab?.label).toBe("Overview");
    expect(sectionFor("/hq/nowhere").section).toBeUndefined();
  });
});
