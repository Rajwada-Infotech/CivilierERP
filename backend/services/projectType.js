// Project / block type resolution, and the rule that decides how a sale is
// taxed and which income head it lands in.
//
// TWO SEPARATE CONCERNS, deliberately kept apart:
//
//   * PROJECT (or BLOCK) TYPE drives presentation and defaults — whether the
//     unit matrix shows a floor grid or a site map, which auto-setup path runs,
//     which masters are even offered. See migration 502.
//
//   * UNIT KIND drives money — GST or no GST, and which income head is
//     credited. See migration 503 and unitSaleTreatment() below.
//
// Mixing those two is the trap. A mixed township (migration 502's 'MIXED')
// holds both tower and plotted blocks, so a booking there may contain either.
// Deriving taxability from the project would silently tax land the moment such
// a project exists. Deriving it from the unit is correct everywhere, including
// mixed, with no special case at all — so nothing in this file lets a caller
// ask "is this project GST-free?", because that question has no correct answer.

const { sql } = require("../db");
// Same paise rounding the multi-unit pricing uses, so an apportioned land/
// construction split and the line allocations it came from agree exactly.
const { round2 } = require("./bookingUnits");

// What an unset type means. Every project that existed before migration 502 has
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
  SellsResidential: true,
  SellsCommercial: false,
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
    // Migration 526. Absent on a pre-526 database -> today's behaviour.
    SellsResidential: row.SellsResidential == null ? true : !!row.SellsResidential,
    SellsCommercial: !!row.SellsCommercial,
  };
}

/**
 * The effective type for a block, or for a project when no block is given.
 *
 * A block's own ProjectTypeId wins; NULL there means "inherit the project",
 * which is what every block created before migration 502 has. If neither
 * carries a type, LEGACY_DEFAULT applies.
 *
 * Ids of 0 are legitimate in this database (a historical identity reseed left
 * the first row of ~20 tables at Id 0), so every check here is `!= null` and
 * never a truthiness test — `if (!blockId)` would silently ignore block 0.
 */
// Migration 526 columns — read only once they exist, so a database that
// hasn't run it yet keeps working with today's behaviour.
let usageCols = null;
async function usageColumnsSql(pool) {
  if (usageCols === null) {
    const r = await pool.request().query("SELECT COL_LENGTH('dbo.ProjectTypeMaster', 'SellsCommercial') AS c");
    usageCols = r.recordset?.[0]?.c != null ? ", pt.SellsResidential, pt.SellsCommercial" : "";
    if (!usageCols) setTimeout(() => { usageCols = null; }, 60000); // re-check after a migration
  }
  return usageCols;
}

async function getEffectiveType(pool, { projectId = null, blockId = null } = {}) {
  if (blockId == null && projectId == null) return { ...LEGACY_DEFAULT };
  const extraCols = await usageColumnsSql(pool);

  const request = pool.request();
  if (blockId != null) request.input("blockId", sql.Int, blockId);
  if (projectId != null) request.input("projectId", sql.Int, projectId);

  // One round trip: the block's own type, else its project's, else the project
  // passed in. COALESCE over the join does the inheritance.
  const result = await request.query(`
    SELECT TOP 1 pt.Id, pt.Code, pt.Name,
           pt.HasFloors, pt.SellsLand, pt.SellsConstruction, pt.AllowsMultiUnitSale${extraCols}
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
/**
 * The land register: which unit kinds are land, read from
 * dbo.CrmConstructedAssetKind.IsLand (migration 517).
 *
 * This replaces a `kind === 'PLOT'` comparison that became unsafe the moment
 * migration 512 dropped the CHECK constraint on UnitMaster.UnitKind and made
 * kinds an editable master. A kind added from the UI as COMMERCIAL_PLOT or
 * FARM_LAND would otherwise have been taxed as construction, silently.
 *
 * Returned as a Set of codes so the pure functions below stay synchronous and
 * testable: callers that touch the database load it once and pass it down.
 */
/**
 * The commercial register: which unit kinds are commercial (shop, office…),
 * read from dbo.CrmConstructedAssetKind.IsCommercial (migration 526). Same
 * contract as loadLandKinds — a Set of codes, loaded once, passed down.
 */
async function loadCommercialKinds(pool) {
  const has = await pool.request().query("SELECT COL_LENGTH('dbo.CrmConstructedAssetKind', 'IsCommercial') AS c");
  if (has.recordset?.[0]?.c == null) return new Set(); // pre-526: nothing is commercial
  const r = await pool.request().query(
    "SELECT Code FROM dbo.CrmConstructedAssetKind WHERE IsCommercial = 1",
  );
  return new Set(r.recordset.map((x) => String(x.Code || "").toUpperCase()));
}

/**
 * Whether a booking's constructed units are commercial: true (all commercial),
 * false (none), null (no constructed units, e.g. a pure plot sale). Read from
 * the units' kinds, never the project — a Gloria-style building holds both.
 */
async function getBookingCommercial(pool, bookingId) {
  const hasCol = await pool.request().query("SELECT COL_LENGTH('dbo.CrmConstructedAssetKind', 'IsCommercial') AS c");
  if (hasCol.recordset?.[0]?.c == null) return null; // pre-526: usage unknown -> usage-agnostic GST rules
  const r = await pool.request().input("bid", sql.Int, bookingId).query(`
    SELECT ISNULL(k.IsCommercial, 0) AS IsCommercial
    FROM (
      SELECT u.UnitKind FROM dbo.CrmBookingUnit l JOIN dbo.UnitMaster u ON u.Id = l.UnitId
      WHERE l.BookingId = @bid AND l.Status = N'Active'
      UNION ALL
      SELECT u2.UnitKind FROM dbo.CrmBooking b JOIN dbo.UnitMaster u2 ON u2.Id = b.UnitId
      WHERE b.Id = @bid
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingUnit l2 WHERE l2.BookingId = @bid AND l2.Status = N'Active')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = @bid AND bp.Status = N'Active')
    ) x
    LEFT JOIN dbo.CrmConstructedAssetKind k ON k.Code = x.UnitKind
  `);
  if (!r.recordset.length) return null;
  return r.recordset.every((x) => x.IsCommercial === true || x.IsCommercial === 1);
}

/** Same answer for a single unit (quotes / forms before a booking exists). */
async function getUnitCommercial(pool, unitId) {
  const hasCol = await pool.request().query("SELECT COL_LENGTH('dbo.CrmConstructedAssetKind', 'IsCommercial') AS c");
  if (hasCol.recordset?.[0]?.c == null) return null; // pre-526: usage unknown -> usage-agnostic GST rules
  if (unitId == null) return null;
  const r = await pool.request().input("uid", sql.Int, unitId).query(`
    SELECT ISNULL(k.IsCommercial, 0) AS IsCommercial
    FROM dbo.UnitMaster u LEFT JOIN dbo.CrmConstructedAssetKind k ON k.Code = u.UnitKind
    WHERE u.Id = @uid`);
  if (!r.recordset.length) return null;
  return r.recordset[0].IsCommercial === true || r.recordset[0].IsCommercial === 1;
}

async function loadLandKinds(pool) {
  const r = await pool.request().query(
    "SELECT Code FROM dbo.CrmConstructedAssetKind WHERE IsLand = 1",
  );
  return new Set(r.recordset.map((x) => String(x.Code || "").toUpperCase()));
}

/**
 * How a unit's sale is treated for tax and accounting. THIS is the function
 * money decisions go through — never the project type.
 *
 * Land is outside GST altogether (Schedule III, CGST Act: neither a supply of
 * goods nor of services), so a land kind carries no output tax and must also
 * stay out of any GST rate-bracket computation. The Rs 45 lakh bracket in
 * crmGst.js is an affordable-HOUSING threshold applied to construction value;
 * letting land value into it would misprice every villa in a plotted project.
 *
 * @param {Set<string>} [landKinds] from loadLandKinds(). Omitted, it falls back
 *   to PLOT alone — the pre-497 behaviour, which keeps this function pure for
 *   tests and keeps a caller that forgot to load the register SAFE rather than
 *   wrong: the fallback can only ever under-claim land, never over-claim it,
 *   and over-claiming is what would zero-rate a taxable sale.
 */
function unitSaleTreatment(unitKind, landKinds = null) {
  const kind = String(unitKind || UNIT_KIND.FLAT).toUpperCase();
  const isLand = landKinds ? landKinds.has(kind) : kind === UNIT_KIND.PLOT;
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
function bookingSaleTreatment(unitKinds = [], landKinds = null) {
  // Note the explicit arrow: passing unitSaleTreatment straight to .map()
  // would hand it the ARRAY INDEX as its second argument, which is the
  // landKinds slot — a truthy index would then be used as a Set.
  const treatments = unitKinds.map((k) => unitSaleTreatment(k, landKinds));
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
 * Derived from the UNIT KIND on the booking's lines (migrations 503/505), never
 * from the project's type — a mixed township holds both plotted and tower
 * blocks, so the project cannot answer this question. See services/projectType.js.
 *
 * Bookings predating migration 505 have no lines; they fall back to the single
 * unit CrmBooking.UnitId points at, which for all existing data is a FLAT.
 */
async function getBookingLandSplit(pool, bookingId, totalValue) {
  const rows = await pool.request().input("bid", sql.Int, bookingId).query(`
    -- Land sold as PLOTS. Migration 511 moved plot inventory out of UnitMaster
    -- into dbo.PlotMaster, with dbo.CrmBookingPlot as its booking line — so a
    -- plot booking has NO CrmBookingUnit row at all. Reading only the unit
    -- lines (as this did before) classified a pure-land booking as construction
    -- and taxed the land, which is exactly backwards.
    -- Flagged land STRUCTURALLY, not by kind. A CrmBookingPlot row references
    -- dbo.PlotMaster, which is land inventory by definition — so this must not
    -- depend on the kind register. Tagging these rows 'PLOT' and looking the
    -- code up would mean that clearing IsLand on that one master row, or
    -- deactivating it, silently made every plot booking taxable.
    SELECT CAST(1 AS BIT) AS IsLandLine, CAST(NULL AS NVARCHAR(20)) AS UnitKind, bp.AllocatedValue
    FROM dbo.CrmBookingPlot bp
    WHERE bp.BookingId = @bid AND bp.Status = N'Active'
    UNION ALL
    -- Constructed assets (flat / villa), plus any early UnitMaster PLOT rows
    -- that predate 491 and are kept for historical foreign keys.
    SELECT CAST(0 AS BIT) AS IsLandLine, u.UnitKind, l.AllocatedValue
    FROM dbo.CrmBookingUnit l
    JOIN dbo.UnitMaster u ON u.Id = l.UnitId
    WHERE l.BookingId = @bid AND l.Status = N'Active'
    UNION ALL
    -- Pre-485 fallback: no lines of EITHER kind, so use the booking's own
    -- primary unit. Guarded on both tables, or a plot booking would also pick
    -- up its UnitId here and be double-counted.
    SELECT CAST(0 AS BIT) AS IsLandLine, u2.UnitKind, b.TotalValue
    FROM dbo.CrmBooking b
    JOIN dbo.UnitMaster u2 ON u2.Id = b.UnitId
    WHERE b.Id = @bid
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingUnit l2 WHERE l2.BookingId = @bid AND l2.Status = N'Active')
      AND NOT EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp2 WHERE bp2.BookingId = @bid AND bp2.Status = N'Active')
  `);

  const lines = rows.recordset;
  // No resolvable unit at all: treat the whole value as construction. Failing
  // the other way would zero-rate a taxable sale.
  if (!lines.length) {
    return { landValue: 0, constructionValue: round2(totalValue), isPureLand: false, hasLand: false };
  }

  // Which kinds count as land comes from the master (migration 517), not from
  // a comparison against the literal 'PLOT'. A kind added as COMMERCIAL_PLOT or
  // FARM_LAND is land the moment it is flagged, with no code change.
  const landKinds = await loadLandKinds(pool);
  // A line is land if its SOURCE says so (PlotMaster-backed), or if its kind
  // is registered as land. The structural test comes first so plot bookings
  // cannot be affected by a master edit.
  const isLandLine = (r) =>
    r.IsLandLine === true || r.IsLandLine === 1 ||
    landKinds.has(String(r.UnitKind || "").toUpperCase());

  let landValue = 0;
  let constructionValue = 0;
  for (const l of lines) {
    const v = Number(l.AllocatedValue || 0);
    if (isLandLine(l)) landValue += v;
    else constructionValue += v;
  }

  const hasLand = lines.some((l) => isLandLine(l));
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

/**
 * Booking-time guard: the units on a booking must be something their project
 * (or block) type actually sells, and several units may share one booking only
 * when the type allows it. Rules come from the type's own flags, never its
 * code or name, so a type added in Project Type Master is enforced as-is.
 *
 * Only an EXPLICITLY set type is enforced. An unset type (LEGACY_DEFAULT) keeps
 * today's behaviour untouched, so nothing already live starts failing.
 *
 * @param {Array<{Id:number, UnitName:string, ProjectId:number, BlockId:number, UnitKind?:string}>} units
 * @param {{isPlotBooking?:boolean, landKinds?:Set<string>}} opts
 * @returns {Promise<string|null>} a user-facing reason, or null when allowed
 */
async function bookingTypeViolation(pool, units, { isPlotBooking = false, landKinds = null, commercialKinds = null } = {}) {
  const isCommercial = (u) => !!commercialKinds && commercialKinds.has(String(u.UnitKind || UNIT_KIND.FLAT).toUpperCase());
  const cache = new Map();
  const typeOf = async (u) => {
    const key = `${u.ProjectId}|${u.BlockId}`;
    if (!cache.has(key)) cache.set(key, await getEffectiveType(pool, { projectId: u.ProjectId ?? null, blockId: u.BlockId ?? null }));
    return cache.get(key);
  };
  for (const u of units) {
    const t = await typeOf(u);
    if (t.Id == null) continue; // unset -> legacy behaviour, not enforced
    if (units.length > 1 && !t.AllowsMultiUnitSale) {
      return `${t.Name} allows one unit per booking — ${units.length} were selected. Turn on "Several units per booking" for this type in Project Type Master, or book them separately.`;
    }
    const isLand = isPlotBooking || unitSaleTreatment(u.UnitKind, landKinds).isLand;
    if (isLand && !t.SellsLand) {
      return `${u.UnitName} is land, but ${t.Name} does not sell land. Check the unit's kind, or turn on "Sells land" for this type.`;
    }
    if (!isLand && !t.SellsConstruction) {
      return `${u.UnitName} is a constructed unit, but ${t.Name} does not sell construction. Check the unit's kind, or turn on "Sells construction" for this type.`;
    }
    if (!isLand && isCommercial(u) && !t.SellsCommercial) {
      return `${u.UnitName} is a commercial unit, but ${t.Name} does not sell commercial units. Check the unit's kind, or turn on "Sells commercial" for this type.`;
    }
    if (!isLand && !isCommercial(u) && !t.SellsResidential) {
      return `${u.UnitName} is a residential unit, but ${t.Name} does not sell residential units. Check the unit's kind, or turn on "Sells residential" for this type.`;
    }
  }
  // One booking takes one GST treatment, so commercial and residential units
  // can't share a booking (the HSN is resolved per booking, not per line).
  const constructed = isPlotBooking ? [] : units.filter((u) => !unitSaleTreatment(u.UnitKind, landKinds).isLand);
  if (constructed.some(isCommercial) && constructed.some((u) => !isCommercial(u))) {
    return "Commercial and residential units are taxed differently and can't be on one booking — book them separately.";
  }
  return null;
}

module.exports = {
  LEGACY_DEFAULT,
  bookingTypeViolation,
  loadCommercialKinds,
  getBookingCommercial,
  getUnitCommercial,
  UNIT_KIND,
  INCOME_ACCOUNT,
  getEffectiveType,
  loadLandKinds,
  getBookingLandSplit,
  unitSaleTreatment,
  bookingSaleTreatment,
};
