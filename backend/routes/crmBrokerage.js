const express = require("express");
const { parseId } = require("../middleware/validateRequest");
const { CrmStatus } = require("../constants/crmStatuses");
const router = express.Router();
// Project access: a restricted user gets 403 on records outside their projects.
const { crmProjectGuards, crmViaBookingSql, projectPredicate } = require("../services/projectScope");
crmProjectGuards(router, crmViaBookingSql("CrmBrokerageMaster"));
const { assertBookingProjectScope } = require("../services/assertBookingProjectScope");
const apiRateLimit = require("../middleware/apiRateLimit");
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
router.use(apiRateLimit);

const { calculateTds } = require("../services/tds");

const BROKERAGE_SELECT = `
  SELECT br.*, b.BookingNo, COALESCE(bn.UnitNo, b.UnitNo) AS UnitNo, b.TotalValue, a.ApplicantName,
         ahm.LHeadName AS BrokerMasterName, ahm.LHeadPhone AS BrokerMasterPhone,
         m.MilestoneName,
         ISNULL((SELECT SUM(Amount) FROM dbo.CrmBrokerPayment WHERE BrokerageId = br.Id), 0) AS TotalPaid,
         ISNULL((SELECT SUM(PAmount) FROM dbo.NewPayment WHERE SourceCrmBrokerageId = br.Id AND Status IN ('${CrmStatus.DRAFT}','${CrmStatus.PENDING}','${CrmStatus.APPROVED}')), 0) AS TotalSubmitted,
         fp.PPaymentID AS FinancePaymentId,
         fp.DocNo AS FinancePaymentDocNo,
         fp.Status AS FinancePaymentStatus
  FROM dbo.CrmBrokerageMaster br
  JOIN dbo.CrmBooking b ON b.Id = br.BookingId
  JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
  LEFT JOIN dbo.vw_CrmBookingDisplay bn ON bn.BookingId = b.Id
  LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = br.BrokerId
  LEFT JOIN dbo.CrmPaymentMilestone m ON m.Id = br.MilestoneId
  OUTER APPLY (
    SELECT TOP 1 np.PPaymentID, np.DocNo, np.Status
    FROM dbo.NewPayment np
    WHERE np.SourceCrmBrokerageId = br.Id AND np.Status NOT IN ('${CrmStatus.REJECTED}','Deleted')
    ORDER BY np.PPaymentID DESC
  ) fp
`;

// ── List: server-side paging / search / sort / status counts ─────────────────
// Same contract as CrmHandover / CrmServiceTickets / CrmBookingAmendments:
//   GET /?page=1&pageSize=25&search=&status=&sortKey=&sortDir=&companyId=&projectId=&blockId=
//   → { rows, total, counts: { All, Pending, Approved, Paid } }
// `counts` honours search + company/project/block but NOT status, so the
// tabs always show what each status would contain. Without `page` the
// legacy full-array response is returned so existing callers keep working.
const BRK_STATUSES = ["Pending", "Approved", "Paid"];
const BRK_SORT = {
  BookingNo: "b.BookingNo",
  BrokerName: "ahm.LHeadName",
  Status: "br.Status",
  ComputedAmount: "br.ComputedAmount",
  CreatedAt: "br.CreatedAt",
};
function buildBrkWhere(request, query, includeStatus, projectScope = null) {
  const conds = [];
  if (projectScope) conds.push(require("../services/projectScope").projectPredicate(projectScope, "b.ProjectId", "").trim());
  const intOf = (v) => { const x = parseInt(v, 10); return Number.isInteger(x) ? x : null; };
  const companyId = intOf(query.companyId);
  const projectId = intOf(query.projectId);
  const blockId = intOf(query.blockId);
  if (companyId) { request.input("companyId", sql.Int, companyId); conds.push("b.CompanyId = @companyId"); }
  if (projectId) { request.input("projectId", sql.Int, projectId); conds.push("b.ProjectId = @projectId"); }
  if (blockId)   { request.input("blockId", sql.Int, blockId);     conds.push("b.BlockId = @blockId"); }
  const search = String(query.search || "").trim().slice(0, 100);
  if (search) {
    request.input("search", sql.NVarChar(220), `%${search.replace(/[\[%_]/g, "[$&]")}%`);
    conds.push("(a.ApplicantName LIKE @search OR b.BookingNo LIKE @search OR ahm.LHeadName LIKE @search)");
  }
  if (includeStatus && BRK_STATUSES.includes(query.status)) {
    request.input("status", sql.NVarChar(20), query.status);
    conds.push("br.Status = @status");
  }
  return conds.length ? "WHERE " + conds.join(" AND ") : "";
}

// GET / — all brokerage records. Staff/internal only — never exposed to crm-portal.
router.get("/", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const SELECT_WITH_BLOCK = `${BROKERAGE_SELECT} LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId`;

    if (req.query.page === undefined) {
      const r0 = pool.request();
      const where = buildBrkWhere(r0, req.query, true, req.projectScope);
      const result = await r0.query(`${SELECT_WITH_BLOCK} ${where} ORDER BY br.CreatedAt DESC`);
      return res.json(result.recordset);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const sortCol = Object.hasOwn(BRK_SORT, req.query.sortKey) ? BRK_SORT[req.query.sortKey] : BRK_SORT.CreatedAt;
    const dir = req.query.sortDir === "asc" ? "ASC" : "DESC";

    const countReq = pool.request();
    const countWhere = buildBrkWhere(countReq, req.query, false, req.projectScope);
    const countRes = await countReq.query(
      `SELECT br.Status, COUNT(*) AS C FROM dbo.CrmBrokerageMaster br
       JOIN dbo.CrmBooking b ON b.Id = br.BookingId
       JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
       LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = br.BrokerId
       ${countWhere} GROUP BY br.Status`
    );
    const counts = { All: 0 };
    for (const row of countRes.recordset) { counts[row.Status] = row.C; counts.All += row.C; }
    const total = BRK_STATUSES.includes(req.query.status) ? (counts[req.query.status] || 0) : counts.All;

    const pageReq = pool.request();
    const pageWhere = buildBrkWhere(pageReq, req.query, true, req.projectScope);
    pageReq.input("offset", sql.Int, (page - 1) * pageSize);
    pageReq.input("pageSize", sql.Int, pageSize);
    const rowsRes = await pageReq.query(
      `${SELECT_WITH_BLOCK} ${pageWhere} ORDER BY ${sortCol} ${dir}, br.Id DESC OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY`
    );
    res.json({ rows: rowsRes.recordset, total, counts });
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
    if (req.projectScope) conds.push(projectPredicate(req.projectScope, "b.ProjectId", "").trim());
    if (status) { req0.input("st", sql.NVarChar(20), status); conds.push("br.Status = @st"); }
    const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const scope = req.projectScope ? projectPredicate(req.projectScope, "b.ProjectId") : "";
    const result = await req0.query(`
      SELECT p.Id, p.BrokerageId, p.Amount, p.PaidDate, p.PaymentMode, p.TransactionRef, p.Notes, p.CreatedAt,
             CAST(NULL AS INT) AS FinancePaymentId, CAST(NULL AS NVARCHAR(100)) AS FinancePaymentDocNo, 'Paid' AS FinancePaymentStatus,
             br.RateType, br.RateValue, br.ComputedAmount, br.Status AS BrokerageStatus,
             br.BrokerName, br.BrokerFirm, b.BookingNo,
             COALESCE(bn1.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName,
             cu.name AS CreatedByName
      FROM dbo.CrmBrokerPayment p
      JOIN dbo.CrmBrokerageMaster br ON br.Id = p.BrokerageId
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn1 ON bn1.BookingId = b.Id
      LEFT JOIN dbo.Users cu ON cu.id = p.CreatedBy
      ${where}
      UNION ALL
      SELECT np.PPaymentID AS Id, br.Id AS BrokerageId, np.PAmount - ISNULL(np.TDSAmount, 0) AS Amount, np.PDate AS PaidDate, np.PMode AS PaymentMode,
             COALESCE(np.PNeftNumber, np.PUpiTransactionId, np.PRtgsReference, np.PImpsReference, np.PCardReference, np.PChequeNo, np.DocNo) AS TransactionRef,
             np.PRemarks AS Notes, np.PCreatedAt AS CreatedAt,
             np.PPaymentID AS FinancePaymentId, np.DocNo AS FinancePaymentDocNo, np.Status AS FinancePaymentStatus,
             br.RateType, br.RateValue, br.ComputedAmount, br.Status AS BrokerageStatus,
             br.BrokerName, br.BrokerFirm, b.BookingNo,
             COALESCE(bn2.UnitNo, b.UnitNo) AS UnitNo, a.ApplicantName,
             np.PCreatedBy AS CreatedByName
      FROM dbo.NewPayment np
      JOIN dbo.CrmBrokerageMaster br ON br.Id = np.SourceCrmBrokerageId
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      JOIN dbo.CrmApplication a ON a.Id = b.ApplicationId
      LEFT JOIN dbo.vw_CrmBookingDisplay bn2 ON bn2.BookingId = b.Id
      -- A voucher already recorded as a broker payment (approved) is listed
      -- once, by that payment row above — not twice.
      WHERE np.Status IN ('${CrmStatus.DRAFT}','${CrmStatus.PENDING}','${CrmStatus.APPROVED}')
        AND NOT EXISTS (SELECT 1 FROM dbo.CrmBrokerPayment bp WHERE bp.SourceNewPaymentId = np.PPaymentID) ${status ? "AND br.Status = @st" : ""} ${scope}
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

// One voucher per tranche: approve and "retry hand-off" racing each other
// both passed the "no voucher yet" check and raised two. The check and the
// insert now run in one transaction behind a lock on the brokerage row.
async function createFinancePaymentForBrokerage(pool, brokerageId, req) {
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input("id", sql.Int, brokerageId)
      .query("SELECT Id FROM dbo.CrmBrokerageMaster WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id");
    const out = await createFinancePaymentForBrokerageLocked(tx, brokerageId, req);
    await tx.commit();
    return out;
  } catch (e) {
    try { await tx.rollback(); } catch (_) { /* already rolled back */ }
    throw e;
  }
}

async function createFinancePaymentForBrokerageLocked(pool, brokerageId, req) {
  const existing = await pool.request().input("id", sql.Int, brokerageId).query(`
    SELECT TOP 1 PPaymentID, DocNo, Status
    FROM dbo.NewPayment
    WHERE SourceCrmBrokerageId = @id AND Status NOT IN ('${CrmStatus.REJECTED}','Deleted')
    ORDER BY PPaymentID DESC
  `);
  if (existing.recordset.length) return { existing: true, ...existing.recordset[0] };

  const br = await pool.request().input("id", sql.Int, brokerageId).query(`
    SELECT br.Id, br.Status, br.ComputedAmount, br.TDSId, br.TDSNature, br.TDSName,
           br.TDSPercentage, br.TDSAmount, br.NetPayable,
           br.BrokerId, br.BrokerName, br.TrancheLabel, b.BookingNo, b.CompanyId, b.ProjectId
    FROM dbo.CrmBrokerageMaster br
    JOIN dbo.CrmBooking b ON b.Id = br.BookingId
    WHERE br.Id = @id
  `);
  const row = br.recordset[0];
  if (!row) throw new Error("Brokerage record not found");
  if (row.Status !== CrmStatus.APPROVED) throw new Error(`Brokerage must be Approved before finance handoff (currently ${row.Status})`);
  if (!row.BrokerId) throw new Error("Brokerage has no broker ledger head");

  // Finance disburses net-of-TDS — the TDS portion is remitted to the government
  // separately by the company. Using NetPayable (gross minus TDS) ensures Finance
  // only pays out what's legally due to the broker.
  const amount = Number(row.NetPayable ?? row.ComputedAmount) || 0;
  if (amount <= 0) throw new Error("Approved brokerage net payable amount must be greater than 0");
  // The voucher carries the GROSS with its TDS, like every TDS payment: the
  // payment posting then pays the bank the net and credits TDS Payable.
  // (Carrying the net here had the TDS deducted a second time.)
  const voucherAmount = Math.round((amount + (Number(row.TDSAmount) || 0)) * 100) / 100;

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
    .input("remarks", sql.NVarChar(1000), `Approved brokerage for ${row.BookingNo} (${milestoneText}) — gross ₹${Number(row.ComputedAmount).toLocaleString("en-IN")}, TDS ${row.TDSPercentage ?? 0}% (₹${Number(row.TDSAmount ?? 0).toLocaleString("en-IN")}), net payable ₹${amount.toLocaleString("en-IN")} — finance to complete payment details`)
    .input("amt", sql.Decimal(18,2), voucherAmount)
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
    .input("tdsId",     sql.Int,           row.TDSId ?? null)
    .input("tdsNature", sql.NVarChar(200), row.TDSNature ?? null)
    .input("tdsName",   sql.NVarChar(200), row.TDSName ?? null)
    .input("tdsPct",    sql.Decimal(5,2),  Number(row.TDSPercentage) || 0)
    .input("tdsAmt",    sql.Decimal(18,2), Number(row.TDSAmount) || 0)
    .query(`
      INSERT INTO dbo.NewPayment (
        PPaymentName, PRemarks, PMode, PBankName, PAmount, PDocType, PDate,
        PProject, PCompany, PPartyId,
        DocNo, DocTypeId, DocYear, DocSerial, PFinYearId,
        SourceCrmBrokerageId,
        TDSId, TDSNature, TDSName, TDSPercentage, TDSAmount,
        PCreatedAt, PCreatedBy, PApprovedBy, Status
      )
      OUTPUT INSERTED.PPaymentID
      VALUES (
        @name, @remarks, '', '', @amt, 'Brokerage', @dt,
        @project, @company, @partyId,
        @docNo, @docTypeId, @docYear, @docSerial, @finYearId,
        @sourceBrokerageId,
        @tdsId, @tdsNature, @tdsName, @tdsPct, @tdsAmt,
        SYSDATETIME(), @createdBy, NULL, 'Pending'
      )
    `);

  const newPaymentId = result.recordset[0].PPaymentID;
  await backPatchRecordId(pool, sql, finalDocNo, "NewPayment", newPaymentId);
  return { existing: false, PPaymentID: newPaymentId, DocNo: finalDocNo, Status: CrmStatus.PENDING };
}

router.get("/:id", requirePageRight("crm-brokerage", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
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

    const allowed = await assertBookingProjectScope(req, res, b.BookingId);
    if (allowed === false) return;

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
      .query("SELECT TOP 1 Status FROM dbo.CrmAgreement WHERE BookingId = @bid ORDER BY CASE WHEN Status = 'Cancelled' THEN 1 ELSE 0 END, Id DESC");
    if (!agr.recordset.length || ![CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(agr.recordset[0].Status)) {
      return res.status(400).json({ error: "Brokerage requires the agreement to be Executed first" });
    }

    const broker = await pool.request().input("bid", sql.Int, parseInt(b.BrokerId))
      .query("SELECT LHeadId, LHeadName, LHeadPhone, ISNULL(IsTdsApplicable,1) AS IsTdsApplicable, ISNULL(TdsLimitApplicable,1) AS TdsLimitApplicable FROM dbo.AccountHeadMaster WHERE LHeadId = @bid AND LHeadType = 'BR' AND LHeadStatus = 1");
    if (!broker.recordset.length) return res.status(400).json({ error: "Selected broker does not exist or is inactive" });

    const brokerRow = broker.recordset[0];
    // Enforce TDS flag from Broker Master — if broker is marked non-applicable,
    // silently clear any submitted TDSId; if applicable and TDSId omitted,
    // warn but allow (threshold enforcement would need cumulative lookup).
    if (!brokerRow.IsTdsApplicable && b.TDSId) {
      b.TDSId = null; // Broker marked TDS not applicable — ignore submitted TDS
    }

    const rateType = b.RateType === "Amount" ? "Amount" : "Percentage";
    const rateValue = parseFloat(b.RateValue);
    if (!rateValue || rateValue <= 0) return res.status(400).json({ error: "RateValue must be greater than 0" });
    const bk = await pool.request().input("bid", sql.Int, parseInt(b.BookingId))
      .query("SELECT TotalValue, ParkingTotal, ExtraChargesTotal, CompanyId FROM dbo.CrmBooking WHERE Id = @bid");
    const bkRow = bk.recordset[0] || {};
    // Same deal-value definition as the auto-created schedule in
    // crmWorkflowGuards.js's maybeAutoCreateBrokerage (TotalValue +
    // ParkingTotal + ExtraChargesTotal) — this manual-entry path never
    // picked up ExtraChargesTotal when that one was fixed (booking 41),
    // so a broker's tier/commission silently depended on which of the two
    // paths created their record.
    const dealValue = Number(bkRow.TotalValue || 0) + Number(bkRow.ParkingTotal || 0) + Number(bkRow.ExtraChargesTotal || 0);

    try {
      assertSanePercentRate(rateType, rateValue, dealValue);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const computedAmount = rateType === "Percentage" ? Math.round(dealValue * rateValue) / 100 : rateValue;

    // Resolve TDS via the shared tds.js pipeline (same as ExpenseBooking /
    // NewPayment direct-payment path) — this enforces IsTdsApplicable,
    // evaluates the TdsLimitApplicable threshold (₹30k single / ₹1L
    // cumulative per company per FY), and validates the selected TDS record.
    const { resolveTds } = require("../services/tds");
    let tdsSnapshot;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const finYearId = await resolveFinYearId(pool, today);
      tdsSnapshot = await resolveTds(pool, sql, {
        partyHeadId: brokerRow.LHeadId,
        tdsApplicableFlag: !!brokerRow.IsTdsApplicable,
        tdsLimitApplicable: !!brokerRow.TdsLimitApplicable,
        billAmount: computedAmount,
        companyId: bkRow.CompanyId != null ? parseInt(bkRow.CompanyId, 10) : null,
        finYearId,
        selectedTdsId: b.TDSId !== undefined && b.TDSId !== null && b.TDSId !== "" ? parseInt(b.TDSId, 10) : null,
      });
    } catch (tdsErr) {
      return res.status(tdsErr.status || 400).json({ error: tdsErr.message });
    }
    const tdsId = tdsSnapshot.tdsId;
    const tdsNature = tdsSnapshot.tdsNature;
    const tdsName = tdsSnapshot.tdsName;
    const tdsPercentage = tdsSnapshot.tdsPercentage || 0;
    const tdsAmount = tdsSnapshot.tdsAmount || 0;
    const netPayable = Math.round((computedAmount - tdsAmount) * 100) / 100;

    const result = await pool.request()
      .input("bid",   sql.Int,           parseInt(b.BookingId))
      .input("brid",  sql.Int,           brokerRow.LHeadId)
      .input("name",  sql.NVarChar(200), brokerRow.LHeadName)
      .input("firm",  sql.NVarChar(200), b.BrokerFirm || null)
      .input("con",   sql.NVarChar(20),  brokerRow.LHeadPhone || null)
      .input("rt",    sql.NVarChar(20),  rateType)
      .input("rv",    sql.Decimal(18,2), rateValue)
      .input("camt",  sql.Decimal(18,2), computedAmount)
      .input("tdsid", sql.Int,           tdsId)
      .input("tdsnature", sql.NVarChar(200), tdsNature)
      .input("tdsname",   sql.NVarChar(200), tdsName)
      .input("tdspct",sql.Decimal(5,2),  tdsPercentage)
      .input("tdsamt",sql.Decimal(18,2), tdsAmount)
      .input("net",   sql.Decimal(18,2), netPayable)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("cb",    sql.Int,           actorId(req))
      .query(`
        INSERT INTO dbo.CrmBrokerageMaster
          (BookingId, BrokerId, BrokerName, BrokerFirm, BrokerContact, RateType, RateValue,
           ComputedAmount, TDSId, TDSNature, TDSName, TDSPercentage, TDSAmount, NetPayable,
           Status, Notes, CreatedBy, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES (@bid, @brid, @name, @firm, @con, @rt, @rv, @camt,
                @tdsid, @tdsnature, @tdsname, @tdspct, @tdsamt, @net,
                'Pending', @notes, @cb, SYSDATETIME())
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
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ error: "Invalid id" });
    const b = req.body;
    const cur = await pool.request().input("id", sql.Int, id).query(`
      SELECT br.Status, br.RateType, br.RateValue,
             br.TDSId, br.TDSNature, br.TDSName, br.TDSPercentage,
             br.BrokerId,
             b.TotalValue, b.ParkingTotal, b.CompanyId,
             ISNULL(ahm.IsTdsApplicable,1)    AS BrokerIsTdsApplicable,
             ISNULL(ahm.TdsLimitApplicable,1) AS BrokerTdsLimitApplicable
      FROM dbo.CrmBrokerageMaster br
      JOIN dbo.CrmBooking b ON b.Id = br.BookingId
      LEFT JOIN dbo.AccountHeadMaster ahm ON ahm.LHeadId = br.BrokerId
      WHERE br.Id = @id
    `);
    if (!cur.recordset.length) return res.status(404).json({ error: "Brokerage record not found" });
    const row = cur.recordset[0];
    if (row.Status === CrmStatus.APPROVED || row.Status === CrmStatus.PAID) {
      return res.status(400).json({ error: "Brokerage can only be customized before approval" });
    }
    // If broker is marked TDS not applicable, ignore any submitted TDSId
    if (!row.BrokerIsTdsApplicable && b.TDSId) {
      b.TDSId = "";
    }

    const rateType = b.RateType === "Amount" ? "Amount" : (b.RateType === "Percentage" ? "Percentage" : row.RateType);
    const rateValue = b.RateValue != null && b.RateValue !== "" ? Number(b.RateValue) : Number(row.RateValue);
    if (!Number.isFinite(rateValue) || rateValue <= 0) return res.status(400).json({ error: "RateValue must be greater than 0" });
    const baseAmount = Number(row.TotalValue || 0) + Number(row.ParkingTotal || 0);
    try {
      assertSanePercentRate(rateType, rateValue, baseAmount);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const computedAmount = b.ComputedAmount != null && b.ComputedAmount !== ""
      ? Math.round(Number(b.ComputedAmount) * 100) / 100
      : computeBrokerageAmount(rateType, rateValue, baseAmount);
    if (!Number.isFinite(computedAmount) || computedAmount <= 0) {
      return res.status(400).json({ error: "ComputedAmount must be greater than 0" });
    }

    // Re-resolve TDS via the shared pipeline — enforces IsTdsApplicable and
    // TdsLimitApplicable threshold (₹30k / ₹1L) exactly like the POST path.
    // The caller may pass a new TDSId, clear it (""/0), or omit it (null),
    // in which case we keep what is already stored on the record.
    const selectedTdsId =
      b.TDSId === "" || b.TDSId === 0 ? null
      : b.TDSId != null               ? parseInt(b.TDSId, 10)
      :                                  row.TDSId ?? null;
    const { resolveTds: resolveTdsPut } = require("../services/tds");
    let putTdsSnapshot;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const finYearId = await resolveFinYearId(pool, today);
      putTdsSnapshot = await resolveTdsPut(pool, sql, {
        partyHeadId: parseInt(row.BrokerId, 10),
        tdsApplicableFlag: !!row.BrokerIsTdsApplicable,
        tdsLimitApplicable: !!row.BrokerTdsLimitApplicable,
        billAmount: computedAmount,
        companyId: row.CompanyId != null ? parseInt(row.CompanyId, 10) : null,
        finYearId,
        selectedTdsId,
      });
    } catch (tdsErr) {
      return res.status(tdsErr.status || 400).json({ error: tdsErr.message });
    }
    const putTdsId  = putTdsSnapshot.tdsId;
    const putTdsNature = putTdsSnapshot.tdsNature;
    const putTdsName   = putTdsSnapshot.tdsName;
    const putTdsPct    = putTdsSnapshot.tdsPercentage || 0;
    const putTdsAmt    = putTdsSnapshot.tdsAmount || 0;
    const putNet = Math.round((computedAmount - putTdsAmt) * 100) / 100;

    await pool.request()
      .input("id", sql.Int, id)
      .input("firm", sql.NVarChar(200), b.BrokerFirm || null)
      .input("rt", sql.NVarChar(20), rateType)
      .input("rv", sql.Decimal(18,2), rateValue)
      .input("camt", sql.Decimal(18,2), computedAmount)
      .input("tdsid",    sql.Int,            putTdsId)
      .input("tdsnature",sql.NVarChar(200),  putTdsNature)
      .input("tdsname",  sql.NVarChar(200),  putTdsName)
      .input("tdspct",   sql.Decimal(5,2),   putTdsPct)
      .input("tdsamt",   sql.Decimal(18,2),  putTdsAmt)
      .input("net",      sql.Decimal(18,2),  putNet)
      .input("notes", sql.NVarChar(sql.MAX), b.Notes || null)
      .input("ub", sql.Int, actorId(req))
      .query(`
        UPDATE dbo.CrmBrokerageMaster SET
          BrokerFirm = @firm,
          RateType = @rt,
          RateValue = @rv,
          ComputedAmount = @camt,
          TDSId = @tdsid,
          TDSNature = @tdsnature,
          TDSName = @tdsname,
          TDSPercentage = @tdspct,
          TDSAmount = @tdsamt,
          NetPayable = @net,
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
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const pool = getPool();
    const bk = await pool.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmBrokerageMaster WHERE Id = @id");
    if (!bk.recordset.length) return res.status(404).json({ error: "Brokerage record not found" });
    const activeErr = await requireActiveBooking(pool, bk.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
    const result = await approvalTransition("crm-brokerage", id, CrmStatus.PENDING, userEmail, req.user?.role);
    res.json({ success: true, status: result.newStatus });
  } catch (e) {
    console.error("[crm-brokerage] submit error:", e.message);
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put("/:id/approve", requirePageRight("crm-brokerage", "edit"), async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
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
      .query("SELECT IsLocked, UnlockGate, BookingId FROM dbo.CrmBrokerageMaster WHERE Id = @id");
    if (!locked.recordset.length) return res.status(404).json({ error: "Brokerage record not found" });
    if (locked.recordset[0]?.IsLocked) {
      const msg = "This tranche unlocks once the Agreement is Executed";
      return res.status(400).json({ error: msg });
    }
    // requireActiveBooking is only checked at tranche creation (POST /) —
    // nothing re-checks it on submit/approve/reject, so a tranche created
    // while the booking was still live stays Pending/actionable even after
    // the booking is later cancelled. Approving it would post a real GL
    // accrual and a Finance payout voucher for a dead booking's commission.
    const activeErr = await requireActiveBooking(pool, locked.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });

    const result = await approvalTransition("crm-brokerage", id, CrmStatus.APPROVED, userEmail, req.user?.role, null, req.user?.userId ?? null);
    // approvalTransition() manages its own internal transaction and commits
    // before returning, so by this point the Approved status is already
    // permanent — it can't be rolled back if the Finance handoff below
    // fails. That failure mode is real (caught one live: a schema mismatch
    // left an Approved record with no NewPayment and no way back to Pending
    // to retry /approve). Report it as a distinct, recoverable condition —
    // not a generic 400 that reads as "the approval failed" when it didn't —
    // and let PUT /:id/retry-finance-handoff pick up exactly this case.
    let financePayment = null;
    if (result.newStatus === CrmStatus.APPROVED) {
      await pool.request().input("id", sql.Int, id).input("by", sql.Int, req.user?.userId ?? null)
        .query("UPDATE dbo.CrmBrokerageMaster SET ApprovedBy = ISNULL(ApprovedBy, @by), ApprovedAt = ISNULL(ApprovedAt, SYSDATETIME()) WHERE Id = @id");
      // What is owed to the broker goes to the books now; a ledger failure is
      // recorded and reported, never allowed to undo the approval.
      try {
        const outcome = await require("../services/crmLedger").postCrmBrokerageAccrualToGL(pool, id, userEmail);
        await require("../services/approvalService").recordGLPosting("crm-brokerage", id, outcome, userEmail);
      } catch (glErr) {
        await require("../services/approvalService").recordGLPosting("crm-brokerage", id, { failed: true, reason: glErr.message }, userEmail).catch(() => {});
      }
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
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const bk = await pool.request().input("id", sql.Int, id).query("SELECT BookingId FROM dbo.CrmBrokerageMaster WHERE Id = @id");
    if (!bk.recordset.length) return res.status(404).json({ error: "Brokerage record not found" });
    const activeErr = await requireActiveBooking(pool, bk.recordset[0].BookingId);
    if (activeErr) return res.status(400).json({ error: activeErr });
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
  const id = parseId(req.params.id);
  if (id === null) return res.status(400).json({ error: "Invalid id" });
  try {
    const userEmail = requireUserEmail(req, res);
    if (!userEmail) return;
    const result = await approvalTransition("crm-brokerage", id, CrmStatus.REJECTED, userEmail, req.user?.role, req.body?.note || null);
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