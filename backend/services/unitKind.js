// Unit kind master (dbo.CrmConstructedAssetKind) — Flat, Villa, Shop, Office…
// One implementation, used by Unit Master (where kinds are managed) and by
// Plot Master (which only reads them when converting a plot into a unit).
// A kind is either land (outside GST) or commercial (commercial GST rule) or
// neither (residential) — never both.

const { getPool, sql } = require("../db");

function parseKind(body) {
  const code = String(body?.Code || "").trim().toUpperCase();
  const name = String(body?.Name || "").trim();
  const sortOrder = Number(body?.SortOrder ?? 100);
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(code) || code === "PLOT") {
    return { error: "Code must use 2-20 uppercase letters, numbers, or underscores and cannot be PLOT" };
  }
  if (!name || name.length > 100) return { error: "Name is required and must be 100 characters or fewer" };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) return { error: "Sort order must be a whole number from 0 to 9999" };
  const isLand = body?.IsLand === true;
  const isCommercial = body?.IsCommercial === true;
  if (isLand && isCommercial) return { error: "A kind can be land or commercial, not both" };
  return { code, name, sortOrder, isLand, isCommercial };
}

const COLS = "Id, Code, Name, SortOrder, IsActive, IsLand, IsCommercial";

async function listKinds({ activeOnly = true } = {}) {
  const r = await getPool().request().query(
    `SELECT ${COLS} FROM dbo.CrmConstructedAssetKind ${activeOnly ? "WHERE IsActive = 1" : ""} ORDER BY IsActive DESC, SortOrder, Name`);
  return r.recordset;
}

// Returns { status, body } so each route just forwards it.
async function createKind(body, userId) {
  const v = parseKind(body);
  if (v.error) return { status: 400, body: { error: v.error } };
  try {
    const r = await getPool().request()
      .input("code", sql.NVarChar(20), v.code).input("name", sql.NVarChar(100), v.name)
      .input("sortOrder", sql.Int, v.sortOrder).input("by", sql.Int, userId || null)
      .input("isLand", sql.Bit, v.isLand).input("isCommercial", sql.Bit, v.isCommercial)
      .query(`INSERT INTO dbo.CrmConstructedAssetKind (Code, Name, SortOrder, IsLand, IsCommercial, IsActive, CreatedBy, CreatedAt)
              OUTPUT ${COLS.split(", ").map((c) => `INSERTED.${c}`).join(", ")}
              VALUES (@code, @name, @sortOrder, @isLand, @isCommercial, 1, @by, SYSDATETIME())`);
    return { status: 201, body: r.recordset[0] };
  } catch (e) {
    if (e.number === 2627 || e.number === 2601) return { status: 409, body: { error: "A unit kind with this code already exists" } };
    throw e;
  }
}

async function updateKind(id, body, userId) {
  if (!Number.isInteger(id) || id <= 0) return { status: 400, body: { error: "Invalid unit kind id" } };
  const v = parseKind(body);
  if (v.error) return { status: 400, body: { error: v.error } };
  try {
    const r = await getPool().request()
      .input("id", sql.Int, id).input("code", sql.NVarChar(20), v.code).input("name", sql.NVarChar(100), v.name)
      .input("sortOrder", sql.Int, v.sortOrder).input("isActive", sql.Bit, body?.IsActive !== false).input("by", sql.Int, userId || null)
      .input("isLand", sql.Bit, v.isLand).input("isCommercial", sql.Bit, v.isCommercial)
      .query(`UPDATE dbo.CrmConstructedAssetKind
              SET Code = @code, Name = @name, SortOrder = @sortOrder, IsLand = @isLand, IsCommercial = @isCommercial,
                  IsActive = @isActive, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
              OUTPUT ${COLS.split(", ").map((c) => `INSERTED.${c}`).join(", ")}
              WHERE Id = @id`);
    if (!r.recordset.length) return { status: 404, body: { error: "Unit kind not found" } };
    return { status: 200, body: r.recordset[0] };
  } catch (e) {
    if (e.number === 2627 || e.number === 2601) return { status: 409, body: { error: "A unit kind with this code already exists" } };
    throw e;
  }
}

/**
 * The unit kinds a project (or block) may use, from its effective project
 * type's flags: commercial kinds need "Sells commercial", the rest need
 * "Sells residential"; land kinds belong to plots, never units. A project
 * with no type set keeps today's freedom (every non-land kind).
 */
async function allowedKinds(pool, { projectId = null, blockId = null } = {}) {
  const { getEffectiveType } = require("./projectType");
  const kinds = (await listKinds({ activeOnly: true })).filter((k) => !k.IsLand);
  if (projectId == null && blockId == null) return kinds;
  const t = await getEffectiveType(pool, { projectId, blockId });
  if (t.Id == null) return kinds;
  return kinds.filter((k) => (k.IsCommercial ? t.SellsCommercial : t.SellsResidential));
}

/** The kind a unit gets when none is chosen — read from the UnitMaster.UnitKind
 *  column default in the database, so nothing here names it. */
async function defaultKind(pool) {
  const r = await pool.request().query(`
    SELECT dc.definition AS d FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.UnitMaster') AND c.name = 'UnitKind'`);
  const m = String(r.recordset[0]?.d || "").match(/'([^']+)'/);
  return m ? m[1].toUpperCase() : null;
}

module.exports = { parseKind, listKinds, createKind, updateKind, allowedKinds, defaultKind };
