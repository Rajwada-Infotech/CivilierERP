process.env.NODE_ENV = "test";

const { requireValidId } = require("../utils/routeHelpers");

describe("requireValidId", () => {
  it("accepts zero as a valid non-negative id", () => {
    const res = { status: () => res, json: () => {} };
    expect(requireValidId({ params: { id: "0" } }, res)).toBe(0);
  });

  it("rejects negative ids", () => {
    const res = { status: () => res, json: () => {} };
    expect(requireValidId({ params: { id: "-1" } }, res)).toBeNull();
  });

  it("rejects non-numeric ids", () => {
    const res = { status: () => res, json: () => {} };
    expect(requireValidId({ params: { id: "abc" } }, res)).toBeNull();
  });
});
