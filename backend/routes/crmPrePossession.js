const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");

router.use(authMiddleware);

const PP_SELECT = `
  SELECT p.*, b.BookingNo, b.UnitNo, a.ApplicantName, a.Mobile
  FROM dbo.CrmPrePossession p
  JOIN dbo.CrmBooking b ON b.Id = p.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
`;

router.get("/", requirePageRight("crm-pre-possession", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`${PP_SELECT} ORDER BY p.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-pre-possession] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requirePageRight("crm-pre-possession", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const result = await pool.request()
      .input("bid", sql.Int, parseInt(b.BookingId))
      .input("sdt", sql.Date, b.ScheduledInspectionDate || null)
      .input("cb",  sql.Int, actorId(req))
      .query(`
        INSERT INTO dbo.CrmPrePossession (BookingId, ScheduledInspectionDate, Status, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @sdt, 'Pending', @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Pre-possession check already exists for this booking" });
    console.error("[crm-pre-possession] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.put("/:id", requirePageRight("crm-pre-possession", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);
    await pool.request()
      .input("id",   sql.Int, id)
      .input("dues", sql.Bit, b.DuesClearedCheck ? 1 : (b.DuesClearedCheck === false ? 0 : null))
      .input("doc",  sql.Bit, b.DocumentationCheck ? 1 : (b.DocumentationCheck === false ? 0 : null))
      .input("qc",   sql.Bit, b.QualityInspectionCheck ? 1 : (b.QualityInspectionCheck === false ? 0 : null))
      .input("util", sql.Bit, b.UtilityReadinessCheck ? 1 : (b.UtilityReadinessCheck === false ? 0 : null))
      .input("icd",  sql.Date, b.InspectionCompletedDate || null)
      .input("st",   sql.NVarChar(30), b.Status || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",   sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmPrePossession SET
          DuesClearedCheck = ISNULL(@dues, DuesClearedCheck),
          DocumentationCheck = ISNULL(@doc, DocumentationCheck),
          QualityInspectionCheck = ISNULL(@qc, QualityInspectionCheck),
          UtilityReadinessCheck = ISNULL(@util, UtilityReadinessCheck),
          InspectionCompletedDate = ISNULL(@icd, InspectionCompletedDate),
          Status = ISNULL(@st, CASE
            WHEN ISNULL(@dues, DuesClearedCheck) = 1 AND ISNULL(@doc, DocumentationCheck) = 1
             AND ISNULL(@qc, QualityInspectionCheck) = 1 AND ISNULL(@util, UtilityReadinessCheck) = 1
            THEN 'Ready' ELSE Status END),
          Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-pre-possession] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
