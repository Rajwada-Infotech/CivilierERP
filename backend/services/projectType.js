// Project / block type resolution, and the rule that decides how a sale is
// taxed and which income head it lands in.
//
// TWO SEPARATE CONCERNS, deliberately kept apart:
//
//   * PROJECT (or BLOCK) TYPE drives presentation and defaults — whether the
//     unit matrix shows a floor grid or a site map, which auto-setup path runs,
//     which masters are even offered. See migration 482.
//
//   * UNIT KIND drives money — GST or no GST, and which income head is
//     credited. See migration 483 and unitSaleTreatment() below.
//
// Mixing those two is the trap. A mixed township (migration 482's 'MIXED')
// holds both tower and plotted blocks, so a booking there may contain either.
// Deriving taxability from the project would silently tax land the moment such
// a project exists. Deriving it from the unit is correct everywhere, including
// mixed, with no special case at all — so nothing in this file lets a caller
// ask "is this project GST-free?", because that question has no correct answer.

const { sql } = require("../db");
// Same paise rounding the multi-unit pricing uses, so an apportioned land/
// construction split and the line allocations it came from agree exactly.
const { round2 } = require("./bookingUnits");

// What an unset type means. Every project that existed before migration 482 has
// project_type_id NULL, and must keep behaving exactly as CRM did then:
// floor-stacked, one unit per booking, taxable construction. Treated as a real
// value rather than an error so nothing has to be backfilled on a live system.
const LEGACY_DEFAULT = Object.freeze({
  Id: null,
  Code: null,
  Name: "Unset (legacy high-rise behaviour)",
  HasFloors: true,
  SellsLand: false,
  SellsConstruction: true,
  AllowsMultiUnitSale: false,
});

// Unit kinds. 'FLAT' is the implicit kind of every row that predates 483.
const UNIT_KIND = Object.freeze({ FLAT: "FLAT", PLOT: "PLOT", VILLA: "VILLA" });

const INCOME_ACCOUNT = Object.freeze({
  // Must match the GL heads seeded by migrations 472 and 484 exactly.
  CONSTRUCTION: "Sale of Flat/Parking",
  LAND: "Sale of Land",
});

function normaliseRow(row) {
  if (!row) return { ...LEGACY_DEFAULT };
  return {
    Id: row.Id,
    Code: row.Code,
    Name: row.Name,
    // mssql returns BIT as a JS boolean, but be tolerant of 1/0 too — the same
    // bug that silently emptied every project-bank dropdown once already
    // (crmProjectBanks.js) came from assuming one of the two.
    HasFloors: !!row.HasFloors,
    SellsLand: !!row.SellsLand,
    SellsConstruction: !!row.SellsConstruction,
    AllowsMultiUnitSale: !!row.AllowsMultiUnitSale,
  };
}

/**
 * The effective type for a block, or for a project when no block is given.
 *
 * A block's own ProjectTypeId wins; NULL there means "inherit the project",
 * which is what every block created before migration 482 has. If neither
 * carries a type, LEGACY_DEFAULT applies.
 *
 * Ids of 0 are legitimate in this database (a historical identity reseed left
 * the first row of ~20 tables at Id 0), so every check here is `!= null` and
 * never a truthiness test — `if (!blockId)` would silently ignore block 0.
 */
async function getEffectiveType(pool, { projectId = null, blockId = null } = {}) {
  if (blockId == null && projectId == null) return { ...LEGACY_DEFAULT };

  const request = pool.request();
  if (blockId != null) request.input("blockId", sql.Int, blockId);
  if (projectId != null) request.input("projectId", sql.Int, projectId);

  // One round trip: the block's own type, else its project's, else the project
  // passed in. COALESCE over the join does the inheritance.
  const result = await request.query(`
    SELECT TOP 1 pt.Id, pt.Code, pt.Name,
           pt.HasFloors, pt.SellsLand, pt.SellsConstruction, pt.AllowsMultiUnitSale
    FROM (
      SELECT COALESCE(
        ${blockId != null ? "(SELECT b.ProjectTypeId FROM dbo.BlockMaster b WHERE b.Id = @blockId)," : ""}
        ${blockId != null ? "(SELECT e.project_type_id FROM dbo.enterprise e WHERE e.id = (SELECT b2.ProjectId FROM dbo.BlockMaster b2 WHERE b2.Id = @blockId))," : ""}
        ${projectId != null ? "(SELECT e2.project_type_id FROM dbo.enterprise e2 WHERE e2.id = @projectId)," : ""}
        NULL
      ) AS TypeId
    ) resolved
    JOIN dbo.ProjectTypeMaster pt ON pt.Id = resolved.TypeId AND pt.IsActive = 1
  `);

  return normaliseRow(result.recordset[0]);
}

/**
 * How a unit's sale is treated for tax and accounting. THIS is the function
 * money decisions go through — never the project type.
 *
 * Land is outside GST altogether (Schedule III, CGST Act: neither a supply of
 * goods nor of services), so a PLOT carries no output tax and must also stay
 * out of any GST rate-bracket computation. The Rs 45 lakh bracket in
 * crmGst.js is an affordable-HOUSING threshold applied to construction value;
 * letting plot value into it would misprice every villa in a plotted project.
 */
function unitSaleTreatment(unitKind) {
  const kind = String(unitKind || UNIT_KIND.FLAT).toUpperCase();
  const isLand = kind === UNIT_KIND.PLOT;
  return {
    kind,
    isLand,
    // Land: no GST, and excluded from the affordable-housing bracket maths.
    gstApplicable: !isLand,
    countsTowardGstBracket: !isLand,
    incomeAccount: isLand ? INCOME_ACCOUNT.LAND : INCOME_ACCOUNT.CONSTRUCTION,
  };
}

/**
 * The treatment for a whole booking, from the kinds of unit on it.
 *
 * A booking may legitimately mix kinds (a plot and the villa on it sold as one
 * package), so this reports whether each component is present rather than
 * collapsing to a single answer. Callers that must split GST use
 * `hasLand && hasConstruction` to detect the case that needs apportioning
 * instead of one blended rate.
 */
function bookingSaleTreatment(unitKinds = []) {
  const treatments = unitKinds.map(unitSaleTreatment);
  const hasLand = treatments.some((t) => t.isLand);
  const hasConstruction = treatments.some((t) => !t.isLand);
  return {
    hasLand,
    hasConstruction,
    isMixed: hasLand && hasConstruction,
    // Only meaningful when not mixed; mixed bookings must apportion per line.
    incomeAccount: hasConstruction ? INCOME_ACCOUNT.CONSTRUCTION : INCOME_ACCOUNT.LAND,
    gstApplicable: hasConstruction,
  };
}

/**
 * Split a booking's value into its LAND and CONSTRUCTION halves.
 *
 * Sale of land is outside GST altogether — Schedule III of the CGST Act, the
 * same entry that exempts a completed building post-OC (checkGstExemption
 * above). It is not a zero-rated or exempt supply: it is not a supply at all.
 *
 * Two consequences, and the second is the one that is easy to miss:
 *   1. No output tax on the land consideration.
 *   2. Land value must stay OUT of the Rs 45 lakh bracket test. That threshold
 *      is an affordable-HOUSING test on construction value; feeding plot value
 *      into it would push the construction half of a plotted project over the
 *      bracket and silently reprice every villa from 1% to 5%.
 *
 * Derived from the UNIT KIND on the booking's lines (migrations 483/485), never
 * from the project's type — a mixed township holds both plotted and tower
 * blocks, so the project cannot answer this question. See services/projectType.js.
 *
 * Bookings predating migration 485 have no lines; they fall back to the single
 * unit CrmBooking.UnitId points at, which for all existing data is a FLAT.
 */
async function getBookingLandSplit(pool, bookingId, totalValue) {
  const rows = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT u.UnitKind, l.AllocatedValue
    FROM dbo.CrmBookingUnit l
    JOIN dbo.UnitMaster u ON u.Id = l.UnitId
    WHERE l.BookingId = @bid AND l.Status = N'Active'
    UNION ALL
    -- Pre-485 fallback: no lines, so use the booking's own primary unit.
    SELECT u2.UnitKind, b.TotalValue
    FROM dbo.CrmBooking b
    JOIN dbo.UnitMaster u2 ON u2.Id = b.UnitId
    WHERE b.Id = @bid
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingUnit l2 WHERE l2.BookingId = @bid AND l2.Status = N'Active')
  `);

  const lines = rows.recordset;
  // No resolvable unit at all: treat the whole value as construction. Failing
  // the other way would zero-rate a taxable sale.
  if (!lines.length) {
    return { landValue: 0, constructionValue: round2(totalValue), isPureLand: false, hasLand: false };
  }

  let landValue = 0;
  let constructionValue = 0;
  for (const l of lines) {
    const v = Number(l.AllocatedValue || 0);
    if (String(l.UnitKind || "").toUpperCase() === "PLOT") landValue += v;
    else constructionValue += v;
  }

  const hasLand = lines.some((l) => String(l.UnitKind || "").toUpperCase() === "PLOT");
  const isPureLand = hasLand && constructionValue === 0;

  // AllocatedValue can lag a booking edit (it is written when lines are priced).
  // For a pure-land booking the split is unambiguous regardless of that, so trust
  // the booking's own TotalValue rather than a possibly stale allocation.
  if (isPureLand) return { landValue: round2(totalValue), constructionValue: 0, isPureLand: true, hasLand: true };

  return {
    landValue: round2(landValue),
    constructionValue: round2(hasLand ? constructionValue : totalValue),
    isPureLand: false,
    hasLand,
  };
}

module.exports = {
  LEGACY_DEFAULT,
  UNIT_KIND,
  INCOME_ACCOUNT,
  getEffectiveType,
  getBookingLandSplit,
  unitSaleTreatment,
  bookingSaleTreatment,
};
