const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const { resolveDocTypeId, lockNextDocNumber, backPatchRecordId } = require("../utils/docNumberLock");
const { transition, guardEdit, getRecordStatus } = require("../services/approvalService");
const { resolveAllowPostApproval } = require("../middleware/permissions");
const { postFundTransferApproval, hasPosting } = require("../services/generalLedger");
const { snapshotRow, recordAmendment } = require("../services/amendmentLog");

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

  const mode = b.Mode || null;
  const VALID_MODES = ["Cash", "Cheque", "Post-Dated Cheque", "NEFT", "UPI", "RTGS", "IMPS", "Card"];
  if (mode && !VALID_MODES.includes(mode)) return "Invalid payment Mode.";
  if (mode === "Cheque" || mode === "Post-Dated Cheque") {
    if (!b.ChequeLotId || !b.ChequeNo) return "Select a cheque lot and cheque number for this mode.";
    if (!b.ChequeDate) return "Cheque date is required for this mode.";
  }
  return null;
}

// A cheque leaf is shared physical stock across Payment and Fund Transfer —
// reject if the same (lot, number) is already claimed by either module
// (excluding this transfer's own row on an update) or was cancelled.
async function assertChequeAvailable(pool, lotId, chequeNo, excludeFTId) {
  const dupPayment = await pool.request()
    .input("ChequeLotId", sql.Int, lotId)
    .input("ChequeNo", sql.NVarChar(50), String(chequeNo)).query(`
      SELECT COUNT(*) AS cnt FROM dbo.NewPayment
      WHERE PChequeLotId = @ChequeLotId AND PChequeNo = @ChequeNo
        AND Status NOT IN ('Rejected', 'Deleted')
    `);
  if (dupPayment.recordset[0].cnt > 0) {
    const err = new Error("Cheque number already used in a Payment.");
    err.status = 409;
    throw err;
  }

  const ftReq = pool.request()
    .input("ChequeLotId", sql.Int, lotId)
    .input("ChequeNo", sql.NVarChar(50), String(chequeNo));
  let ftQuery = `
    SELECT COUNT(*) AS cnt FROM dbo.FundTransfer
    WHERE ChequeLotId = @ChequeLotId AND ChequeNo = @ChequeNo
      AND Status NOT IN ('Rejected', 'Deleted')
  `;
  if (excludeFTId) {
    ftReq.input("ExcludeFTId", sql.Int, excludeFTId);
    ftQuery += " AND FTId <> @ExcludeFTId";
  }
  const dupFT = await ftReq.query(ftQuery);
  if (dupFT.recordset[0].cnt > 0) {
    const err = new Error("Cheque number already used in another Fund Transfer.");
    err.status = 409;
    throw err;
  }

  const dupJV = await pool.request()
    .input("ChequeLotId", sql.Int, lotId)
    .input("ChequeNo", sql.NVarChar(50), String(chequeNo)).query(`
      SELECT COUNT(*) AS cnt FROM dbo.JournalVoucher
      WHERE ChequeLotId = @ChequeLotId AND ChequeNo = @ChequeNo
        AND Status NOT IN ('Rejected', 'Deleted')
    `);
  if (dupJV.recordset[0].cnt > 0) {
    const err = new Error("Cheque number already used in a Journal Voucher.");
    err.status = 409;
    throw err;
  }

  const cancelled = await pool.request()
    .input("ChequeLotId", sql.Int, lotId)
    .input("ChequeNo", sql.NVarChar(50), String(chequeNo))
    .query(`SELECT COUNT(*) AS cnt FROM dbo.CancelledCheque WHERE ChequeLotId = @ChequeLotId AND ChequeNo = @ChequeNo`);
  if (cancelled.recordset[0].cnt > 0) {
    const err = new Error("This cheque number has been cancelled and cannot be reissued.");
    err.status = 409;
    throw err;
  }
}

// ── GET / — list, with filters ──────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const { status, transferType, companyId, dateFrom, dateTo } = req.query;
    const request = pool.request();
    const conditions = [];

    if (companyId) {
      conditions.push("(ft.SourceCompanyId = @companyId OR ft.DestinationCompanyId = @companyId)");
      request.input("companyId", sql.Int, parseInt(companyId, 10));
    }

    if (status) {
      conditions.push("ft.Status = @status");
      request.input("status", sql.NVarChar(20), status);
    }
    if (transferType) {
      conditions.push("ft.TransferType = @transferType");
      request.input("transferType", sql.NVarChar(20), transferType);
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
             ft.LinkedLoanId, ls.LoanNo AS LinkedLoanNo, ls.Status AS LinkedLoanStatus,
             ft.Mode, ft.ChequeNo, ft.ChequeLotNumber, ft.ChequeDate, ft.IsPostDated, ft.DigitalRefNumber,
             ft.CreatedBy, ft.CreatedAt
      FROM dbo.FundTransfer ft
      LEFT JOIN dbo.enterprise sc ON sc.id = ft.SourceCompanyId
      LEFT JOIN dbo.enterprise dc ON dc.id = ft.DestinationCompanyId
      LEFT JOIN dbo.AccountHeadMaster sb ON sb.LHeadId = ft.SourceBankId
      LEFT JOIN dbo.AccountHeadMaster db ON db.LHeadId = ft.DestinationBankId
      LEFT JOIN dbo.LoanSanction ls ON ls.LoanId = ft.LinkedLoanId
    `;
    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY ft.TransferDate DESC, ft.FTId DESC";

    const result = await request.query(query);
    res.json(result.recordset);
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
             ls.LoanNo AS LinkedLoanNo, ls.Status AS LinkedLoanStatus
      FROM dbo.FundTransfer ft
      LEFT JOIN dbo.enterprise sc ON sc.id = ft.SourceCompanyId
      LEFT JOIN dbo.enterprise dc ON dc.id = ft.DestinationCompanyId
      LEFT JOIN dbo.AccountHeadMaster sb ON sb.LHeadId = ft.SourceBankId
      LEFT JOIN dbo.AccountHeadMaster db ON db.LHeadId = ft.DestinationBankId
      LEFT JOIN dbo.LoanSanction ls ON ls.LoanId = ft.LinkedLoanId
      WHERE ft.FTId = @id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Not found" });

    const postedToGL = await hasPosting(pool, "FundTransfer", id);
    res.json({ ...result.recordset[0], PostedToGL: postedToGL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/posting — GL posting preview / actual entries ──────────────────
// Mirrors the Posting tab already shown on GRN/Invoice/Received Payment.
// Intra-company posts one Dr/Cr pair; Inter-company posts TWO separate
// vouchers (one per company's own books, via the auto-created/reused
// per-company Loan ledger head — see postFundTransferApproval /
// ensureLoanLedgerHead) — so unlike those single-voucher modules, this can
// return more than one already-posted voucher for the same transfer.
router.get("/:id/posting", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const ftRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT ft.FTId, ft.DocNo, ft.TransferDate, ft.TransferType, ft.Amount, ft.Narration,
             ft.SourceCompanyId, sc.name AS SourceCompanyName,
             ft.DestinationCompanyId, dc.name AS DestinationCompanyName,
             ft.SourceBankId, sb.LHeadName AS SourceBankName,
             ft.DestinationBankId, db.LHeadName AS DestinationBankName,
             ft.LinkedLoanId, ls.LoanNo AS LinkedLoanNo
      FROM dbo.FundTransfer ft
      LEFT JOIN dbo.enterprise sc ON sc.id = ft.SourceCompanyId
      LEFT JOIN dbo.enterprise dc ON dc.id = ft.DestinationCompanyId
      LEFT JOIN dbo.AccountHeadMaster sb ON sb.LHeadId = ft.SourceBankId
      LEFT JOIN dbo.AccountHeadMaster db ON db.LHeadId = ft.DestinationBankId
      LEFT JOIN dbo.LoanSanction ls ON ls.LoanId = ft.LinkedLoanId
      WHERE ft.FTId = @id
    `);
    if (!ftRes.recordset.length) return res.status(404).json({ error: "Fund Transfer not found" });
    const ft = ftRes.recordset[0];
    const amount = Number(ft.Amount) || 0;
    const docNo = ft.DocNo || `FT-${id}`;

    // Real posted entries, if any — grouped into voucher(s) by VoucherNo,
    // since Inter-company posts two.
    const postedRes = await pool.request().input("id", sql.Int, id).query(`
      SELECT gle.EntryId, gle.VoucherNo, gle.CompanyId, gle.DebitAmount, gle.CreditAmount, gle.Narration,
             ah.LHeadId, ah.LHeadName
      FROM dbo.GeneralLedgerEntry gle
      JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
      WHERE gle.SourceType = 'FundTransfer' AND gle.SourceId = @id AND gle.IsReversed = 0
      ORDER BY gle.EntryId
    `);
    const isPosted = postedRes.recordset.length > 0;

    let vouchers;
    if (isPosted) {
      // Real entries — one voucher group per CompanyId (Inter posts one set
      // per side; Intra posts a single set under the source company).
      const byCompany = new Map();
      for (const row of postedRes.recordset) {
        const key = row.CompanyId ?? "none";
        if (!byCompany.has(key)) byCompany.set(key, { jvNo: row.VoucherNo, rows: [] });
        byCompany.get(key).rows.push({
          label: row.LHeadName,
          side: Number(row.DebitAmount) > 0 ? "debit" : "credit",
          amount: Number(row.DebitAmount) > 0 ? Number(row.DebitAmount) : Number(row.CreditAmount),
        });
      }
      vouchers = [...byCompany.values()];
    } else if (ft.TransferType === "Intra") {
      vouchers = [{
        jvNo: null,
        rows: [
          { label: ft.DestinationBankName || "Destination Bank", side: "debit", amount },
          { label: ft.SourceBankName || "Source Bank", side: "credit", amount },
        ],
      }];
    } else {
      // Inter-company preview — look up (never create) the per-company Loan
      // ledger head so the preview shows the real name whenever it already
      // exists from an earlier loan/transfer with that same company.
      const findLoanHead = async (companyId) => {
        if (!companyId) return null;
        const r = await pool.request().input("code", sql.NVarChar(20), `LOAN-C-${companyId}`)
          .query("SELECT LHeadName FROM dbo.AccountHeadMaster WHERE LHeadCode = @code");
        return r.recordset[0]?.LHeadName ?? null;
      };
      const lenderLoanName = (await findLoanHead(ft.SourceCompanyId)) || `Loan — ${ft.SourceCompanyName || "Source Company"} (auto-created on approval)`;
      const borrowerLoanName = (await findLoanHead(ft.DestinationCompanyId)) || `Loan — ${ft.DestinationCompanyName || "Destination Company"} (auto-created on approval)`;
      vouchers = [
        {
          jvNo: null,
          companyName: ft.SourceCompanyName,
          rows: [
            { label: lenderLoanName, side: "debit", amount },
            { label: ft.SourceBankName || "Source Bank", side: "credit", amount },
          ],
        },
        {
          jvNo: null,
          companyName: ft.DestinationCompanyName,
          rows: [
            { label: ft.DestinationBankName || "Destination Bank", side: "debit", amount },
            { label: borrowerLoanName, side: "credit", amount },
          ],
        },
      ];
    }

    res.json({
      docNo,
      transferType: ft.TransferType,
      amount,
      sourceCompanyName: ft.SourceCompanyName,
      destinationCompanyName: ft.DestinationCompanyName,
      linkedLoanNo: ft.LinkedLoanNo,
      isPosted,
      vouchers,
    });
  } catch (err) {
    console.error("Fund Transfer posting preview error:", err.message);
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
    // Inter-company Fund Transfer removed (kept only for reading/editing
    // the historical rows already created this way — validateTransfer
    // itself still accepts both types for that reason). Moving money
    // between two different companies is a loan (one now owes the other),
    // so it belongs in the Loan Sanction module, which already has the
    // interest/installment tracking this form never did.
    if (b.TransferType === "Inter") {
      return res.status(400).json({
        error: "Inter-company transfers are no longer created from Fund Transfer — use the Loan Sanction module instead.",
      });
    }
    const linesError = validateTransfer(b);
    if (linesError) return res.status(400).json({ error: linesError });

    const isChequeMode = b.Mode === "Cheque" || b.Mode === "Post-Dated Cheque";
    if (isChequeMode) {
      await assertChequeAvailable(pool, parseInt(b.ChequeLotId, 10), b.ChequeNo, null);
    }

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
      .input("Mode", sql.NVarChar(30), b.Mode || null)
      .input("ChequeLotId", sql.Int, isChequeMode ? parseInt(b.ChequeLotId, 10) : null)
      .input("ChequeLotNumber", sql.NVarChar(50), isChequeMode ? (b.ChequeLotNumber || null) : null)
      .input("ChequeNo", sql.NVarChar(20), isChequeMode ? String(b.ChequeNo) : null)
      .input("ChequeDate", sql.Date, isChequeMode ? (b.ChequeDate || null) : null)
      .input("IsPostDated", sql.Bit, b.Mode === "Post-Dated Cheque" ? 1 : 0)
      .input("DigitalRefNumber", sql.NVarChar(100), b.DigitalRefNumber || null)
      .input("CreatedBy", sql.NVarChar(150), user).query(`
        INSERT INTO dbo.FundTransfer
          (DocNo, TransferDate, TransferType, SourceCompanyId, DestinationCompanyId,
           SourceBankId, DestinationBankId, Amount, Narration, Status, DocTypeId, CreatedBy,
           Mode, ChequeLotId, ChequeLotNumber, ChequeNo, ChequeDate, IsPostDated, DigitalRefNumber)
        OUTPUT INSERTED.FTId
        VALUES
          (@DocNo, @TransferDate, @TransferType, @SourceCompanyId, @DestinationCompanyId,
           @SourceBankId, @DestinationBankId, @Amount, @Narration, 'Draft', @DocTypeId, @CreatedBy,
           @Mode, @ChequeLotId, @ChequeLotNumber, @ChequeNo, @ChequeDate, @IsPostDated, @DigitalRefNumber)
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
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id — edit (Draft or Rejected — guardEdit already allows both;
// saving a Rejected transfer re-submits it, see the resubmit block below) ──
router.put("/:id", authenticateToken, requirePageRight("fund-transfer", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    let wasRejected = false;
    try {
      const allowPostApproval = await resolveAllowPostApproval(req, "fund-transfer");
      await guardEdit("fund-transfer", id, { allowPostApproval });
      wasRejected = (await getRecordStatus("fund-transfer", id)) === "Rejected";
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const b = req.body;
    const linesError = validateTransfer(b);
    if (linesError) return res.status(400).json({ error: linesError });

    const isChequeMode = b.Mode === "Cheque" || b.Mode === "Post-Dated Cheque";
    if (isChequeMode) {
      await assertChequeAvailable(pool, parseInt(b.ChequeLotId, 10), b.ChequeNo, id);
    }

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
      .input("Mode", sql.NVarChar(30), b.Mode || null)
      .input("ChequeLotId", sql.Int, isChequeMode ? parseInt(b.ChequeLotId, 10) : null)
      .input("ChequeLotNumber", sql.NVarChar(50), isChequeMode ? (b.ChequeLotNumber || null) : null)
      .input("ChequeNo", sql.NVarChar(20), isChequeMode ? String(b.ChequeNo) : null)
      .input("ChequeDate", sql.Date, isChequeMode ? (b.ChequeDate || null) : null)
      .input("IsPostDated", sql.Bit, b.Mode === "Post-Dated Cheque" ? 1 : 0)
      .input("DigitalRefNumber", sql.NVarChar(100), b.DigitalRefNumber || null)
      .input("UpdatedBy", sql.NVarChar(150), user).query(`
        UPDATE dbo.FundTransfer SET
          TransferDate=@TransferDate, TransferType=@TransferType,
          SourceCompanyId=@SourceCompanyId, DestinationCompanyId=@DestinationCompanyId,
          SourceBankId=@SourceBankId, DestinationBankId=@DestinationBankId,
          Amount=@Amount, Narration=@Narration,
          Mode=@Mode, ChequeLotId=@ChequeLotId, ChequeLotNumber=@ChequeLotNumber,
          ChequeNo=@ChequeNo, ChequeDate=@ChequeDate, IsPostDated=@IsPostDated,
          DigitalRefNumber=@DigitalRefNumber,
          UpdatedBy=@UpdatedBy, UpdatedAt=SYSDATETIME()
        WHERE FTId=@id AND Status IN ('Draft', 'Rejected')
      `);

    if (updateResult.rowsAffected[0] === 0) {
      return res.status(409).json({ error: "Update failed: the transfer status changed before the update could be applied." });
    }

    await bumpCacheVersion("fund-transfer");

    // A corrected, previously-Rejected transfer goes straight back into the
    // approval queue on save — no separate "Submit" click. transition()'s
    // Pending branch writes a fresh Level=0 marker, which restarts approval
    // at level 1 regardless of what was approved before the rejection (see
    // approvalService.js's currentCycleCutoffSql).
    let resubmitted = false;
    if (wasRejected) {
      try {
        await transition("fund-transfer", id, "Pending", user, req.user?.role);
        resubmitted = true;
      } catch (resubmitErr) {
        console.error("[fund-transfer] auto-resubmit after edit failed:", resubmitErr.message);
        return res.status(207).json({
          message: "Fund Transfer updated, but could not be re-submitted for approval — submit it manually.",
          resubmitError: resubmitErr.message,
        });
      }
    }

    res.json({
      message: resubmitted ? "Fund Transfer updated and re-submitted for approval" : "Fund Transfer updated",
      resubmitted,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id/remarks — edit only the narration/remarks ──────────────────────
// Remarks carry no financial weight, so unlike PUT /:id (full edit, Draft or
// Rejected only) they stay editable while the transfer is Pending too. Once
// Approved they're still editable, but only with the post-approval right, and
// the change is written to the Amendment trail (Finance → Amendment). The GL
// posting is left alone — only the transfer's own Narration changes.
router.put("/:id/remarks", authenticateToken, requirePageRight("fund-transfer", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const raw = req.body?.Narration;
    if (raw !== undefined && raw !== null && typeof raw !== "string") {
      return res.status(400).json({ error: "Narration must be text." });
    }
    const narration = (raw || "").trim();
    if (narration.length > 500) {
      return res.status(400).json({ error: "Narration can be at most 500 characters." });
    }

    const before = await snapshotRow(pool, "dbo.FundTransfer", "FTId", id);
    if (!before) return res.status(404).json({ error: "Not found" });

    const status = before.Status;
    const wasApproved = status === "Approved";
    if (!wasApproved && !["Draft", "Pending", "Rejected"].includes(status)) {
      return res.status(400).json({ error: `Remarks cannot be edited on a ${status} transfer.` });
    }
    if (wasApproved && !(await resolveAllowPostApproval(req, "fund-transfer"))) {
      return res.status(403).json({ error: "You don't have permission to edit an approved transfer." });
    }

    const updateResult = await pool.request()
      .input("id", sql.Int, id)
      .input("status", sql.NVarChar(20), status)
      .input("Narration", sql.NVarChar(500), narration || null)
      .input("UpdatedBy", sql.NVarChar(150), user).query(`
        UPDATE dbo.FundTransfer
        SET Narration=@Narration, UpdatedBy=@UpdatedBy, UpdatedAt=SYSDATETIME()
        WHERE FTId=@id AND Status=@status
      `);
    if (updateResult.rowsAffected[0] === 0) {
      return res.status(409).json({ error: "The transfer's status changed before the remarks could be saved. Reload and try again." });
    }

    await bumpCacheVersion("fund-transfer");

    let amendmentId = null;
    if (wasApproved) {
      try {
        const after = await snapshotRow(pool, "dbo.FundTransfer", "FTId", id);
        const company = await pool.request().input("c", sql.Int, before.SourceCompanyId)
          .query("SELECT name FROM dbo.enterprise WHERE id = @c");
        amendmentId = await recordAmendment({
          refDocType: "fund-transfer",
          refDocId: id,
          refDocNo: before.DocNo,
          projectName: null,
          companyName: company.recordset[0]?.name || null,
          changedBy: user,
          before,
          after,
          fieldLabels: { Narration: "Narration / Remarks" },
        });
      } catch (logErr) {
        console.error("Amendment log error (fund-transfer):", logErr.message);
      }
    }

    res.json({
      message: amendmentId ? "Remarks updated and logged in Amendment" : "Remarks updated",
      amendmentId,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved (super_admin, OR anyone named as
// an approver on this record's current level in Approval Setup) ───────────
// No requirePageRight gate — transition() is the real authority (role
// whitelist / approval-inbox edit right / named workflow approver); the
// page-right gate used to 403 a named approver before transition() ever
// ran, same bug fixed for journal-voucher.js.
router.put("/:id/approve", authenticateToken, async (req, res) => {
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
      transitionResult = await transition("fund-transfer", id, "Approved", user, req.user?.role, req.body?.note, req.user?.userId ?? req.user?.id ?? null);
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

    // CRM re-booking credit transfer: if this Inter-company transfer was
    // raised to move a cancelled booking's held credit to a new booking in
    // another company, now that it's Approved (real bank + LOAN-C squared),
    // drop the fresh on-account credit on the target booking. Non-fatal.
    if (transitionResult.newStatus === "Approved" || alreadyApproved) {
      try {
        const linked = await pool.request().input("ft", sql.Int, id)
          .query("SELECT Id FROM dbo.CrmRebookingTransfer WHERE FundTransferId = @ft AND Status = 'PendingTransfer'");
        if (linked.recordset.length) {
          const { applyRebookingTransferToBooking } = require("./crmRefunds");
          await applyRebookingTransferToBooking(pool, linked.recordset[0].Id, req.user?.email || req.user?.name || null);
          await bumpCacheVersion("crm-refunds");
        }
      } catch (rebookErr) {
        console.warn("[fund-transfer] CRM re-booking apply failed (non-fatal):", rebookErr.message);
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
router.put("/:id/reject", authenticateToken, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await transition("fund-transfer", id, "Rejected", user, req.user?.role, req.body?.note, req.user?.userId ?? req.user?.id ?? null);
    await bumpCacheVersion("fund-transfer");
    res.json({ message: "Fund Transfer rejected", ...result });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;

