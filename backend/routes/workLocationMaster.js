const express = require("express");
const { pageRightByMethod } = require("../middleware/requirePageRight");
const { cache } = require("../middleware/cache");
const { bumpCacheVersion } = require("../redis");
const apiRateLimit = require("../middleware/apiRateLimit");
const { getPool, sql } = require("../db");

const router = express.Router();
router.use(apiRateLimit);

const isUnique = (err) => /UQ_WorkLocationMaster_/i.test(err.message || "");
const uniqueMessage = (err) =>
  /UQ_WorkLocationMaster_Code/i.test(err.message || "")
    ? "A work location with this Location Code already exists"
    : "A work location with this Location Name already exists";

// Validates and normalises the body; returns { error } or { v }.
function parse(body) {
  const name = String(body.LocationName || "").trim();
  const code = String(body.LocationCode || "").trim();
  if (!name) return { error: "Location Name is required" };
  if (!code) return { error: "Location Code is required" };
  const lat = Number(body.Latitude);
  const lng = Number(body.Longitude);
  if (body.Latitude === "" || body.Latitude == null || !Number.isFinite(lat) || lat < -90 || lat > 90) return { error: "Latitude must be a number between -90 and 90" };
  if (body.Longitude === "" || body.Longitude == null || !Number.isFinite(lng) || lng < -180 || lng > 180) return { error: "Longitude must be a number between -180 and 180" };
  const radius = body.RadiusMeters === "" || body.RadiusMeters == null ? 100 : Math.round(Number(body.RadiusMeters));
  if (!Number.isFinite(radius) || radius < 10 || radius > 100000) return { error: "Area radius must be between 10 and 100000 metres" };
  const address = String(body.Address || "").trim().slice(0, 500) || null;
  return { v: { name, code, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, radius, address, active: body.IsActive !== false } };
}

const bind = (req, v) => req
  .input("Name", sql.NVarChar(100), v.name)
  .input("Code", sql.NVarChar(30), v.code)
  .input("Lat", sql.Decimal(9, 6), v.lat)
  .input("Lng", sql.Decimal(9, 6), v.lng)
  .input("Address", sql.NVarChar(500), v.address)
  .input("Radius", sql.Int, v.radius)
  .input("IsActive", sql.Bit, v.active ? 1 : 0);

router.get("/", cache("work-location-master", 300), async (req, res) => {
  try {
    const r = await getPool().request().query(`
      SELECT LocationId, LocationName, LocationCode, Latitude, Longitude, Address, RadiusMeters, IsActive, CreatedAt, UpdatedAt
      FROM dbo.WorkLocationMaster ORDER BY LocationName`);
    res.json(r.recordset);
  } catch (err) {
    console.error("[work-location-master] GET error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", pageRightByMethod("work-location-master"), async (req, res) => {
  const p = parse(req.body || {});
  if (p.error) return res.status(400).json({ error: p.error });
  try {
    await bind(getPool().request(), p.v).input("CreatedBy", sql.Int, req.user?.userId || null).query(`
      INSERT INTO dbo.WorkLocationMaster (LocationName, LocationCode, Latitude, Longitude, Address, RadiusMeters, IsActive, CreatedBy, CreatedAt)
      VALUES (@Name, @Code, @Lat, @Lng, @Address, @Radius, @IsActive, @CreatedBy, SYSUTCDATETIME())`);
    await bumpCacheVersion("work-location-master");
    res.json({ message: "Work location added successfully" });
  } catch (err) {
    if (isUnique(err)) return res.status(409).json({ error: uniqueMessage(err) });
    console.error("[work-location-master] POST error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", pageRightByMethod("work-location-master"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  const p = parse(req.body || {});
  if (p.error) return res.status(400).json({ error: p.error });
  try {
    const r = await bind(getPool().request(), p.v).input("Id", sql.Int, id).input("UpdatedBy", sql.Int, req.user?.userId || null).query(`
      UPDATE dbo.WorkLocationMaster SET LocationName=@Name, LocationCode=@Code, Latitude=@Lat, Longitude=@Lng, Address=@Address,
        RadiusMeters=@Radius, IsActive=@IsActive, UpdatedBy=@UpdatedBy, UpdatedAt=SYSUTCDATETIME()
      WHERE LocationId=@Id`);
    if (!r.rowsAffected[0]) return res.status(404).json({ error: "Work location not found" });
    await bumpCacheVersion("work-location-master");
    res.json({ message: "Work location updated successfully" });
  } catch (err) {
    if (isUnique(err)) return res.status(409).json({ error: uniqueMessage(err) });
    console.error("[work-location-master] PUT error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", pageRightByMethod("work-location-master"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const ex = await pool.request().input("Id", sql.Int, id).query("SELECT LocationName FROM dbo.WorkLocationMaster WHERE LocationId=@Id");
    if (!ex.recordset.length) return res.status(404).json({ error: "Work location not found" });
    await pool.request().input("Id", sql.Int, id).query("DELETE FROM dbo.WorkLocationMaster WHERE LocationId=@Id");
    await bumpCacheVersion("work-location-master");
    res.json({ message: `Work location "${ex.recordset[0].LocationName}" deleted successfully` });
  } catch (err) {
    console.error("[work-location-master] DELETE error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
