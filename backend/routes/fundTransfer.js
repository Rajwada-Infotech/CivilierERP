const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { resolveDocTypeId, lockNextDocNumber, backPatchRecordId } = require("../utils/docNumberLock");
const { transition, guardEdit } = require("../services/approvalService");
const { resolveAllowPostApproval } = require("../middleware/permissions");
const { postFundTransferApproval, hasPosting } = require("../services/generalLedger");

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
}

// Shared validation for POST / and PUT /:id — same rules the DB's own
// CK_FT_DifferentBanks/CK_FT_CompanyConsistency constraints enforce, checked
// here first so a bad request gets a readable error instead of a raw SQL
// constraint-violation message.
function validateTransfer(b) {
  if (!b.TransferDate) return "TransferDate is required.";
  if (!["Intra", "Inter"].includes(b.TransferType)) return "TransferType must be 'Intra' or 'Inter'.";
  const sourceCompanyId = parseInt(b.SourceCompanyId, 10);
  const destCompanyId = parseInt(b.DestinationCompanyId, 10);
  const sourceBankId = parseInt(b.SourceBankId, 10);
  const destBankId = parseInt(b.DestinationBankId, 10);
  if (!sourceCompanyId || !destCompanyId) return "SourceCompanyId and DestinationCompanyId are required.";
  if (!sourceBankId || !destBankId) return "SourceBankId and DestinationBankId are required.";
  if (sourceBankId === destBankId) return "Source and destination bank accounts must differ.";
  if (b.TransferType === "Intra" && sourceCompanyId !== destCompanyId)
    return "Intra-company transfer requires the same company on both sides — use Inter-company for a different company.";
  if (b.TransferType === "Inter" && sourceCompanyId === destCompanyId)
    return "Inter-company transfer requires two different companies — use Intra-company for the same company's own banks.";
  const amount = Number(b.Amount);
  if (!(amount > 0)) return "Amount must be greater than 0.";
  return null;
}

// ── GET / — list, with filters ──────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const { status, transferType, companyId, dateFrom, dateTo } = req.query;
    const request = pool.request();
    const conditions = [];

    if (status) {
      conditions.push("ft.Status = @status");
      request.input("status", sql.NVarChar(20), status);
    }
    if (transferType) {
      conditions.push("ft.TransferType = @transferType");
      request.input("transferType", sql.NVarChar(20), transferType);
    }
    if (companyId) {
      conditions.push("(ft.SourceCompanyId = @companyId OR ft.DestinationCompanyId = @companyId)");
      request.input("companyId", sql.Int, parseInt(companyId, 10));
    }
    if (dateFrom) {
      conditions.push("ft.TransferDate >= @dateFrom");
      request.input("dateFrom", sql.Date, dateFrom);
    }
    if (dateTo) {
      conditions.push("ft.TransferDate <= @dateTo");
      request.input("dateTo", sql.Date, dateTo);
    }

    let query = `
      SELECT ft.FTId, ft.DocNo, ft.TransferDate, ft.TransferType, ft.Amount, ft.Narration, ft.Status,
             ft.SourceCompanyId, sc.name AS SourceCompanyName,
             ft.DestinationCompanyId, dc.name AS DestinationCompanyName,
             ft.SourceBankId, sb.LHeadName AS SourceBankName,
             ft.DestinationBankId, db.LHeadName AS DestinationBankName,
             ft.LoanHeadId, lh.LHeadName AS LoanHeadName,
             ft.CreatedBy, ft.CreatedAt
      FROM dbo.FundTransfer ft
      LEFT JOIN dbo.enterprise sc ON sc.id = ft.SourceCompanyId
      LEFT JOIN dbo.enterprise dc ON dc.id = ft.DestinationCompanyId
      LEFT JOIN dbo.AccountHeadMaster sb ON sb.LHeadId = ft.SourceBankId
      LEFT JOIN dbo.AccountHeadMaster db ON db.LHeadId = ft.DestinationBankId
      LEFT JOIN dbo.AccountHeadMaster lh ON lh.LHeadId = ft.LoanHeadId
    `;
    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY ft.TransferDate DESC, ft.FTId DESC";

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /loans — the Inter-Company Loan register ────────────────────────────
// One row per counterparty COMPANY PAIR (see resolveOrCreateLoanHead() in
// generalLedger.js — one shared LHeadType='LN' head per pair, reused across
// every transfer between them, in either direction). Registered before
// "/:id" below, or Express would treat "loans" as an id.
//
// The running balance is derived straight from GeneralLedgerEntry rather
// than stored anywhere — the ledger IS the source of truth, exactly like
// Trial Balance. Two independent per-company balances are computed (net
// Dr-Cr scoped by CompanyId), which is what actually lets each side's own
// books stay correct — see the migration 291 header comment for why a
// single shared head + per-company filtering is the right design here.
router.get("/loans", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        lh.LHeadId, lh.LHeadName, lh.LHeadCode, lh.CreatedAt AS OpenedAt,
        gle.CompanyId,
        SUM(gle.DebitAmount) AS TotalDebit,
        SUM(gle.CreditAmount) AS TotalCredit,
        MAX(gle.VoucherDate) AS LastActivity,
        COUNT(DISTINCT gle.SourceId) AS TransferCount
      FROM dbo.AccountHeadMaster lh
      JOIN dbo.GeneralLedgerEntry gle ON gle.LHeadId = lh.LHeadId AND gle.SourceType = 'FundTransfer' AND gle.IsReversed = 0
      WHERE lh.LHeadType = 'LN' AND lh.LHeadCode LIKE 'FT-LOAN-%'
      GROUP BY lh.LHeadId, lh.LHeadName, lh.LHeadCode, lh.CreatedAt, gle.CompanyId
    `);

    // Pivot the two per-company rows for each head into one record — every
    // pair has exactly two sides (the company that sent, the company that
    // received), and callers want both balances side by side, not two
    // separate rows to reconcile themselves.
    const byHead = new Map();
    for (const row of result.recordset) {
      if (!byHead.has(row.LHeadId)) {
        byHead.set(row.LHeadId, {
          LHeadId: row.LHeadId,
          LHeadName: row.LHeadName,
          LHeadCode: row.LHeadCode,
          OpenedAt: row.OpenedAt,
          LastActivity: row.LastActivity,
          TransferCount: 0,
          sides: [],
        });
      }
      const head = byHead.get(row.LHeadId);
      // Positive = net debit = this company is owed (receivable); negative
      // = net credit = this company owes (payable) — the natural sign of a
      // ledger balance, not a re-derived label.
      const net = Number(row.TotalDebit || 0) - Number(row.TotalCredit || 0);
      head.sides.push({ CompanyId: row.CompanyId, NetBalance: Math.round(net * 100) / 100 });
      head.TransferCount = Math.max(head.TransferCount, Number(row.TransferCount) || 0);
      if (row.LastActivity && (!head.LastActivity || row.LastActivity > head.LastActivity)) {
        head.LastActivity = row.LastActivity;
      }
    }

    const companyIds = [...new Set(result.recordset.map((r) => r.CompanyId).filter(Boolean))];
    let companyNames = {};
    if (companyIds.length) {
      const cReq = pool.request();
      const placeholders = companyIds.map((id, i) => { cReq.input(`c${i}`, sql.Int, id); return `@c${i}`; });
      const companyRows = await cReq.query(`SELECT id, name FROM dbo.enterprise WHERE id IN (${placeholders.join(",")})`);
      companyNames = Object.fromEntries(companyRows.recordset.map((c) => [c.id, c.name]));
    }

    const loans = [...byHead.values()].map((head) => ({
      LHeadId: head.LHeadId,
      LHeadName: head.LHeadName,
      LHeadCode: head.LHeadCode,
      OpenedAt: head.OpenedAt,
      LastActivity: head.LastActivity,
      TransferCount: head.TransferCount,
      Sides: head.sides.map((s) => ({
        CompanyId: s.CompanyId,
        CompanyName: companyNames[s.CompanyId] || `Company ${s.CompanyId}`,
        NetBalance: s.NetBalance,
      })),
    }));

    res.json(loans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /loans/:lHeadId — passbook-style ledger for one loan head ───────────
router.get("/loans/:lHeadId", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const lHeadId = parseInt(req.params.lHeadId, 10);
    if (isNaN(lHeadId)) return res.status(400).json({ error: "Invalid id" });

    const head = await pool.request().input("id", sql.Int, lHeadId).query(`
      SELECT LHeadId, LHeadName, LHeadCode, CreatedAt AS OpenedAt
      FROM dbo.AccountHeadMaster
      WHERE LHeadId = @id AND LHeadType = 'LN' AND LHeadCode LIKE 'FT-LOAN-%'
    `);
    if (!head.recordset.length) return res.status(404).json({ error: "Loan account not found" });

    const entries = await pool.request().input("id", sql.Int, lHeadId).query(`
      SELECT gle.EntryId, gle.VoucherNo, gle.VoucherDate, gle.DebitAmount, gle.CreditAmount,
             gle.Narration, gle.CompanyId, co.name AS CompanyName, gle.SourceId,
             ft.DocNo, ft.TransferType, ft.Status AS TransferStatus
      FROM dbo.GeneralLedgerEntry gle
      LEFT JOIN dbo.enterprise co ON co.id = gle.CompanyId
      LEFT JOIN dbo.FundTransfer ft ON ft.FTId = gle.SourceId AND gle.SourceType = 'FundTransfer'
      WHERE gle.LHeadId = @id AND gle.SourceType = 'FundTransfer' AND gle.IsReversed = 0
      ORDER BY gle.VoucherDate, gle.EntryId
    `);

    res.json({ ...head.recordset[0], entries: entries.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — single transfer ──────────────────────────────────────────────
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT ft.*,
             sc.name AS SourceCompanyName, dc.name AS DestinationCompanyName,
             sb.LHeadName AS SourceBankName, db.LHeadName AS DestinationBankName,
             lh.LHeadName AS LoanHeadName
      FROM dbo.FundTransfer ft
      LEFT JOIN dbo.enterprise sc ON sc.id = ft.SourceCompanyId
      LEFT JOIN dbo.enterprise dc ON dc.id = ft.DestinationCompanyId
      LEFT JOIN dbo.AccountHeadMaster sb ON sb.LHeadId = ft.SourceBankId
      LEFT JOIN dbo.AccountHeadMaster db ON db.LHeadId = ft.DestinationBankId
      LEFT JOIN dbo.AccountHeadMaster lh ON lh.LHeadId = ft.LoanHeadId
      WHERE ft.FTId = @id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });

    const postedToGL = await hasPosting(pool, "FundTransfer", id);
    res.json({ ...result.recordset[0], PostedToGL: postedToGL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create (Draft, auto-submitted to Pending) ──────────────────────
router.post("/", authenticateToken, requirePageRight("fund-transfer", "create"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const b = req.body;
    const linesError = validateTransfer(b);
    if (linesError) return res.status(400).json({ error: linesError });

    const dtId = await resolveDocTypeId(pool, sql, "FT");
    const finalDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId: dtId,
      finYear: b.finYear,
      tableName: "FundTransfer",
      docNoColumn: "DocNo",
      issuedBy: user,
    });

    const insert = await pool.request()
      .input("DocNo", sql.NVarChar(100), finalDocNo || null)
      .input("TransferDate", sql.Date, b.TransferDate)
      .input("TransferType", sql.NVarChar(20), b.TransferType)
      .input("SourceCompanyId", sql.Int, parseInt(b.SourceCompanyId, 10))
      .input("DestinationCompanyId", sql.Int, parseInt(b.DestinationCompanyId, 10))
      .input("SourceBankId", sql.Int, parseInt(b.SourceBankId, 10))
      .input("DestinationBankId", sql.Int, parseInt(b.DestinationBankId, 10))
      .input("Amount", sql.Decimal(18, 2), Number(b.Amount))
      .input("Narration", sql.NVarChar(500), b.Narration || null)
      .input("DocTypeId", sql.Int, dtId || null)
      .input("CreatedBy", sql.NVarChar(150), user).query(`
        INSERT INTO dbo.FundTransfer
          (DocNo, TransferDate, TransferType, SourceCompanyId, DestinationCompanyId,
           SourceBankId, DestinationBankId, Amount, Narration, Status, DocTypeId, CreatedBy)
        OUTPUT INSERTED.FTId
        VALUES
          (@DocNo, @TransferDate, @TransferType, @SourceCompanyId, @DestinationCompanyId,
           @SourceBankId, @DestinationBankId, @Amount, @Narration, 'Draft', @DocTypeId, @CreatedBy)
      `);
    const newId = insert.recordset[0].FTId;

    if (finalDocNo) {
      await backPatchRecordId(pool, sql, finalDocNo, "FundTransfer", newId);
    }
    await bumpCacheVersion("fund-transfer");

    // Auto-submit: Draft -> Pending immediately, matching journal-voucher.js
    // / inter-company-transfer.js's convention — no manual "Submit" step.
    try {
      await transition("fund-transfer", newId, "Pending", req.user?.email, req.user?.role);
    } catch (submitErr) {
      console.warn("Fund Transfer auto-submit failed (non-fatal):", submitErr.message);
    }

    res.status(201).json({ FTId: newId, DocNo: finalDocNo, message: "Fund Transfer created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — edit (Draft only) ────────────────────────────────────────────
router.put("/:id", authenticateToken, requirePageRight("fund-transfer", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    try {
      const allowPostApproval = await resolveAllowPostApproval(req, "fund-transfer");
      await guardEdit("fund-transfer", id, { allowPostApproval });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const b = req.body;
    const linesError = validateTransfer(b);
    if (linesError) return res.status(400).json({ error: linesError });

    const updateResult = await pool.request()
      .input("id", sql.Int, id)
      .input("TransferDate", sql.Date, b.TransferDate)
      .input("TransferType", sql.NVarChar(20), b.TransferType)
      .input("SourceCompanyId", sql.Int, parseInt(b.SourceCompanyId, 10))
      .input("DestinationCompanyId", sql.Int, parseInt(b.DestinationCompanyId, 10))
      .input("SourceBankId", sql.Int, parseInt(b.SourceBankId, 10))
      .input("DestinationBankId", sql.Int, parseInt(b.DestinationBankId, 10))
      .input("Amount", sql.Decimal(18, 2), Number(b.Amount))
      .input("Narration", sql.NVarChar(500), b.Narration || null)
      .input("UpdatedBy", sql.NVarChar(150), user).query(`
        UPDATE dbo.FundTransfer SET
          TransferDate=@TransferDate, TransferType=@TransferType,
          SourceCompanyId=@SourceCompanyId, DestinationCompanyId=@DestinationCompanyId,
          SourceBankId=@SourceBankId, DestinationBankId=@DestinationBankId,
          Amount=@Amount, Narration=@Narration,
          UpdatedBy=@UpdatedBy, UpdatedAt=SYSDATETIME()
        WHERE FTId=@id AND Status='Draft'
      `);

    if (updateResult.rowsAffected[0] === 0) {
      return res.status(409).json({ error: "Update failed: the transfer status changed before the update could be applied." });
    }

    await bumpCacheVersion("fund-transfer");
    res.json({ message: "Fund Transfer updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved (super_admin only) ────────────────
router.put("/:id/approve", authenticateToken, requirePageRight("fund-transfer", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const current = await pool.request().input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.FundTransfer WHERE FTId = @id");
    if (!current.recordset.length) return res.status(404).json({ error: "Not found" });

    // If already Approved (a prior posting attempt failed after the status
    // transition succeeded), skip transition() and just retry the post —
    // postFundTransferApproval() is idempotent via hasPosting().
    const alreadyApproved = current.recordset[0].Status === "Approved";

    let transitionResult = {};
    if (!alreadyApproved) {
      transitionResult = await transition("fund-transfer", id, "Approved", user, req.user?.role, req.body?.note);
    }

    if (alreadyApproved) {
      try {
        await postFundTransferApproval(pool, id, user);
      } catch (postErr) {
        return res.status(500).json({
          error: `Transfer approved, but GL posting failed: ${postErr.message}. Re-submit approval to retry posting.`,
        });
      }
    }

    await bumpCacheVersion("fund-transfer");
    await bumpCacheVersion("general-ledger");
    res.json({ message: "Fund Transfer approved and posted to GL", ...transitionResult });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected (super_admin only) ─────────────────
router.put("/:id/reject", authenticateToken, requirePageRight("fund-transfer", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await transition("fund-transfer", id, "Rejected", user, req.user?.role, req.body?.note);
    await bumpCacheVersion("fund-transfer");
    res.json({ message: "Fund Transfer rejected", ...result });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
