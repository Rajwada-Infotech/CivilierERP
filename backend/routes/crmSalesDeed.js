const express = require("express");
const router = express.Router();
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId } = require("../services/saAccess");
const { getNextDocNumber } = require("../services/docNumber");
const { logCommunication } = require("../services/crmCommunicationLog");

router.use(authMiddleware);

const DEED_SELECT = `
  SELECT d.*, b.BookingNo, b.UnitNo, b.TotalValue AS BookingValue, b.Status AS BookingStatus, a.ApplicantName, a.Mobile
  FROM dbo.CrmSalesDeed d
  JOIN dbo.CrmBooking b ON b.Id = d.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
`;

// Status is never a free pick — it is derived, level by level, from the
// actual data on record: RegistrationNo present -> Registered; else
// ExecutedBy present -> Executed; else the deed date having already passed
// -> Overdue; else Draft. A cancelled booking always wins (Cancelled).
function deriveDeedStatus({ bookingStatus, registrationNo, executedBy, deedDate }) {
  if (bookingStatus === "Cancelled") return "Cancelled";
  if (registrationNo) return "Registered";
  if (executedBy) return "Executed";
  if (deedDate && new Date(deedDate) < new Date(new Date().toDateString())) return "Overdue";
  return "Draft";
}

router.get("/", requirePageRight("crm-sales-deed", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const result = await pool.request().query(`${DEED_SELECT} ORDER BY d.CreatedAt DESC`);
    const rows = result.recordset.map((r) => ({
      ...r,
      Status: deriveDeedStatus({
        bookingStatus: r.BookingStatus, registrationNo: r.RegistrationNo,
        executedBy: r.ExecutedBy, deedDate: r.DeedDate,
      }),
    }));
    res.json(status ? rows.filter((r) => r.Status === status) : rows);
  } catch (e) {
    console.error("[crm-sales-deed] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post("/", requirePageRight("crm-sales-deed", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    const bookingId = parseInt(b.BookingId, 10);

    const agreement = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT TOP 1 Id, Status
      FROM dbo.CrmAgreement
      WHERE BookingId = @bid
      ORDER BY CreatedAt DESC
    `);
    if (!agreement.recordset.length || agreement.recordset[0].Status !== "Executed") {
      return res.status(400).json({ error: "Agreement must be executed before a sales deed can be prepared" });
    }

    const pendingMilestones = await pool.request().input("bid", sql.Int, bookingId).query(`
      SELECT COUNT(*) AS PendingCount
      FROM dbo.CrmPaymentMilestone
      WHERE BookingId = @bid AND Status NOT IN ('Paid', 'Waived')
    `);
    if (pendingMilestones.recordset[0]?.PendingCount > 0) {
      return res.status(400).json({ error: "All payment milestones must be paid or waived before sales deed preparation" });
    }

    const deedNo = await getNextDocNumber(pool, "DEED", "DEED");

    const result = await pool.request()
      .input("no",   sql.NVarChar(30),  deedNo)
      .input("bid",  sql.Int,           bookingId)
      .input("agid", sql.Int,           b.AgreementId ? parseInt(b.AgreementId) : agreement.recordset[0].Id)
      .input("val",  sql.Decimal(18,2), b.DeedValue != null ? parseFloat(b.DeedValue) : null)
      .input("stamp",sql.Decimal(18,2), b.StampDuty != null ? parseFloat(b.StampDuty) : null)
      .input("regfee",sql.Decimal(18,2), b.RegistrationFee != null ? parseFloat(b.RegistrationFee) : null)
      .input("sro",  sql.NVarChar(255), b.SubRegistrarOffice || null)
      .input("dt",   sql.Date,          b.DeedDate || null)
      .input("exby", sql.NVarChar(200), b.ExecutedBy || null)
      .input("wit",  sql.NVarChar(500), b.WitnessNames || null)
      .input("note", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",   sql.Int,           actorId(req))
      .input("st",   sql.NVarChar(30),  deriveDeedStatus({ bookingStatus: null, registrationNo: null, executedBy: b.ExecutedBy || null, deedDate: b.DeedDate || null }))
      .query(`
        INSERT INTO dbo.CrmSalesDeed
          (DeedNo, BookingId, AgreementId, DeedValue, StampDuty, RegistrationFee, SubRegistrarOffice, DeedDate, ExecutedBy, WitnessNames, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@no, @bid, @agid, @val, @stamp, @regfee, @sro, @dt, @exby, @wit, @st, @note, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id, DeedNo: deedNo });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "A sale deed already exists for this booking" });
    console.error("[crm-sales-deed] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/send-to-customer - publish the sales deed to the portal for the
// customer's approval. Registration still depends on the legal registration
// fields; this only records the customer-facing approval checkpoint.
router.put("/:id/send-to-customer", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    const deed = await pool.request().input("id", sql.Int, id).query(`
      SELECT d.Id, d.Status, ag.Status AS AgreementStatus
      FROM dbo.CrmSalesDeed d
      LEFT JOIN dbo.CrmAgreement ag ON ag.Id = d.AgreementId
      WHERE d.Id = @id
    `);
    if (!deed.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    if (deed.recordset[0].AgreementStatus !== "Executed") {
      return res.status(400).json({ error: "Agreement must be executed before sending the sales deed to the customer" });
    }
    if (deed.recordset[0].Status === "Registered") {
      return res.status(400).json({ error: "Registered sales deed cannot be resent for customer approval" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmSalesDeed SET
          SentToCustomerAt = SYSDATETIME(),
          CustomerApprovalStatus = 'Pending',
          CustomerApprovedAt = NULL,
          CustomerRecheckRemarks = NULL,
          UpdatedBy = @ub,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    res.json({ success: true });
  } catch (e) {
    console.error("[crm-sales-deed] send-to-customer error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Status is never accepted from the request body — it is recomputed from
// the resulting data (RegistrationNo, ExecutedBy, DeedDate, booking Status)
// after every update via deriveDeedStatus().
router.put("/:id", requirePageRight("crm-sales-deed", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    const id = parseInt(req.params.id);

    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT d.RegistrationNo, d.ExecutedBy, d.DeedDate, d.BookingId, d.DeedNo, b.Status AS BookingStatus
      FROM dbo.CrmSalesDeed d JOIN dbo.CrmBooking b ON b.Id = d.BookingId
      WHERE d.Id = @id
    `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Sale deed not found" });
    const row = cur.recordset[0];

    const newStatus = deriveDeedStatus({
      bookingStatus: row.BookingStatus,
      registrationNo: b.RegistrationNo || row.RegistrationNo,
      executedBy: b.ExecutedBy || row.ExecutedBy,
      deedDate: b.DeedDate || row.DeedDate,
    });

    await pool.request()
      .input("id",    sql.Int,  id)
      .input("regno", sql.NVarChar(100), b.RegistrationNo || null)
      .input("bookno",sql.NVarChar(100), b.BookNo || null)
      .input("partno",sql.NVarChar(100), b.PartNo || null)
      .input("regdt", sql.Date, b.RegistrationDate || null)
      .input("posdt", sql.Date, b.PossessionDate || null)
      .input("exby",  sql.NVarChar(200), b.ExecutedBy || null)
      .input("st",    sql.NVarChar(30), newStatus)
      .input("note",  sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub",    sql.Int,  actorId(req))
      .query(`
        UPDATE dbo.CrmSalesDeed SET
          RegistrationNo = ISNULL(@regno, RegistrationNo), BookNo = ISNULL(@bookno, BookNo),
          PartNo = ISNULL(@partno, PartNo), RegistrationDate = ISNULL(@regdt, RegistrationDate),
          PossessionDate = ISNULL(@posdt, PossessionDate), ExecutedBy = ISNULL(@exby, ExecutedBy),
          Status = @st, Notes = @note, UpdatedBy = @ub, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    // Auto-flow: "LAST MILESTONE -> SALES DEED -> CUSTOMER APPROVAL" — the
    // moment the deed becomes legally Executed (ExecutedBy just filled in),
    // it's ready to show the customer. No separate manual "send" click
    // needed, same as the agreement's auto-send on senior approval.
    if (newStatus === "Executed") {
      const sent = await pool.request().input("id", sql.Int, id).query("SELECT SentToCustomerAt FROM dbo.CrmSalesDeed WHERE Id = @id");
      if (!sent.recordset[0].SentToCustomerAt) {
        await pool.request().input("id", sql.Int, id).query(`
          UPDATE dbo.CrmSalesDeed SET SentToCustomerAt = SYSDATETIME(), CustomerApprovalStatus = 'Pending', CustomerApprovedAt = NULL
          WHERE Id = @id
        `);
        await logCommunication(pool, {
          bookingId: row.BookingId, direction: "Outbound",
          subject: `Sales deed ${row.DeedNo} sent to customer`,
          summary: "Sales deed executed and shared with the customer via portal, awaiting their approval.",
          createdBy: actorId(req),
        });
      }
    }

    res.json({ success: true, status: newStatus });
  } catch (e) {
    console.error("[crm-sales-deed] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
