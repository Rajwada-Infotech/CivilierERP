import { describe, expect, it } from "vitest";
import { chainLinksForRow, readChainLink } from "./civilWorkDprLinks";

const all = () => true;

describe("chainLinksForRow", () => {
  it("offers all three pages, each carrying the activity and its chain", () => {
    expect(chainLinksForRow({ rungId: 123, chainId: 45 }, all)).toEqual([
      { label: "Work Allocation", to: "/civilworkdpr/work-allocation?rung=123&chain=45" },
      { label: "Activity Reporting", to: "/civilworkdpr/activity-reporting?rung=123&chain=45" },
      { label: "Work Transfer", to: "/civilworkdpr/work-transfer?rung=123&chain=45" },
    ]);
  });

  it("offers only the pages the person may open", () => {
    const only = (pk: string) => pk === "civilworkdpr-activity-reporting";
    expect(chainLinksForRow({ rungId: 7, chainId: 1 }, only).map((l) => l.label)).toEqual(["Activity Reporting"]);
    expect(chainLinksForRow({ rungId: 7, chainId: 1 }, () => false)).toEqual([]);
  });

  it("works without a chain id, and offers nothing for a row that is not about one activity", () => {
    expect(chainLinksForRow({ rungId: 9 }, all)[0].to).toBe("/civilworkdpr/work-allocation?rung=9");
    expect(chainLinksForRow({ engineerId: 4, engineerName: "Asha" }, all)).toEqual([]); // engineer workload row
    expect(chainLinksForRow({ rungId: null }, all)).toEqual([]);
  });

  it("never puts anything but a whole number into the address", () => {
    expect(chainLinksForRow({ rungId: "5; drop", chainId: "x" }, all)).toEqual([]);
    expect(chainLinksForRow({ rungId: "12", chainId: "3" }, all)[0].to).toBe("/civilworkdpr/work-allocation?rung=12&chain=3");
    expect(chainLinksForRow({ rungId: -4 }, all)).toEqual([]);
    expect(chainLinksForRow({ rungId: 1.5 }, all)).toEqual([]);
  });
});

describe("readChainLink", () => {
  it("reads whole numbers and ignores junk", () => {
    expect(readChainLink(new URLSearchParams("rung=123&chain=45"))).toEqual({ rungId: 123, chainId: 45 });
    expect(readChainLink(new URLSearchParams("rung=abc&chain="))).toEqual({ rungId: null, chainId: null });
    expect(readChainLink(new URLSearchParams(""))).toEqual({ rungId: null, chainId: null });
    expect(readChainLink(new URLSearchParams("rung=0"))).toEqual({ rungId: null, chainId: null });
  });
});
