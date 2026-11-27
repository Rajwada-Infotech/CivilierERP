"use strict";

/**
 * Equipment Master (Engineering → Setup): machines and plant a BOQ can plan for (dbo.EquipmentMaster, migration 724).
 * Name, short code, billing unit (Hour / Day / Month / Trip…), a standard hire rate, owned or hired, description,
 * active on/off. The BOQ's Equipment tab picks from the active ones; the rate is the default on a new line.
 */
const express = require("express");
const router = express.Router();
const apiRateLimit = require("../middleware/apiRateLimit");
router.use(apiRateLimit);
const { getPool, sql } = require("../db");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const { requirePageRight } = require("../middleware/requirePageRight");
const { parseId } = require("../middleware/validateRequest");

const SELECT = `
  SELECT EquipmentId AS id, Name AS name, Code AS code, UomName AS uom, Rate AS rate, Ownership AS ownership,
         Description AS description, IsActive AS isActive, CreatedBy AS createdBy, CreatedAt AS createdAt,
         UpdatedBy AS updatedBy, UpdatedAt AS updatedAt,
         (SELECT COUNT(DISTINCT be.BoqID) FROM dbo.BoqEquipment be WHERE be.EquipmentId = e.EquipmentId) AS usedOnBoqs
  FROM dbo.EquipmentMaster e`;

const text = (v, max) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, max) : null;
};

/** Validates a create/update body. Returns { error } or the clean fields. */
function clean(body) {
  const name = text(body?.name, 150);
  if (!name) return { error: "Enter the equipment's name." };
  const ownership = body?.ownership === "Owned" ? "Owned" : "Hired";
  let rate = null;
  if (body?.rate !== undefined && body?.rate !== null && body?.rate !== "") {
    rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate < 0) return { error: "Rate must be a number of 0 or more." };
    rate = Math.round(rate * 100) / 100;
  }
  return {
    name,
    code: text(body?.code, 30)?.toUpperCase() ?? null,
    uom: text(body?.uom, 50),
    rate,
    ownership,
    description: text(body?.description, 500),
    isActive: body?.isActive === false || body?.isActive === 0 ? 0 : 1,
  };
}

const sameName = async (pool, name, exceptId = null) =>
  (await pool.request().input("n", sql.NVarChar(150), name).input("id", sql.Int, exceptId).query(`
    SELECT TOP 1 EquipmentId FROM dbo.EquipmentMaster WHERE LTRIM(RTRIM(Name)) = @n AND (@id IS NULL OR EquipmentId <> @id)`))
    .recordset.length > 0;

// GET / — every equipment record (?active=1 for just the ones a BOQ may pick).
router.get("/", cache("equipment-master", 300), async (req, res) => {
  try {
    const onlyActive = req.query.active === "1";
    const r = await getPool().request().query(`${SELECT} ${onlyActive ? "WHERE e.IsActive = 1" : ""} ORDER BY e.Name`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[equipment-master] GET /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requirePageRight("equipment-master", "create"), async (req, res) => {
  const f = clean(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  try {
    const pool = getPool();
    if (await sameName(pool, f.name)) return res.status(400).json({ error: `There is already equipment named "${f.name}".` });
    const id = (await pool.request()
      .input("n", sql.NVarChar(150), f.name).input("c", sql.NVarChar(30), f.code).input("u", sql.NVarChar(50), f.uom)
      .input("r", sql.Decimal(18, 2), f.rate).input("o", sql.NVarChar(10), f.ownership).input("d", sql.NVarChar(500), f.description)
      .input("a", sql.Bit, f.isActive).input("by", sql.NVarChar(150), req.user?.email || null).query(`
        INSERT INTO dbo.EquipmentMaster (Name, Code, UomName, Rate, Ownership, Description, IsActive, CreatedBy)
        OUTPUT INSERTED.EquipmentId AS id
        VALUES (@n, @c, @u, @r, @o, @d, @a, @by)`)).recordset[0].id;
    await bumpCacheVersion("equipment-master");
    const row = (await pool.request().input("id", sql.Int, id).query(`${SELECT} WHERE e.EquipmentId = @id`)).recordset[0];
    res.status(201).json(row);
  } catch (err) {
    console.error("[equipment-master] POST /:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requirePageRight("equipment-master", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  const f = clean(req.body);
  if (f.error) return res.status(400).json({ error: f.error });
  try {
    const pool = getPool();
    if (await sameName(pool, f.name, id)) return res.status(400).json({ error: `There is already equipment named "${f.name}".` });
    const r = await pool.request().input("id", sql.Int, id)
      .input("n", sql.NVarChar(150), f.name).input("c", sql.NVarChar(30), f.code).input("u", sql.NVarChar(50), f.uom)
      .input("r", sql.Decimal(18, 2), f.rate).input("o", sql.NVarChar(10), f.ownership).input("d", sql.NVarChar(500), f.description)
      .input("a", sql.Bit, f.isActive).input("by", sql.NVarChar(150), req.user?.email || null).query(`
        UPDATE dbo.EquipmentMaster
        SET Name = @n, Code = @c, UomName = @u, Rate = @r, Ownership = @o, Description = @d, IsActive = @a,
            UpdatedBy = @by, UpdatedAt = SYSUTCDATETIME()
        WHERE EquipmentId = @id`);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Equipment not found." });
    await bumpCacheVersion("equipment-master");
    const row = (await pool.request().input("id", sql.Int, id).query(`${SELECT} WHERE e.EquipmentId = @id`)).recordset[0];
    res.json(row);
  } catch (err) {
    console.error("[equipment-master] PUT /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — only equipment no BOQ uses; one that is used can be switched off instead (it stays on those BOQs).
router.delete("/:id", requirePageRight("equipment-master", "delete"), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const used = (await pool.request().input("id", sql.Int, id).query(
      "SELECT COUNT(DISTINCT BoqID) AS n FROM dbo.BoqEquipment WHERE EquipmentId = @id")).recordset[0].n;
    if (used) return res.status(409).json({ error: `Used on ${used} BOQ${used === 1 ? "" : "s"}, so it can't be deleted. Switch it off instead.` });
    const r = await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.EquipmentMaster WHERE EquipmentId = @id");
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Equipment not found." });
    await bumpCacheVersion("equipment-master");
    res.json({ success: true });
  } catch (err) {
    console.error("[equipment-master] DELETE /:id:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
