const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { actorId, requireUserEmail } = require("../services/saAccess");
// Approve/reject is gated to admin/super_admin/dba via this shared engine —
// same mechanism BOQ/Purchase Orders/etc. use — instead of any editor being
// able to self-approve brokerage on this page.
const { transition: approvalTransition } = require("../services/approvalService");
const { requireActiveBooking } = require("../services/crmWorkflowGuards");
const { assertSanePercentRate } = require("../services/brokerageValidation");
const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
const { bumpCacheVersion } = require("../redis");

router.use(authMiddleware);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));

const BROKERAGE_SELECT = `
  SELECT br.*, b.BookingNo, b.UnitNo, b.TotalValue, a.ApplicantName,
         ahm.LHeadName AS BrokerMasterName, ahm.LHeadPhone AS BrokerMasterPhone,
         m.MilestoneName,
         ISNULL((SELECT SUM(Amount) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id), 0) AS TotalPaid,
         ISNULL((SELECT SUM(PAmount) FROM dbo.NewPayment WHERE SourceCrmBrokerageId = br.Id AND Status IN ('Draft','Pending','Approved')), 0) AS TotalSubmitted,
         fp.PPaymentID AS FinancePaymentId,
         fp.DocNo AS FinancePaymentDocNo,
         fp.Status AS FinancePaymentStatus
  FROM dbo.CrmBrokerageMaster br
  JOIN dbo.CrmBooking b ON b.Id = br.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = br.BrokerId
  LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = br.MilestoneId
  OUTER APPLY (
    SELECT TOP 1 np.PPaymentID, np.DocNo, np.Status
    FROM dbo.NewPayment np
    WHERE np.SourceCrmBrokerageId = br.Id AND np.Status NOT IN ('Rejected','Deleted')
    ORDER BY np.PPaymentID DESC
  ) fp
`;

// GET / — all brokerage records. Staff/internal only — never exposed to crm-portal.
router.get("/", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); conds.push("br.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`${BROKERAGE_SELECT} ${where} ORDER BY br.CreatedAt DESC`);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-brokerage] GET error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /payments — every broker payment across all brokerage records, for the
// dedicated Broker Payment page (distinct from Broker Master and Brokerage).
router.get("/payments", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    const req0 = pool.request();
    const conds = [];
    if (status) { req0.input("st", sql.NVarChar(20), status); conds.push("br.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const result = await req0.query(`
      SELECT p.Id, p.BrokerageId, p.Amount, p.PaidDate, p.PaymentMode, p.TransactionRef, p.Notes, p.CreatedAt,
             CAST(NULL AS INT) AS FinancePaymentId, CAST(NULL AS NVARCHAR(100)) AS FinancePaymentDocNo, 'Paid' AS FinancePaymentStatus,
             br.RateType, br.RateValue, br.ComputedAmount, br.Status AS BrokerageStatus,
             br.BrokerName, br.BrokerFirm, b.BookingNo, b.UnitNo, a.ApplicantName,
             cu.name AS CreatedByName
      FROM dbo.CrmBrokerPayment p
      JOIN dbo.CrmBrokerageMaster br ON br.Id = p.BrokerageId
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.Users cu ON cu.id = p.CreatedBy
      ${where}
      UNION ALL
      SELECT np.PPaymentID AS Id, br.Id AS BrokerageId, np.PAmount AS Amount, np.PDate AS PaidDate, np.PMode AS PaymentMode,
             COALESCE(np.PNeftNumber, np.PUpiTransactionId, np.PRtgsReference, np.PImpsReference, np.PCardReference, np.PChequeNo, np.DocNo) AS TransactionRef,
             np.PRemarks AS Notes, np.PCreatedAt AS CreatedAt,
             np.PPaymentID AS FinancePaymentId, np.DocNo AS FinancePaymentDocNo, np.Status AS FinancePaymentStatus,
             br.RateType, br.RateValue, br.ComputedAmount, br.Status AS BrokerageStatus,
             br.BrokerName, br.BrokerFirm, b.BookingNo, b.UnitNo, a.ApplicantName,
             np.PCreatedBy AS CreatedByName
      FROM dbo.NewPayment np
      JOIN dbo.CrmBrokerageMaster br ON br.Id = np.SourceCrmBrokerageId
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      WHERE np.Status IN ('Draft','Pending','Approved') ${status ? "AND br.Status = @st" : ""}
      ORDER BY PaidDate DESC, CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (e) {
    console.error("[crm-brokerage] GET /payments error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

async function resolveFinYearId(pool, pDate) {
  if (!pDate) return null;
  const result = await pool.request().input("PDate", sql.Date, pDate).query(`
    SELECT TOP 1 FId FROM dbo.FinYear
    WHERE @PDate >= FStartDate AND @PDate <= FEndDate
    ORDER BY FStartDate DESC
  `);
  return result.recordset[0]?.FId ?? null;
}

function computeBrokerageAmount(rateType, rateValue, baseAmount) {
  const rate = Number(rateValue) || 0;
  const base = Number(baseAmount) || 0;
  if (rateType === "Amount") return Math.round(rate * 100) / 100;
  return Math.round(base * rate) / 100;
}

async function createFinancePaymentForBrokerage(pool, brokerageId, req) {
  const existing = await pool.request().input("id", sql.Int, brokerageId).query(`
    SELECT TOP 1 PPaymentID, DocNo, Status
    FROM dbo.NewPayment
    WHERE SourceCrmBrokerageId = @id AND Status NOT IN ('Rejected','Deleted')
    ORDER BY PPaymentID DESC
  `);
  if (existing.recordset.length) return { existing: true, ...existing.recordset[0] };

  const br = await pool.request().input("id", sql.Int, brokerageId).query(`
    SELECT br.Id, br.Status, br.ComputedAmount, br.BrokerId, br.BrokerName,
           br.TrancheLabel, b.BookingNo, b.CompanyId, b.ProjectId
    FROM dbo.CrmBrokerageMaster br
    JOIN dbo.CrmBooking b ON b.Id = br.BookingId
    WHERE br.Id = @id
  `);
  const row = br.recordset[0];
  if (!row) throw new Error("Brokerage record not found");
  if (row.Status !== "Approved") throw new Error(`Brokerage must be Approved before finance handoff (currently ${row.Status})`);
  if (!row.BrokerId) throw new Error("Brokerage has no broker ledger head");

  const amount = Number(row.ComputedAmount) || 0;
  if (amount <= 0) throw new Error("Approved brokerage amount must be greater than 0");

  const actorEmail = req.user?.email || req.user?.name || null;
  const docTypeId = await resolveDocTypeId(pool, sql, "PAY");
  const finalDocNo = await lockNextDocNumber(pool, sql, {
    docTypeId,
    tableName: "NewPayment",
    docNoColumn: "DocNo",
    issuedBy: actorEmail || String(actorId(req)),
  });
  const parts = finalDocNo.split("-");
  const docYear = parseInt(parts[parts.length - 2], 10) || null;
  const docSerial = parseInt(parts[parts.length - 1], 10) || null;
  const today = new Date().toISOString().slice(0, 10);
  const pFinYearId = await resolveFinYearId(pool, today);
  // TrancheLabel is the real distinguishing field under the current
  // OneTime/TwoPart/AgreementOnly design ('Full', 'Booking', 'Agreement') —
  // this used to key off MilestoneNo, which is never set anymore (tranches
  // aren't tied to a specific milestone), so every handoff's remark always
  // read "full brokerage" even for a TwoPart plan's half-share tranche,
  // giving Finance no way to tell a partial payment apart from the whole.
  const milestoneText = row.TrancheLabel ? `${row.TrancheLabel} tranche` : "full brokerage";

  const result = await pool.request()
    .input("name", sql.VarChar, "Brokerage Payment")
    .input("remarks", sql.NVarChar(1000), `Approved brokerage for ${row.BookingNo} (${milestoneText}) - finance to complete payment details`)
    .input("amt", sql.Decimal(18,2), amount)
    .input("dt", sql.Date, today)
    .input("project", sql.VarChar, row.ProjectId != null ? String(row.ProjectId) : "")
    .input("company", sql.VarChar, row.CompanyId != null ? String(row.CompanyId) : "")
    .input("partyId", sql.Int, row.BrokerId)
    .input("docNo", sql.NVarChar(100), finalDocNo)
    .input("docTypeId", sql.Int, docTypeId)
    .input("docYear", sql.SmallInt, docYear)
    .input("docSerial", sql.Int, docSerial)
    .input("finYearId", sql.Int, pFinYearId)
    .input("sourceBrokerageId", sql.Int, brokerageId)
    .input("createdBy", sql.NVarChar(100), actorEmail || String(actorId(req)))
    .query(`
      INSERT INTO dbo.NewPayment (
        PPaymentName, PRemarks, PMode, PBankName, PAmount, PDocType, PDate,
        PProject, PCompany, PPartyId,
        DocNo, DocTypeId, DocYear, DocSerial, PFinYearId,
        SourceCrmBrokerageId,
        PCreatedAt, PCreatedBy, PApprovedBy, Status
      )
      OUTPUT INSERTED.PPaymentID
      VALUES (
        @name, @remarks, '', '', @amt, 'Brokerage', @dt,
        @project, @company, @partyId,
        @docNo, @docTypeId, @docYear, @docSerial, @finYearId,
        @sourceBrokerageId,
        SYSDATETIME(), @createdBy, NULL, 'Pending'
      )
    `);

  const newPaymentId = result.recordset[0].PPaymentID;
  await backPatchRecordId(pool, sql, finalDocNo, "NewPayment", newPaymentId);
  return { existing: false, PPaymentID: newPaymentId, DocNo: finalDocNo, Status: "Pending" };
}

router.get("/:id", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const [brRes, payRes] = await Promise.all([
      pool.request().input("id", sql.Int, id).query(`${BROKERAGE_SELECT} WHERE br.Id = @id`),
      pool.request().input("id", sql.Int, id).query("SELECT * FROM dbo.CrmBrokerPayment WHERE BrokerageId = @id ORDER BY PaidDate DESC"),
    ]);
    if (!brRes.recordset[0]) return res.status(404).json({ error: "Brokerage record not found" });
    res.json({ brokerage: brRes.recordset[0], payments: payRes.recordset });
  } catch (e) {
    console.error("[crm-brokerage] GET /:id error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST / — record broker involvement for a booking. Broker must be picked
// from the Broker Master (an AccountHeadMaster row, LHeadType='BR') — the
// same pattern Contractors use — not free-typed.
//
// Workflow guard: the spec's own ordering is explicit — "...DATE OF
// AGREEMENT -> MILESTONE => BROKERAGE MASTER..." — brokerage is recorded
// once the deal is actually confirmed (agreement executed), not while it's
// still being negotiated.
router.post("/", requirePageRight("crm-brokerage", "create"), async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.BookingId) return res.status(400).json({ error: "BookingId is required" });
    if (!b.BrokerId) return res.status(400).json({ error: "Broker is required — select one from Broker Master" });

    const activeErr = await requireActiveBooking(pool, parseInt(b.BookingId));
    if (activeErr) return res.status(400).json({ error: activeErr });

    // Guard against double brokerage: maybeAutoCreateBrokerage() (see
    // crmWorkflowGuards.js) already seeds one CrmBrokerageMaster row per
    // payment milestone the moment Milestone #1 is paid, for any booking
    // that had a broker picked at Application/Booking stage. The old
    // UNIQUE index only blocked a second *full-payout* row (MilestoneId IS
    // NULL) — it never blocked adding a full-payout row on top of
    // already-existing milestone-tranche rows, which would pay the same
    // broker twice for the same deal. Block on ANY existing row for this
    // booking, not just a matching MilestoneId, since this endpoint only
    // ever creates the full-payout kind.
    const existingForBooking = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT TOP 1 Id FROM dbo.CrmBrokerageMaster WHERE BookingId = @bid");
    if (existingForBooking.recordset.length) {
      return res.status(409).json({ error: "Brokerage already recorded for this booking (auto-created milestone schedule or a prior entry already exists)." });
    }

    const agr = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT Status FROM dbo.CrmAgreement WHERE BookingId = @bid");
    if (!agr.recordset.length || !["Executed", "Registered"].includes(agr.recordset[0].Status)) {
      return res.status(400).json({ error: "Brokerage requires the agreement to be Executed first" });
    }

    const broker = await pool.request().input("bid", sql.Int, parseInt(b.BrokerId))
      .query("SELECT LHeadId, LHeadName, LHeadPhone FROM dbo.AccountHeadMaster WHERE LHeadId = @bid AND LHeadType = 'BR' AND LHeadStatus = 1");
    if (!broker.recordset.length) return res.status(400).json({ error: "Selected broker does not exist or is inactive" });

    const rateType = b.RateType === "Amount" ? "Amount" : "Percentage";
    const rateValue = parseFloat(b.RateValue);
    if (!rateValue || rateValue <= 0) return res.status(400).json({ error: "RateValue must be greater than 0" });
    try {
      assertSanePercentRate(rateType, rateValue);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Same deal-value base the auto-engine uses (maybeAutoCreateBrokerage in
    // crmWorkflowGuards.js) — unit price + parking + extras, GST excluded.
    const bk = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT TotalValue, ParkingTotal FROM dbo.CrmBooking WHERE Id = @bid");
    const dealValue = Number(bk.recordset[0]?.TotalValue || 0) + Number(bk.recordset[0]?.ParkingTotal || 0);
    const computedAmount = rateType === "Percentage" ? Math.round(dealValue * rateValue) / 100 : rateValue;

    const result = await pool.request()
      .input("bid",   sql.Int,           parseInt(b.BookingId))
      .input("brid",  sql.Int,           broker.recordset[0].LHeadId)
      .input("name",  sql.NVarChar(200), broker.recordset[0].LHeadName)
      .input("firm",  sql.NVarChar(200), b.BrokerFirm || null)
      .input("con",   sql.NVarChar(20),  broker.recordset[0].LHeadPhone || null)
      .input("rt",    sql.NVarChar(20),  rateType)
      .input("rv",    sql.Decimal(18,2),rateValue)
      .input("camt",  sql.Decimal(18,2),computedAmount)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmBrokerageMaster
          (BookingId, BrokerId, BrokerName, BrokerFirm, BrokerContact, RateType, RateValue, ComputedAmount, Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @brid, @name, @firm, @con, @rt, @rv, @camt, 'Pending', @notes, @cb, SYSDATETIME())
      `);
    res.status(201).json({ success: true, id: result.recordset[0].Id });
  } catch (e) {
    if (e.message?.includes("UNIQUE") || e.message?.includes("unique"))
      return res.status(409).json({ error: "Brokerage already recorded for this booking" });
    console.error("[crm-brokerage] POST error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id — edit brokerage terms/notes only. Status is never settable here —
// Approved goes through /:id/approve, Paid is derived automatically from
// payments, so this endpoint can't be used to skip either gate.
router.put("/:id", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id);
    const b = req.body;
    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT br.Status, br.RateType, br.RateValue,
             b.TotalValue, b.ParkingTotal
      FROM dbo.CrmBrokerageMaster br
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      WHERE br.Id = @id
    `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Brokerage record not found" });
    const row = cur.recordset[0];
    if (row.Status === "Approved" || row.Status === "Paid") {
      return res.status(400).json({ error: "Brokerage can only be customized before approval" });
    }

    const rateType = b.RateType === "Amount" ? "Amount" : (b.RateType === "Percentage" ? "Percentage" : row.RateType);
    const rateValue = b.RateValue != null && b.RateValue !== "" ? Number(b.RateValue) : Number(row.RateValue);
    if (!Number.isFinite(rateValue) || rateValue <= 0) return res.status(400).json({ error: "RateValue must be greater than 0" });
    try {
      assertSanePercentRate(rateType, rateValue);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    // Same base the auto-engine uses (maybeAutoCreateBrokerage in
    // crmWorkflowGuards.js) — unit price + parking + extras, GST excluded
    // since it's a statutory pass-through, not deal revenue. This used to
    // read row.MilestoneId ? row.AmountDue : row.TotalValue, but
    // MilestoneId is never populated under the current tranche-plan design
    // (see buildBrokerageTranches), so that branch always fell through to
    // TotalValue alone — silently under-basing a customized amount on any
    // booking with parking or extra charges.
    const baseAmount = Number(row.TotalValue || 0) + Number(row.ParkingTotal || 0);
    const computedAmount = b.ComputedAmount != null && b.ComputedAmount !== ""
      ? Math.round(Number(b.ComputedAmount) * 100) / 100
      : computeBrokerageAmount(rateType, rateValue, baseAmount);
    if (!Number.isFinite(computedAmount) || computedAmount <= 0) {
      return res.status(400).json({ error: "ComputedAmount must be greater than 0" });
    }

    await pool.request()
      .input("id", sql.Int, id)
      .input("firm", sql.NVarChar(200), b.BrokerFirm || null)
      .input("rt", sql.NVarChar(20), rateType)
      .input("rv", sql.Decimal(18,2), rateValue)
      .input("camt", sql.Decimal(18,2), computedAmount)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmBrokerageMaster SET
          BrokerFirm = @firm,
          RateType = @rt,
          RateValue = @rv,
          ComputedAmount = @camt,
          Notes = @notes,
          UpdatedBy = @ub,
          UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);
    res.json({ success: true });
  } catch (e) {
    console.error("[crm-brokerage] PUT error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /:id/approve — admin/super_admin/dba only, enforced inside
// approvalTransition(). Only reachable from the Admin Approval Inbox —
// approve/reject no longer live on this page at all. A brokerage record
// must be Approved here before any payment can be recorded against it.
router.put("/:id/submit", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-brokerage", id, "Pending", userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-brokerage] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put("/:id/approve", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;

    // An Agreement-gated tranche (TwoPart's second half / AgreementOnly)
    // stays locked until the Agreement is Executed (see
    // maybeUnlockBrokerageOnAgreementExecuted) — can't be approved (or, by
    // extension, paid) before then. A Booking-gated tranche is never
    // created locked, so this branch only ever fires for UnlockGate='Agreement'.
    const pool = getPool();
    const locked = await pool.request().input("id", sql.Int, id)
      .query("SELECT IsLocked, UnlockGate FROM dbo.CrmBrokerageMaster WHERE Id = @id");
    if (locked.recordset[0]?.IsLocked) {
      const msg = "This tranche unlocks once the Agreement is Executed";
      return res.status(400).json({ error: msg });
    }

    const result = await approvalTransition("crm-brokerage", id, "Approved", userEmail, req.user?.role);
    // approvalTransition() manages its own internal transaction and commits
    // before returning, so by this point the Approved status is already
    // permanent — it can't be rolled back if the Finance handoff below
    // fails. That failure mode is real (caught one live: a schema mismatch
    // left an Approved record with no NewPayment and no way back to Pending
    // to retry /approve). Report it as a distinct, recoverable condition —
    // not a generic 400 that reads as "the approval failed" when it didn't —
    // and let PUT /:id/retry-finance-handoff pick up exactly this case.
    let financePayment = null;
    if (result.newStatus === "Approved") {
      try {
        financePayment = await createFinancePaymentForBrokerage(pool, id, req);
        await Promise.all([bumpCacheVersion("crm-brokerage"), bumpCacheVersion("new-payment")]);
      } catch (handoffErr) {
        console.error("[crm-brokerage] approve succeeded but Finance handoff failed:", handoffErr.message);
        return res.status(207).json({
          success: true, status: result.newStatus, financePayment: null,
          financeHandoffError: `Approved, but sending to Finance failed: ${handoffErr.message}. Retry via PUT /:id/retry-finance-handoff.`,
        });
      }
    }
    res.json({ success: true, status: result.newStatus, financePayment });
  } catch (e) {
    console.error("[crm-brokerage] approve error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// PUT /:id/retry-finance-handoff — recovery path for an Approved brokerage
// record that has no NewPayment yet (the Finance handoff step of /approve
// failed after the status change had already committed). No-op / returns
// the existing payment if one already exists (createFinancePaymentForBrokerage
// is idempotent) — safe to call speculatively.
router.put("/:id/retry-finance-handoff", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const pool = getPool();
    const financePayment = await createFinancePaymentForBrokerage(pool, id, req);
    await Promise.all([bumpCacheVersion("crm-brokerage"), bumpCacheVersion("new-payment")]);
    res.json({ success: true, financePayment });
  } catch (e) {
    console.error("[crm-brokerage] retry-finance-handoff error:", e.message);
    res.status(400).json({ error: e.message });
  }
});

// PUT /:id/reject — admin/super_admin/dba only.
router.put("/:id/reject", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-brokerage", id, "Rejected", userEmail, req.user?.role, req.body?.note || null);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-brokerage] reject error:", e.message);
    res.status(e.status || (e.message.includes("not authorized") ? 403 : 400)).json({ error: e.message });
  }
});

// NOTE: a POST /:id/payments endpoint used to live here, letting CRM staff
// directly record a broker payout (with its own bank/mode/date and its own
// dbo.NewPayment insert). It's removed as of this fix, for two reasons:
//
// 1. It was unreachable from the UI as shipped — CrmBrokerPayments.tsx's
//    "Record Payment" form never collected a bank, and this endpoint 400'd
//    without one. Every submit failed.
// 2. Even fixed, it was a parallel path to the finance hand-off that
//    already exists: PUT /:id/approve above calls
//    createFinancePaymentForBrokerage(), which creates the dbo.NewPayment
//    row Finance works from. A second, CRM-originated NewPayment for the
//    same brokerage record (with CRM staff picking the bank directly)
//    duplicates that row and lets CRM bypass Finance's own data entry and
//    approval — the opposite of "Finance owns payment execution, CRM only
//    tracks it." The only supported path to pay a broker now is:
//      CRM: Admin approves brokerage amount (this file, /:id/approve)
//        -> Finance: NewPayment appears Pending, Finance fills in
//           bank/mode/date (newPayment.js PUT /:id) and approves it
//           (newPayment.js PUT /:id/approve)
//        -> CRM: write-back on that approval marks CrmBrokerPayment /
//           CrmBrokerageMaster.Status = 'Paid' automatically.
//    GET /payments (above) still reports on both dbo.CrmBrokerPayment and
//    the live dbo.NewPayment queue, so CRM's Broker Payment page keeps
//    showing accurate status — it just no longer writes.

module.exports = router;