// Status constants must match the database CHECK constraints they mirror.
//
// Status values are code, not master data (see constants/crmStatuses.js for
// why). The cost of that choice is that the same list lives in two places —
// the constant and the CHECK constraint — so this pins them together. Adding a
// value to one and not the other fails here, instead of failing in production
// as a constraint violation on insert or a filter that silently matches nothing.

const fs = require("fs");
const path = require("path");
const { LineStatus, ResaleStatus } = require("../constants/crmStatuses");

const MIG = path.join(__dirname, "..", "migrations", "501-520");
const read = (f) => fs.readFileSync(path.join(MIG, f), "utf8");

// The LAST definition of a CHECK constraint across the migrations is the live
// one, so collect every definition and take the final one.
function checkValues(sources, constraintName) {
  let last = null;
  for (const src of sources) {
    const re = new RegExp(`${constraintName}\\s+CHECK\\s*\\(\\s*\\w+\\s+IN\\s*\\(([^)]*)\\)`, "gi");
    let m;
    while ((m = re.exec(src))) last = m[1];
  }
  if (!last) throw new Error(`No CHECK definition found for ${constraintName}`);
  return [...last.matchAll(/N?'([^']+)'/g)].map((x) => x[1]).sort();
}

describe("status constants match their CHECK constraints", () => {
  test("LineStatus === CK_CrmBookingUnit_Status", () => {
    const db = checkValues(
      [read("505-crm-booking-unit-lines.sql"), read("506-crm-unit-resale.sql")],
      "CK_CrmBookingUnit_Status",
    );
    expect(Object.values(LineStatus).sort()).toEqual(db);
  });

  test("ResaleStatus === CK_CrmUnitResale_Status", () => {
    const db = checkValues([read("506-crm-unit-resale.sql")], "CK_CrmUnitResale_Status");
    expect(Object.values(ResaleStatus).sort()).toEqual(db);
  });

  test("the constants cannot be mutated at runtime", () => {
    expect(Object.isFrozen(LineStatus)).toBe(true);
    expect(Object.isFrozen(ResaleStatus)).toBe(true);
  });
});
