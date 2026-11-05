import { describe, expect, it } from "vitest";
import {
  HOME_TILES,
  orderTiles,
  pickHeroTiles,
  rankedModuleOrder,
  type HomeModuleId,
  type HomeTileData,
} from "./homeTiles";

const DEFAULT_ORDER: HomeModuleId[] = ["finance", "material", "engineering", "crm"];

const emptyData: HomeTileData = {
  loading: false, fin: null, mat: null, eng: null, adm: null, tick: null,
  fol: null, sal: null, crm: null, dpr: null, sa: null, fa: null,
};

describe("tile registry", () => {
  it("offers a few tiles for every module", () => {
    const counts = new Map<string, number>();
    for (const t of HOME_TILES) counts.set(t.module, (counts.get(t.module) ?? 0) + 1);
    for (const m of ["finance", "material", "engineering", "followup", "ticket", "sales", "salesAutomation", "civilworkdpr", "crm", "fixedasset"]) {
      expect(counts.get(m) ?? 0).toBeGreaterThanOrEqual(3);
    }
  });

  it("has unique tile ids", () => {
    expect(new Set(HOME_TILES.map((t) => t.id)).size).toBe(HOME_TILES.length);
  });

  it("every tile computes safely from empty data", () => {
    for (const t of HOME_TILES) expect(() => t.compute(emptyData)).not.toThrow();
  });

  it("formats rupee tiles in lakhs and crores", () => {
    const fin = HOME_TILES.find((t) => t.id === "fin-transferred")!;
    expect(fin.compute({ ...emptyData, fin: { payments: { totalAmount: 25_000_000 } } })).toMatchObject({ value: "2.50", suffix: "Cr" });
    expect(fin.compute({ ...emptyData, fin: { payments: { totalAmount: 450_000 } } })).toMatchObject({ value: 5, suffix: "L" });
  });
});

describe("dynamic ordering", () => {
  it("puts ranked modules first, then the rest of the accessible ones in default order", () => {
    expect(rankedModuleOrder(["crm", "finance"], ["finance", "material", "crm"], DEFAULT_ORDER)).toEqual([
      "crm", "finance", "material",
    ]);
  });

  it("drops ranked modules the user cannot open", () => {
    expect(rankedModuleOrder(["engineering", "crm"], ["crm"], DEFAULT_ORDER)).toEqual(["crm"]);
  });

  it("falls back to default order with no ranking", () => {
    expect(rankedModuleOrder(undefined, ["crm", "material"], DEFAULT_ORDER)).toEqual(["material", "crm"]);
  });

  it("groups tiles by module rank and keeps each module's own order", () => {
    const ordered = orderTiles(HOME_TILES, ["crm", "finance"]);
    expect(ordered[0].module).toBe("crm");
    expect(ordered.every((t) => t.module === "crm" || t.module === "finance")).toBe(true);
    const fin = ordered.filter((t) => t.module === "finance").map((t) => t.id);
    expect(fin).toEqual(HOME_TILES.filter((t) => t.module === "finance").map((t) => t.id));
  });

  it("hero row gives the top module two tiles and the next ones one each", () => {
    const order: HomeModuleId[] = ["crm", "finance", "material"];
    const hero = pickHeroTiles(orderTiles(HOME_TILES, order), order);
    expect(hero.map((t) => t.module)).toEqual(["crm", "crm", "finance", "material"]);
  });

  it("hero row fills from the next tiles when there are fewer modules", () => {
    const hero = pickHeroTiles(orderTiles(HOME_TILES, ["finance"]), ["finance"]);
    expect(hero).toHaveLength(4);
    expect(hero.every((t) => t.module === "finance")).toBe(true);
  });
});
