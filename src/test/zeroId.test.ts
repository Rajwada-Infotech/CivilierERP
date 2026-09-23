import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { requireValidId } = require("../../backend/utils/routeHelpers.js");

describe("zero IDs are valid route identifiers", () => {
  it("accepts ID 0 as a valid non-negative record identifier", () => {
    const res = { status: () => res, json: () => undefined };
    expect(requireValidId({ params: { id: "0" } }, res)).toBe(0);
  });

  it("rejects negative IDs", () => {
    const res = { status: () => res, json: () => undefined };
    expect(requireValidId({ params: { id: "-1" } }, res)).toBeNull();
  });
});
