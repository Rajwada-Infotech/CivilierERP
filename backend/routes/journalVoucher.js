const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authenticateToken = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");
const {
  resolveDocTypeId,
  lockNextDocNumber,
  backPatchRecordId,
} = require("../utils/docNumberLock");
const { transition, guardEdit } = require("../services/approvalService");
const { resolveAllowPostApproval } = require("../middleware/permissions");
const { postJournalVoucherApproval, hasPosting } = require("../services/generalLedger");

function requireUser(req, res) {
  const email = req.user?.email || req.user?.name;
  if (!email) {
    res.status(401).json({ error: "User context missing" });
    return null;
  }
  return email;
}

/** Validate a JV lines payload: at least 2 lines, each with a positive
 * debit XOR credit and a valid LHeadId, and total debit === total credit
 * (to the cent) — mirrors the balance check in generalLedger.js's
 * postVoucher(), enforced here too so a bad JV never reaches the DB. */
function validateLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    return "At least 2 lines are required for a Journal Voucher.";
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    if (!line.LHeadId) return "Every line requires an LHeadId.";
    const debit = Number(line.DebitAmount) || 0;
    const credit = Number(line.CreditAmount) || 0;
    if ((debit > 0 && credit > 0) || (debit <= 0 && credit <= 0)) {
      return "Every line must have either a positive DebitAmount or a positive CreditAmount, not both or neither.";
    }
    totalDebit += debit;
    totalCredit += credit;
  }
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return `Voucher does not balance: total debit ${totalDebit} !== total credit ${totalCredit}.`;
  }
  return null;
}

// ── GET / — list, with filters ──────────────────────────────────────────────
router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const { status, companyId, projectId, dateFrom, dateTo } = req.query;
    const request = pool.request();
    const conditions = [];

    // companyId is optional — the list page shows every company's vouchers
    // by default (no company filter in its UI); only scope when given.
    if (companyId) {
      conditions.push("jv.CompanyId = @companyId");
      request.input("companyId", sql.Int, parseInt(companyId, 10));
    }

    if (status) {
      conditions.push("jv.Status = @status");
      request.input("status", sql.NVarChar(20), status);
    }
    if (projectId) {
      conditions.push("jv.ProjectId = @projectId");
      request.input("projectId", sql.Int, parseInt(projectId, 10));
    }
    if (dateFrom) {
      conditions.push("jv.JVDate >= @dateFrom");
      request.input("dateFrom", sql.Date, dateFrom);
    }
    if (dateTo) {
      conditions.push("jv.JVDate <= @dateTo");
      request.input("dateTo", sql.Date, dateTo);
    }

    let query = `
      SELECT jv.JVID, jv.JVNo, jv.JVDate, jv.Narration, jv.CompanyId, jv.ProjectId,
             co.name AS CompanyName, pr.name AS ProjectName,
             jv.Status, jv.CreatedBy, jv.CreatedAt,
             (SELECT SUM(DebitAmount) FROM dbo.JournalVoucherLines WHERE JVID = jv.JVID) AS TotalAmount,
             CASE WHEN EXISTS (
               SELECT 1 FROM dbo.GeneralLedgerEntry gle
               WHERE gle.SourceType = 'JournalVoucher' AND gle.SourceId = jv.JVID AND gle.IsReversed = 0
             ) THEN 1 ELSE 0 END AS PostedToGL
      FROM dbo.JournalVoucher jv
      LEFT JOIN dbo.enterprise co ON co.id = jv.CompanyId
      LEFT JOIN dbo.enterprise pr ON pr.id = jv.ProjectId
    `;
    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY jv.JVDate DESC, jv.JVID DESC";

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /ledger-options — every approved account head, any type ─────────────
// A JV corrects account-head mismatches, which can involve Customer,
// Supplier, and Bank heads just as often as pure GL heads — unlike
// /api/general-ledger/options (used by Trial Balance etc.), which is
// intentionally GL-only. Must be registered before "/:id" below, or Express
// would treat "ledger-options" as an id.
router.get("/ledger-options", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT LHeadId AS id, ISNULL(DisplayName, LHeadName) AS label, LHeadCode AS code, LHeadType AS type
      FROM dbo.AccountHeadMaster
      WHERE Status = 'Approved' AND ISNULL(LHeadStatus, 1) = 1
      ORDER BY LHeadType, LHeadName
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id — header + lines ───────────────────────────────────────────────
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const header = await pool
      .request()
      .input("id", sql.Int, id).query(`
        SELECT jv.*, co.name AS CompanyName, pr.name AS ProjectName
        FROM dbo.JournalVoucher jv
        LEFT JOIN dbo.enterprise co ON co.id = jv.CompanyId
        LEFT JOIN dbo.enterprise pr ON pr.id = jv.ProjectId
        WHERE jv.JVID = @id
      `);
    if (!header.recordset.length) return res.status(404).json({ error: "Not found" });

    const lines = await pool
      .request()
      .input("id", sql.Int, id).query(`
        SELECT jvl.LineID, jvl.LHeadId, lh.LHeadName, jvl.DebitAmount, jvl.CreditAmount,
               jvl.Narration, jvl.SortOrder
        FROM dbo.JournalVoucherLines jvl
        LEFT JOIN dbo.AccountHeadMaster lh ON lh.LHeadId = jvl.LHeadId
        WHERE jvl.JVID = @id
        ORDER BY jvl.SortOrder, jvl.LineID
      `);

    const postedToGL = await hasPosting(pool, "JournalVoucher", id);
    res.json({ ...header.recordset[0], PostedToGL: postedToGL, lines: lines.recordset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — create (Draft, auto-submitted to Pending) ──────────────────────
router.post("/", authenticateToken, requirePageRight("journal-voucher", "create"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const { JVDate, Narration, CompanyId, ProjectId, lines = [], finYear } = req.body;

    if (!JVDate) return res.status(400).json({ error: "JVDate is required." });
    const linesError = validateLines(lines);
    if (linesError) return res.status(400).json({ error: linesError });

    const dtId = await resolveDocTypeId(pool, sql, "JV");
    const finalDocNo = await lockNextDocNumber(pool, sql, {
      docTypeId: dtId,
      finYear,
      tableName: "JournalVoucher",
      docNoColumn: "JVNo",
      issuedBy: user,
    });

    // Header + lines must be one atomic unit — matches the transaction
    // pattern established across materialRequests.js/quotations.js this
    // session: a mid-loop failure on the line inserts must not leave a
    // permanently-committed, unbalanced header.
    const tx = pool.transaction();
    await tx.begin();
    let newId;
    try {
      const insertHdr = await tx
        .request()
        .input("JVNo", sql.NVarChar(100), finalDocNo || null)
        .input("JVDate", sql.Date, JVDate)
        .input("Narration", sql.NVarChar(500), Narration || null)
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("DocTypeId", sql.Int, dtId || null)
        .input("CreatedBy", sql.NVarChar(150), user).query(`
          INSERT INTO dbo.JournalVoucher
            (JVNo, JVDate, Narration, CompanyId, ProjectId, Status, DocTypeId, CreatedBy)
          OUTPUT INSERTED.JVID
          VALUES (@JVNo, @JVDate, @Narration, @CompanyId, @ProjectId, 'Draft', @DocTypeId, @CreatedBy)
        `);

      newId = insertHdr.recordset[0].JVID;

      let sortOrder = 0;
      for (const line of lines) {
        await tx
          .request()
          .input("JVID", sql.Int, newId)
          .input("LHeadId", sql.Int, parseInt(line.LHeadId, 10))
          .input("DebitAmount", sql.Decimal(18, 2), Number(line.DebitAmount) || 0)
          .input("CreditAmount", sql.Decimal(18, 2), Number(line.CreditAmount) || 0)
          .input("Narration", sql.NVarChar(255), line.Narration || null)
          .input("SortOrder", sql.Int, sortOrder++).query(`
            INSERT INTO dbo.JournalVoucherLines
              (JVID, LHeadId, DebitAmount, CreditAmount, Narration, SortOrder)
            VALUES (@JVID, @LHeadId, @DebitAmount, @CreditAmount, @Narration, @SortOrder)
          `);
      }

      await tx.commit();
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch {
        /* best-effort — original error is what propagates */
      }
      throw txErr;
    }

    if (finalDocNo) {
      await backPatchRecordId(pool, sql, finalDocNo, "JournalVoucher", newId);
    }
    await bumpCacheVersion("journal-voucher");

    // Auto-submit: transition Draft -> Pending immediately, matching
    // grns.js/materialRequests.js's convention — no manual "Submit" step
    // required after creation.
    try {
      await transition("journal-voucher", newId, "Pending", req.user?.email, req.user?.role);
    } catch (submitErr) {
      console.warn("JV auto-submit failed (non-fatal):", submitErr.message);
    }

    res.status(201).json({ JVID: newId, JVNo: finalDocNo, message: "Journal Voucher created" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id — edit (Draft only) ────────────────────────────────────────────
router.put("/:id", authenticateToken, requirePageRight("journal-voucher", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    try {
      const allowPostApproval = await resolveAllowPostApproval(req, "journal-voucher");
      await guardEdit("journal-voucher", id, { allowPostApproval });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const { JVDate, Narration, CompanyId, ProjectId, lines = [] } = req.body;
    if (!JVDate) return res.status(400).json({ error: "JVDate is required." });
    const linesError = validateLines(lines);
    if (linesError) return res.status(400).json({ error: linesError });

    const tx = pool.transaction();
    await tx.begin();
    try {
      const updateResult = await tx
        .request()
        .input("id", sql.Int, id)
        .input("JVDate", sql.Date, JVDate)
        .input("Narration", sql.NVarChar(500), Narration || null)
        .input("CompanyId", sql.Int, CompanyId || null)
        .input("ProjectId", sql.Int, ProjectId || null)
        .input("UpdatedBy", sql.NVarChar(150), user).query(`
          UPDATE dbo.JournalVoucher
          SET JVDate=@JVDate, Narration=@Narration, CompanyId=@CompanyId,
              ProjectId=@ProjectId, UpdatedBy=@UpdatedBy, UpdatedAt=SYSDATETIME()
          WHERE JVID=@id AND Status='Draft'
        `);

      if (updateResult.rowsAffected[0] === 0) {
        await tx.rollback();
        return res.status(409).json({
          error: "Update failed: the voucher status changed before the update could be applied.",
        });
      }

      await tx.request().input("id", sql.Int, id).query(
        "DELETE FROM dbo.JournalVoucherLines WHERE JVID=@id",
      );

      let sortOrder = 0;
      for (const line of lines) {
        await tx
          .request()
          .input("JVID", sql.Int, id)
          .input("LHeadId", sql.Int, parseInt(line.LHeadId, 10))
          .input("DebitAmount", sql.Decimal(18, 2), Number(line.DebitAmount) || 0)
          .input("CreditAmount", sql.Decimal(18, 2), Number(line.CreditAmount) || 0)
          .input("Narration", sql.NVarChar(255), line.Narration || null)
          .input("SortOrder", sql.Int, sortOrder++).query(`
            INSERT INTO dbo.JournalVoucherLines
              (JVID, LHeadId, DebitAmount, CreditAmount, Narration, SortOrder)
            VALUES (@JVID, @LHeadId, @DebitAmount, @CreditAmount, @Narration, @SortOrder)
          `);
      }

      await tx.commit();
    } catch (txErr) {
      try {
        await tx.rollback();
      } catch {
        /* best-effort — original error is what propagates */
      }
      throw txErr;
    }

    await bumpCacheVersion("journal-voucher");
    res.json({ message: "Journal Voucher updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/approve — Pending → Approved (super_admin only) ────────────────
router.put("/:id/approve", authenticateToken, requirePageRight("journal-voucher", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const current = await pool
      .request()
      .input("id", sql.Int, id)
      .query("SELECT Status FROM dbo.JournalVoucher WHERE JVID = @id");
    if (!current.recordset.length) return res.status(404).json({ error: "Not found" });

    // If already Approved (a prior posting attempt failed after the status
    // transition succeeded), skip transition() -- it would reject re-entering
    // Approved -- and just retry the post. postJournalVoucherApproval() is
    // idempotent via hasPosting(), so retrying is safe.
    const alreadyApproved = current.recordset[0].Status === "Approved";

    let transitionResult = {};
    if (!alreadyApproved) {
      transitionResult = await transition(
        "journal-voucher", id, "Approved", user, req.user?.role, req.body?.note,
      );
    }

    if (alreadyApproved) {
      try {
        await postJournalVoucherApproval(pool, id, user);
      } catch (postErr) {
        return res.status(500).json({
          error: `Voucher approved, but GL posting failed: ${postErr.message}. Re-submit approval to retry posting.`,
        });
      }
    }

    await bumpCacheVersion("journal-voucher");
    await bumpCacheVersion("general-ledger");
    res.json({ message: "Journal Voucher approved and posted to GL", ...transitionResult });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// ── PUT /:id/reject — Pending → Rejected (super_admin only) ─────────────────
router.put("/:id/reject", authenticateToken, requirePageRight("journal-voucher", "edit"), async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const result = await transition("journal-voucher", id, "Rejected", user, req.user?.role, req.body?.note);
    await bumpCacheVersion("journal-voucher");
    res.json({ message: "Journal Voucher rejected", ...result });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

module.exports = router;
