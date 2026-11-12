"use strict";
// Deed Registration workspace (mounted at /api/legal/deed-reg). One land, five steps:
//   1. Consideration (total, rate, advance, mode of payment)  2. Registration & Stamp Duty queries (date, amount, fee type)
//   3. Apply to deed register (approver — existing POST /api/legal/land/:id/deed-registration)
//   4. Final Registration (date, office, mode, deed number) → upload the registered deed and submit (existing route)
//   5. Physical Deed / IGR tracking (link, IGR status, where the deed is), kept as history; continues after Registered.
// Every choice list comes from Setup (Payment Mode, Registration Fee Type, Deed Registration Office, Registration Mode,
// IGR Status, Deed Location, Area Unit).
const express = require("express");
const { getPool, sql } = require("../../db");
const { requirePageRight } = require("../../middleware/requirePageRight");
const { canAct } = require("./approvalAuthority");
const { writeAudit } = require("./legalAudit");
const apiRateLimit = require("../../middleware/apiRateLimit");

const router = express.Router();
router.use(apiRateLimit);
const PAGE = "legal-land-master";

const idOf = (v) => (/^\d+$/.test(String(v ?? "")) ? Number(v) : null);
const txt = (v, n) => { const s = String(v ?? "").trim(); return s ? s.slice(0, n) : null; };
const dateOf = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
const money = (v) => { if (v === "" || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e15 ? Math.round(n * 100) / 100 : NaN; };
const urlOf = (v) => { const s = txt(v, 500); return s && /^https?:\/\/[^\s]+$/i.test(s) ? s : null; };

async function ready(pool) {
  return !!(await pool.request().query("SELECT OBJECT_ID('dbo.LegalDeedTracking','U') AS t")).recordset[0].t;
}
const notReady = (res) => res.status(503).json({ error: "Deed Registration details are not set up yet — run the database migrations (659)" });
const lookupOk = async (pool, id, category) => !id || !!(await pool.request().input("i", sql.Int, id).input("c", sql.NVarChar(40), category)
  .query("SELECT 1 AS x FROM dbo.LegalLookupValue WHERE LookupId = @i AND Category = @c")).recordset[0];
const landIn = async (pool, id) => (await pool.request().input("i", sql.Int, id)
  .query("SELECT LandId, LandCode, WorkflowStatus FROM dbo.LegalLand WHERE LandId = @i AND IsActive = 1")).recordset[0];
const lk = (col) => `(SELECT Name FROM dbo.LegalLookupValue WHERE LookupId = l.${col})`;

// GET /list?tab=active|registered — lands at Deed Registration (active) or registered (deed tracking still going).
router.get("/list", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const tab = req.query.tab === "registered" ? "registered" : "active";
    const rows = (await pool.request().query(`
      SELECT l.LandId, l.LandCode, l.LandName, d.DistrictName, m.MouzaName, l.WorkflowStatus, l.RsDagNo, l.LrDagNo,
             CONVERT(char(10), l.DeedTargetDate, 23) AS DeedTargetDate, l.L2ApprovedAt,
             l.ConsTotalAmount, l.ConsAdvanceAmount,
             (SELECT COUNT(*) FROM dbo.LegalStampDutyQuery q WHERE q.LandId = l.LandId) AS Queries,
             (SELECT SUM(q.Amount) FROM dbo.LegalStampDutyQuery q WHERE q.LandId = l.LandId) AS QueryTotal,
             l.RegAppliedAt, DATEDIFF(day, l.RegAppliedAt, SYSUTCDATETIME()) AS RegDaysOpen,
             CONVERT(char(10), l.RegFinalDate, 23) AS RegFinalDate, l.RegDeedNo, l.RegDeedFileId, l.RegCompletedAt,
             ${lk("IgrStatusId")} AS IgrStatus, ${lk("DeedLocationId")} AS DeedLocation
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      WHERE l.IsActive = 1 AND l.WorkflowStatus = ${tab === "registered" ? "N'Registered'" : "N'Deed Registration'"}
      ORDER BY ${tab === "registered" ? "l.RegCompletedAt DESC" : "l.L2ApprovedAt DESC"}`)).recordset;
    const canApply = (await canAct(req, "L1 Approver", PAGE)) || (await canAct(req, "L2 Approver", PAGE));
    res.json({ lands: rows, canApply });
  } catch (err) {
    console.error("[legal-deed-reg] list:", err.message);
    res.status(500).json({ error: "Could not load Deed Registration" });
  }
});

// GET /:id — everything the five steps show for one land.
router.get("/:id", requirePageRight(PAGE, "view"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const land = (await pool.request().input("i", sql.Int, id).query(`
      SELECT l.LandId, l.LandCode, l.LandName, l.WorkflowStatus, d.DistrictName, m.MouzaName, m.JLNo, l.RsDagNo, l.RsKhatianNo, l.LrDagNo, l.LrKhatianNo,
             CAST(l.Area AS FLOAT) AS Area, u.UnitName, CONVERT(char(10), l.DeedTargetDate, 23) AS DeedTargetDate,
             (SELECT name FROM dbo.users WHERE id = l.L1ReviewerId) AS L1By, (SELECT name FROM dbo.users WHERE id = l.L2ApproverId) AS L2By, l.L2ApprovedAt,
             (SELECT STRING_AGG(o.OwnerName + N' (' + CAST(CAST(o.SharePct AS DECIMAL(7,2)) AS NVARCHAR(10)) + N'%)', N', ')
                FROM dbo.LegalOwnershipRecord o WHERE o.LandId = l.LandId AND o.IsActive = 1 AND o.ValidTo IS NULL) AS Owners,
             (SELECT TOP 1 v.GovernmentValuation FROM dbo.LegalValuation v WHERE v.LandId = l.LandId AND v.IsActive = 1 ORDER BY v.ValuationDate DESC) AS GovtValue,
             l.DeedFileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = l.DeedFileId) AS DeedFileName,
             l.ConsTotalAmount, l.ConsRate, l.ConsRateUnitId, (SELECT UnitName FROM dbo.LegalAreaUnit x WHERE x.AreaUnitId = l.ConsRateUnitId) AS ConsRateUnit,
             l.ConsAdvanceAmount, l.ConsPaymentModeId, ${lk("ConsPaymentModeId")} AS ConsPaymentMode, l.ConsRemarks,
             l.RegAppliedAt, (SELECT name FROM dbo.users WHERE id = l.RegAppliedBy) AS RegAppliedByName, DATEDIFF(day, l.RegAppliedAt, SYSUTCDATETIME()) AS RegDaysOpen,
             CONVERT(char(10), l.RegFinalDate, 23) AS RegFinalDate, l.RegOfficeId, (SELECT OfficeName FROM dbo.LegalRegistrationOffice r WHERE r.OfficeId = l.RegOfficeId) AS RegOffice,
             l.RegModeId, ${lk("RegModeId")} AS RegMode, l.RegDeedNo,
             l.RegDeedFileId, (SELECT FileName FROM dbo.LegalMasterFile f WHERE f.FileId = l.RegDeedFileId) AS RegDeedFileName, l.RegCompletedAt,
             (SELECT name FROM dbo.users WHERE id = l.RegCompletedBy) AS RegCompletedByName,
             l.IgrTrackingUrl, l.IgrStatusId, ${lk("IgrStatusId")} AS IgrStatus, l.DeedLocationId, ${lk("DeedLocationId")} AS DeedLocation
      FROM dbo.LegalLand l
      LEFT JOIN dbo.LegalDistrict d ON d.DistrictId = l.DistrictId
      LEFT JOIN dbo.LegalMouza m ON m.MouzaId = l.MouzaId
      LEFT JOIN dbo.LegalAreaUnit u ON u.AreaUnitId = l.AreaUnitId
      WHERE l.LandId = @i AND l.IsActive = 1`)).recordset[0];
    if (!land) return res.status(404).json({ error: "Land not found" });
    const queries = (await pool.request().input("i", sql.Int, id).query(`
      SELECT q.QueryId, CONVERT(char(10), q.QueryDate, 23) AS QueryDate, q.FeeTypeId, f.Name AS FeeType, q.Amount, q.Remarks, u.name AS ByName
      FROM dbo.LegalStampDutyQuery q LEFT JOIN dbo.LegalLookupValue f ON f.LookupId = q.FeeTypeId LEFT JOIN dbo.users u ON u.id = q.CreatedBy
      WHERE q.LandId = @i ORDER BY q.QueryDate DESC, q.QueryId DESC`)).recordset;
    const tracking = (await pool.request().input("i", sql.Int, id).query(`
      SELECT t.TrackId, CONVERT(char(10), t.StatusDate, 23) AS StatusDate, s.Name AS IgrStatus, dl.Name AS DeedLocation, t.TrackingUrl, t.Remarks, u.name AS ByName
      FROM dbo.LegalDeedTracking t LEFT JOIN dbo.LegalLookupValue s ON s.LookupId = t.IgrStatusId LEFT JOIN dbo.LegalLookupValue dl ON dl.LookupId = t.DeedLocationId
      LEFT JOIN dbo.users u ON u.id = t.CreatedBy WHERE t.LandId = @i ORDER BY t.StatusDate DESC, t.TrackId DESC`)).recordset;
    const canApply = (await canAct(req, "L1 Approver", PAGE)) || (await canAct(req, "L2 Approver", PAGE));
    res.json({ land, queries, tracking, canApply });
  } catch (err) {
    console.error("[legal-deed-reg] detail:", err.message);
    res.status(500).json({ error: "Could not load the land" });
  }
});

const guard = async (pool, res, id, statuses = ["Deed Registration", "Registered"]) => {
  const l = await landIn(pool, id);
  if (!l) { res.status(404).json({ error: "Land not found" }); return null; }
  if (!statuses.includes(l.WorkflowStatus)) { res.status(409).json({ error: `${l.LandCode} is not at Deed Registration` }); return null; }
  return l;
};

// PUT /:id/consideration { total, rate, rateUnitId, advance, paymentModeId, remarks }
router.put("/:id/consideration", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id, ["Deed Registration"]);
    if (!l) return;
    const b = req.body || {};
    const total = money(b.total), rate = money(b.rate), advance = money(b.advance);
    if ([total, rate, advance].some(Number.isNaN)) return res.status(400).json({ error: "Amounts must be numbers" });
    if (total == null) return res.status(400).json({ error: "Enter the total amount" });
    if (advance != null && advance > total) return res.status(400).json({ error: "Advance cannot be more than the total amount" });
    const pm = idOf(b.paymentModeId), unit = idOf(b.rateUnitId);
    if (!(await lookupOk(pool, pm, "payment-mode"))) return res.status(400).json({ error: "Pick a payment mode from Setup" });
    await pool.request().input("i", sql.Int, id).input("t", sql.Decimal(18, 2), total).input("r", sql.Decimal(18, 2), rate).input("ru", sql.Int, unit)
      .input("a", sql.Decimal(18, 2), advance).input("pm", sql.Int, pm).input("rm", sql.NVarChar(1000), txt(b.remarks, 1000)).input("u", sql.Int, req.user?.userId ?? null)
      .query(`UPDATE dbo.LegalLand SET ConsTotalAmount = @t, ConsRate = @r, ConsRateUnitId = @ru, ConsAdvanceAmount = @a, ConsPaymentModeId = @pm, ConsRemarks = @rm,
          UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @i`);
    await writeAudit(pool, req, { action: "Consideration saved", entityType: "Land Property", entityId: id, landId: id, newValue: { total, rate, advance, pm } });
    res.json({ message: "Consideration saved" });
  } catch (err) {
    console.error("[legal-deed-reg] consideration:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:id/query { queryDate, feeTypeId, amount, remarks } — a registration / stamp duty query. DELETE /query/:qid.
router.post("/:id/query", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id, ["Deed Registration"]);
    if (!l) return;
    const b = req.body || {};
    const date = dateOf(b.queryDate), amount = money(b.amount), fee = idOf(b.feeTypeId);
    if (!date) return res.status(400).json({ error: "Enter the query date" });
    if (amount == null || Number.isNaN(amount)) return res.status(400).json({ error: "Enter the amount" });
    if (!(await lookupOk(pool, fee, "fee-type"))) return res.status(400).json({ error: "Pick a fee type from Setup" });
    await pool.request().input("i", sql.Int, id).input("d", sql.Date, date).input("f", sql.Int, fee).input("a", sql.Decimal(18, 2), amount)
      .input("r", sql.NVarChar(1000), txt(b.remarks, 1000)).input("u", sql.Int, req.user?.userId ?? null)
      .query("INSERT INTO dbo.LegalStampDutyQuery (LandId, QueryDate, FeeTypeId, Amount, Remarks, CreatedBy) VALUES (@i, @d, @f, @a, @r, @u)");
    await writeAudit(pool, req, { action: "Stamp duty query added", entityType: "Land Property", entityId: id, landId: id, newValue: { date, amount, fee } });
    res.status(201).json({ message: "Query saved" });
  } catch (err) {
    console.error("[legal-deed-reg] query:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});
router.delete("/query/:qid", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const r = await pool.request().input("q", sql.Int, idOf(req.params.qid))
      .query("DELETE FROM dbo.LegalStampDutyQuery OUTPUT DELETED.LandId, DELETED.Amount, CONVERT(char(10), DELETED.QueryDate, 23) AS QueryDate WHERE QueryId = @q");
    const row = r.recordset[0];
    if (!row) return res.status(404).json({ error: "Query not found" });
    await writeAudit(pool, req, { action: "Stamp duty query deleted", entityType: "Land Property", entityId: row.LandId, landId: row.LandId, oldValue: row });
    res.json({ message: "Query removed" });
  } catch (err) {
    console.error("[legal-deed-reg] query delete:", err.message);
    res.status(500).json({ error: "Could not remove" });
  }
});

// PUT /:id/final { date, officeId, modeId, deedNo } — Final Registration (before the registered deed is uploaded).
router.put("/:id/final", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id);
    if (!l) return;
    const b = req.body || {};
    const date = dateOf(b.date), office = idOf(b.officeId), mode = idOf(b.modeId);
    if (!date) return res.status(400).json({ error: "Enter the registration date" });
    if (!office) return res.status(400).json({ error: "Pick the office of registration" });
    if (!(await pool.request().input("o", sql.Int, office).query("SELECT 1 AS x FROM dbo.LegalRegistrationOffice WHERE OfficeId = @o")).recordset[0]) return res.status(400).json({ error: "Office not found" });
    if (!mode || !(await lookupOk(pool, mode, "registration-mode"))) return res.status(400).json({ error: "Pick the mode of registration" });
    await pool.request().input("i", sql.Int, id).input("d", sql.Date, date).input("o", sql.Int, office).input("m", sql.Int, mode)
      .input("n", sql.NVarChar(100), txt(b.deedNo, 100)).input("u", sql.Int, req.user?.userId ?? null)
      .query("UPDATE dbo.LegalLand SET RegFinalDate = @d, RegOfficeId = @o, RegModeId = @m, RegDeedNo = @n, UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @i");
    await writeAudit(pool, req, { action: "Final registration saved", entityType: "Land Property", entityId: id, landId: id, newValue: { date, office, mode, deedNo: txt(b.deedNo, 100) } });
    res.json({ message: "Final registration saved" });
  } catch (err) {
    console.error("[legal-deed-reg] final:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

// POST /:id/tracking { statusDate, igrStatusId, deedLocationId, trackingUrl, remarks } — a physical deed / IGR update.
router.post("/:id/tracking", requirePageRight(PAGE, "edit"), async (req, res) => {
  try {
    const pool = getPool();
    if (!(await ready(pool))) return notReady(res);
    const id = idOf(req.params.id);
    const l = await guard(pool, res, id);
    if (!l) return;
    const b = req.body || {};
    const date = dateOf(b.statusDate) || new Date().toISOString().slice(0, 10);
    const st = idOf(b.igrStatusId), loc = idOf(b.deedLocationId);
    const link = b.trackingUrl ? urlOf(b.trackingUrl) : null;
    if (b.trackingUrl && !link) return res.status(400).json({ error: "The IGR tracking link must start with http:// or https://" });
    if (!st && !loc && !link) return res.status(400).json({ error: "Enter the IGR status, deed location or tracking link" });
    if (!(await lookupOk(pool, st, "igr-status")) || !(await lookupOk(pool, loc, "deed-location"))) return res.status(400).json({ error: "Pick the status and location from Setup" });
    const u = req.user?.userId ?? null;
    await pool.request().input("i", sql.Int, id).input("d", sql.Date, date).input("s", sql.Int, st).input("l", sql.Int, loc).input("url", sql.NVarChar(500), link)
      .input("r", sql.NVarChar(1000), txt(b.remarks, 1000)).input("u", sql.Int, u)
      .query(`SET XACT_ABORT ON; BEGIN TRAN;
        INSERT INTO dbo.LegalDeedTracking (LandId, StatusDate, IgrStatusId, DeedLocationId, TrackingUrl, Remarks, CreatedBy) VALUES (@i, @d, @s, @l, @url, @r, @u);
        UPDATE dbo.LegalLand SET IgrStatusId = ISNULL(@s, IgrStatusId), DeedLocationId = ISNULL(@l, DeedLocationId), IgrTrackingUrl = ISNULL(@url, IgrTrackingUrl),
          UpdatedBy = @u, UpdatedAt = SYSUTCDATETIME() WHERE LandId = @i;
        COMMIT;`);
    await writeAudit(pool, req, { action: "Deed tracking updated", entityType: "Land Property", entityId: id, landId: id, newValue: { date, st, loc, link } });
    res.status(201).json({ message: "Deed tracking updated" });
  } catch (err) {
    console.error("[legal-deed-reg] tracking:", err.message);
    res.status(500).json({ error: "Could not save" });
  }
});

module.exports = router;
