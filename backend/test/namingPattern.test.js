// Naming patterns (services/namingPattern.js) — templates are master data, so
// these pin the token behaviour every project's unit names depend on.
const { SCOPE, validateTemplate, letterAt, renderName, legacyName } = require("../services/namingPattern");

const ctx = { shortCode: "GS", blockName: "A", towerNo: 1 };

describe("renderName", () => {
  test("Tower / Floor / Unit — the requested T1/FL2/A format", () => {
    const p = { Template: "{P}/T{T}/FL{F}/{L}", GroundLabel: "G", NumberStart: 1 };
    const names = [];
    for (let f = 1; f <= 3; f++) for (let s = 1; s <= 2; s++) names.push(renderName(p, { ...ctx, floorNo: f, seq: s }));
    expect(names).toEqual(["GS/T1/FL1/A", "GS/T1/FL1/B", "GS/T1/FL2/A", "GS/T1/FL2/B", "GS/T1/FL3/A", "GS/T1/FL3/B"]);
  });
  test("current live style: short/block/floor+letter", () => {
    expect(renderName({ Template: "{P}/{B}/{F}{L}", GroundLabel: "G" }, { ...ctx, blockName: "IRIS", floorNo: 2, seq: 3 })).toBe("GS/IRIS/2C");
  });
  test("ground floor uses the pattern's ground label", () => {
    expect(renderName({ Template: "{P}/{B}/{F}-{N}", GroundLabel: "GF", NumberStart: 1 }, { ...ctx, floorNo: 0, seq: 4 })).toBe("GS/A/GF-4");
  });
  test("India-standard floor + 2-digit flat no., incl. 2-digit floors", () => {
    const p = { Template: "{P}/{B}/{F}{N:2}", GroundLabel: "G", NumberStart: 1 };
    expect(renderName(p, { ...ctx, floorNo: 12, seq: 4 })).toBe("GS/A/1204");
    expect(renderName(p, { ...ctx, floorNo: 0, seq: 1 })).toBe("GS/A/G01");
    expect(renderName({ ...p, Template: "{P}-{B}-{F:2}{N:2}" }, { ...ctx, floorNo: 1, seq: 1 })).toBe("GS-A-0101");
  });
  test("padded numbers and a custom start", () => {
    expect(renderName({ Template: "{P}/{B}/{F}{N:2}", GroundLabel: "G", NumberStart: 1 }, { ...ctx, floorNo: 1, seq: 1 })).toBe("GS/A/101");
    expect(renderName({ Template: "{P}/{B}/B{N}", GroundLabel: "G", NumberStart: 10 }, { ...ctx, seq: 3 })).toBe("GS/A/B12");
  });
});

describe("letterAt", () => {
  test("skips letters (Springhills / Casablanca style)", () => {
    expect(letterAt(9, "I")).toBe("J");
    expect(letterAt(14, "IO")).toBe("P");
  });
  test("rolls over past Z", () => {
    expect(letterAt(26)).toBe("Z");
    expect(letterAt(27)).toBe("AA");
    expect(letterAt(28)).toBe("AB");
  });
});

describe("validateTemplate", () => {
  test("requires the project short name", () => {
    expect(validateTemplate("T{T}/FL{F}/{L}")).toMatch(/\{P\}/);
  });
  test("requires a block token, a floor token (units) and a sequence", () => {
    expect(validateTemplate("{P}/FL{F}/{L}")).toMatch(/\{T\} or \{B\}/);
    expect(validateTemplate("{P}/{B}/{L}")).toMatch(/\{F\}/);
    expect(validateTemplate("{P}/{B}/{F}")).toMatch(/\{L\} or \{N\}/);
  });
  test("rejects unknown tokens and floor tokens on parking", () => {
    expect(validateTemplate("{P}/{B}/{F}{X}")).toMatch(/Unknown token/);
    expect(validateTemplate("{P}/{B}/{F}{N}", SCOPE.PARKING)).toMatch(/Parking/);
  });
  test("accepts valid unit and parking templates", () => {
    expect(validateTemplate("{P}/T{T}/FL{F}/{L}")).toBeNull();
    expect(validateTemplate("{P}/{B}/P{N:2}", SCOPE.PARKING)).toBeNull();
  });
});

describe("legacyName", () => {
  test("unchanged fixed naming when no pattern is assigned", () => {
    expect(legacyName(SCOPE.UNIT, { shortCode: "RG", blockName: "A", floorLabel: "10", seq: 1 })).toBe("RG/A/1001");
    expect(legacyName(SCOPE.PARKING, { shortCode: "RG", blockName: "A", seq: 7 })).toBe("RG/A/P07");
  });
});
