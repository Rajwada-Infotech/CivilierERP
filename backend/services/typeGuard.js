// Safety checks for changing a project's or block's type — shared by Auto
// Project Setup, Project Master and anything else that sets a type, so the
// rule is identical everywhere.

const { sql } = require("../db");

// Unsold units / plots in scope that a type would refuse to sell — the same
// rule the booking guard applies (services/projectType.bookingTypeViolation).
async function typeImpact(pool, typeId, { projectId, blockId = null }) {
  const r = await pool.request().input("t", sql.Int, typeId).input("p", sql.Int, projectId).input("b", sql.Int, blockId).query(`
    DECLARE @land BIT, @constr BIT, @resi BIT, @comm BIT;
    SELECT @land = SellsLand, @constr = SellsConstruction,
           @resi = ISNULL(SellsResidential, 1), @comm = ISNULL(SellsCommercial, 0)
    FROM dbo.ProjectTypeMaster WHERE Id = @t;
    SELECT Reason, COUNT(*) AS N FROM (
      SELECT CASE
        WHEN ISNULL(k.IsLand, 0) = 1 THEN CASE WHEN @land = 0 THEN 'land unit' END
        WHEN @constr = 0 THEN 'constructed unit'
        WHEN ISNULL(k.IsCommercial, 0) = 1 AND @comm = 0 THEN 'commercial unit'
        WHEN ISNULL(k.IsCommercial, 0) = 0 AND @resi = 0 THEN 'residential unit'
      END AS Reason
      FROM dbo.UnitMaster u
      LEFT JOIN dbo.BlockMaster bl ON bl.Id = u.BlockId
      LEFT JOIN dbo.CrmConstructedAssetKind k ON k.Code = ISNULL(u.UnitKind, 'FLAT')
      WHERE u.ProjectId = @p AND u.IsActive = 1
        AND ((@b IS NULL AND bl.ProjectTypeId IS NULL) OR u.BlockId = @b)
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBooking bk WHERE bk.UnitId = u.Id AND bk.IsActive = 1)
      UNION ALL
      SELECT CASE WHEN @land = 0 THEN 'plot' END
      FROM dbo.PlotMaster pl LEFT JOIN dbo.BlockMaster bl ON bl.Id = pl.BlockId
      WHERE pl.ProjectId = @p AND pl.IsActive = 1 AND pl.ConvertedUnitId IS NULL
        AND ((@b IS NULL AND bl.ProjectTypeId IS NULL) OR pl.BlockId = @b)
    ) x WHERE Reason IS NOT NULL GROUP BY Reason`);
  return r.recordset.map((x) => `${x.N} ${x.Reason}(s)`).join(", ");
}

// A block that already has floors can't become plots, and one with plots
// can't become a tower — its existing layout would be stranded.
async function layoutConflict(pool, typeId, blockIds) {
  const t = (await pool.request().input("t", sql.Int, typeId).query("SELECT HasFloors FROM dbo.ProjectTypeMaster WHERE Id = @t")).recordset[0];
  if (!t) return "That project type doesn't exist";
  for (const bid of blockIds) {
    const r = (await pool.request().input("b", sql.Int, bid).query(`
      SELECT b.BlockName,
        (SELECT COUNT(*) FROM dbo.CrmProjectAutoSetupFloor f WHERE f.BlockId = b.Id AND f.IsActive = 1) AS Floors,
        (SELECT COUNT(*) FROM dbo.PlotMaster p WHERE p.BlockId = b.Id AND p.IsActive = 1) AS Plots
      FROM dbo.BlockMaster b WHERE b.Id = @b`)).recordset[0];
    if (!r) continue;
    if (!t.HasFloors && r.Floors > 0) return `Block ${r.BlockName} already has floors — it can't become a plots block`;
    if (t.HasFloors && r.Plots > 0) return `Block ${r.BlockName} already has plots — it can't become a tower block`;
  }
  return null;
}

/**
 * Everything wrong with giving a project (all blocks that follow it) a type.
 * Returns an error message, or null when the change is safe.
 */
async function projectTypeChangeProblem(pool, projectId, typeId) {
  if (typeId == null) return null;
  const followers = (await pool.request().input("p", sql.Int, projectId)
    .query("SELECT Id FROM dbo.BlockMaster WHERE ProjectId = @p AND IsActive = 1 AND ProjectTypeId IS NULL")).recordset.map((b) => b.Id);
  const clash = await layoutConflict(pool, typeId, followers);
  if (clash) return clash;
  const why = await typeImpact(pool, typeId, { projectId });
  return why ? `This type would make ${why} unsellable — pick a type that sells them.` : null;
}

module.exports = { typeImpact, layoutConflict, projectTypeChangeProblem };
