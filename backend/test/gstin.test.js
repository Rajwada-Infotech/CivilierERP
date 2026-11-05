// A buyer's GSTIN (services/gstin.js): format, state code, check character,
// and the PAN inside it.
const { checkGstin, gstinCheckChar } = require("../services/gstin");

test("published valid GSTINs pass, normalised to capitals", () => {
  expect(checkGstin("27AAPFU0939F1ZV").value).toBe("27AAPFU0939F1ZV");
  expect(checkGstin(" 29aagcb7383j1z4 ").value).toBe("29AAGCB7383J1Z4");
});

test("blank means an individual buyer", () => {
  expect(checkGstin("")).toEqual({ value: null });
  expect(checkGstin(null)).toEqual({ value: null });
});

test("a mistyped character fails the check character", () => {
  expect(checkGstin("27AAPFU0939F1ZX").error).toMatch(/check character/);
});

test("wrong length, shape or state code is refused", () => {
  expect(checkGstin("27AAPFU0939F1Z").error).toMatch(/15 characters/);
  expect(checkGstin("2AAAPFU0939F1ZV").error).toMatch(/format/);
  expect(checkGstin("45AAPFU0939F1ZV").error).toMatch(/state code/);
});

test("the PAN inside must be the customer's", () => {
  expect(checkGstin("27AAPFU0939F1ZV", { pan: "AAPFU0939F" }).value).toBe("27AAPFU0939F1ZV");
  expect(checkGstin("27AAPFU0939F1ZV", { pan: "ABCDE1234F" }).error).toMatch(/PAN/);
});

test("check character generation matches", () => {
  expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
  const made = `19ZZTST1234Z1Z${gstinCheckChar("19ZZTST1234Z1Z")}`;
  expect(checkGstin(made, { pan: "ZZTST1234Z" }).error).toBeUndefined();
});

describe("place of supply (property: where it is)", () => {
  const { placeOfSupply } = require("../services/gstin");
  test("project and company GSTINs in the same state: CGST + SGST, state named from the code", () => {
    expect(placeOfSupply({ projectGst: "19AALFR5460J1ZO", companyGst: "19BPQPH6856K1Z5" })).toMatchObject({ name: "West Bengal", code: "19", intraState: true });
  });
  test("project registered in another state: IGST", () => {
    expect(placeOfSupply({ projectGst: "27AAPFU0939F1ZV", companyGst: "19BPQPH6856K1Z5" })).toMatchObject({ name: "Maharashtra", intraState: false });
  });
  test("no project GSTIN: typed states, else assumed in-state", () => {
    expect(placeOfSupply({ companyGst: "19BPQPH6856K1Z5", projectState: "Odisha", companyState: "West Bengal" }).intraState).toBe(false);
    expect(placeOfSupply({ companyGst: "19BPQPH6856K1Z5" })).toMatchObject({ name: "West Bengal", intraState: true });
    expect(placeOfSupply({})).toMatchObject({ name: null, intraState: true });
  });
});
