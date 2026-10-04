// Resolves WHICH HSN code applies, from dbo.CrmGstRule (migration 507).
//
// The rate itself is never decided here — it stays in dbo.HSN, read through
// crmGst.getHsnRate(), so there is exactly one place to change a rate. This
// module only answers "which HSN row governs this amount", a decision that used
// to be a hardcoded if/else plus a Rs 45,00,000 JavaScript constant.
//
// FALLBACK IS THE OLD BEHAVIOUR, NOT AN ERROR. If the rule table is empty, or
// no rule matches, the caller keeps whatever it did before rather than losing
// its HSN code. A GST engine that silently stopped taxing because a master row
// was deactivated would be far worse than one that carried on as it always had.

const { sql } = require("../db");

const APPLIES_TO = Object.freeze({
  UNIT_PARKING: "UNIT_PARKING",
  EXTRA_WORK: "EXTRA_WORK",
  CONSTRUCTION_ON_CUSTOMER_LAND: "CONSTRUCTION_ON_CUSTOMER_LAND",
  RESALE_FEE: "RESALE_FEE",
  // The same two charges when the sale is a plot (land). Looked up first for a
  // plot; with no matching rule the ordinary rule applies.
  EXTRA_WORK_LAND: "EXTRA_WORK_LAND",
  RESALE_FEE_LAND: "RESALE_FEE_LAND",
});

/**
 * The HSN code governing `value` for a given kind of supply.
 *
 * @param {object}  pool
 * @param {string}  appliesTo  one of APPLIES_TO
 * @param {object}  ctx
 * @param {number}  ctx.value               pre-tax amount the band is tested against
 * @param {boolean} ctx.landOwnedByCustomer tri-state; undefined/null = unknown,
 *                                          which matches only rules that don't care
 * @param {boolean} ctx.commercial          tri-state, same semantics: true =
 *                                          commercial unit, false = residential,
 *                                          null = unknown (only usage-agnostic rules)
 * @returns {Promise<{hsnCode: string|null, ruleId: number|null, ruleName: string|null}>}
 */
async function resolveHsnCode(pool, appliesTo, { value = 0, landOwnedByCustomer = null, commercial = null } = {}) {
  const amount = Number(value) || 0;

  // Band semantics reproduce the original `base <= 4500000` test exactly:
  // MaxValue is inclusive, MinValue exclusive. Getting that backwards would
  // move every booking sitting precisely on the threshold into the other rate.
  const request = pool
    .request()
    .input("appliesTo", sql.NVarChar(40), appliesTo)
    .input("amount", sql.Decimal(18, 2), amount);

  // A rule with LandOwnedByCustomer NULL doesn't care and always qualifies. A
  // rule that DOES care only qualifies when the caller actually knows the
  // answer — an unknown must never satisfy a rule that demands a specific one.
  const landClause =
    landOwnedByCustomer == null
      ? "r.LandOwnedByCustomer IS NULL"
      : "(r.LandOwnedByCustomer IS NULL OR r.LandOwnedByCustomer = @land)";
  if (landOwnedByCustomer != null) request.input("land", sql.Bit, landOwnedByCustomer ? 1 : 0);
  // Usage (migration 526): identical tri-state contract to land ownership.
  const usageClause =
    commercial == null
      ? "r.ForCommercial IS NULL"
      : "(r.ForCommercial IS NULL OR r.ForCommercial = @commercial)";
  if (commercial != null) request.input("commercial", sql.Bit, commercial ? 1 : 0);

  const result = await request.query(`
    SELECT TOP 1 r.Id, r.Name, r.HsnCode
    FROM dbo.CrmGstRule r
    WHERE r.IsActive = 1
      AND r.AppliesTo = @appliesTo
      AND (r.MinValue IS NULL OR @amount >  r.MinValue)
      AND (r.MaxValue IS NULL OR @amount <= r.MaxValue)
      AND ${landClause}
      AND ${usageClause}
    ORDER BY
      -- A rule that explicitly matches the land-ownership question is more
      -- specific than one that ignores it, so it wins regardless of Priority.
      CASE WHEN r.LandOwnedByCustomer IS NULL THEN 1 ELSE 0 END,
      -- Likewise a rule written for this unit's usage beats a generic one.
      CASE WHEN r.ForCommercial IS NULL THEN 1 ELSE 0 END,
      r.Priority, r.Id
  `);

  const row = result.recordset[0];
  if (!row) return { hsnCode: null, ruleId: null, ruleName: null };
  return { hsnCode: row.HsnCode, ruleId: row.Id, ruleName: row.Name };
}

module.exports = { APPLIES_TO, resolveHsnCode };
