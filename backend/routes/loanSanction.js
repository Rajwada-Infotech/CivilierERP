const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");

router.use(authMiddleware);

const LOAN_TYPES = ["Inter-Company", "Bank Loan", "Customer Loan"];
const INTEREST_TYPES = ["SI", "CI"];
// Every loan type is repaid through the same flexible flow (multi-EMI
// select, lump sum, early payoff), driven exclusively from the Payment
// page's "Loan EMIs" tab — the Loan Sanction page itself is read-only.

// Get-or-create the system-generated ledger head that represents a company
// or customer as a Loan counterparty — mirrors ensureProjectLedgerHeads in
// routes/projectMaster.js. Keyed by a stable LHeadCode so re-sanctioning a
// loan for the same counterparty reuses the same GL account instead of
// spawning duplicates. `keyPrefix` keeps company- and customer-sourced
// ledger heads in separate code namespaces (a company and a customer could
// otherwise collide on the same numeric id).
async function ensureLoanLedgerHead(pool, keyPrefix, counterpartyId, counterpartyName, createdBy) {
  const code = `LOAN-${keyPrefix}-${counterpartyId}`;
  const existing = await pool
    .request()
    .input("code", sql.NVarChar(20), code)
    .query("SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode = @code");
  if (existing.recordset.length) return existing.recordset[0].LHeadId;

  const group = await pool
    .request()
    .query("SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LOANS AND ADVANCES' AND ParentGroupId IS NULL");
  const groupId = group.recordset[0]?.AGId ?? null;

  const inserted = await pool
    .request()
    .input("LHeadName", sql.NVarChar(200), `Loan - ${counterpartyName}`)
    .input("LHeadCode", sql.NVarChar(20), code)
    .input("LHeadAddress", sql.VarChar(300), "N/A")
    .input("LHeadContactPerson", sql.VarChar(100), "N/A")
    .input("LHeadType", sql.VarChar(50), "LN")
    .input("LHeadStatus", sql.Bit, 1)
    .input("LBelongsTo", sql.Int, groupId)
    .input("Status", sql.NVarChar(20), "Approved")
    .input("ApprovedBy", sql.NVarChar(100), createdBy)
    .input("CreatedBy", sql.NVarChar(100), createdBy).query(`
      INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadCode, LHeadAddress, LHeadContactPerson, LHeadType, LHeadStatus, LBelongsTo, Status, ApprovedBy, ApprovedAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.LHeadId
      VALUES
        (@LHeadName, @LHeadCode, @LHeadAddress, @LHeadContactPerson, @LHeadType, @LHeadStatus, @LBelongsTo, @Status, @ApprovedBy, SYSDATETIME(), @CreatedBy, SYSDATETIME())
    `);
  await bumpCacheVersion("account-head-master");
  return inserted.recordset[0].LHeadId;
}

// Builds the EMI schedule. Three modes:
//   - No interest (hasInterest=false or rate<=0): flat principal-only split.
//   - Simple Interest (SI): interest = P x r x (months/12), split evenly
//     across every installment; principal is also split evenly. Each EMI
//     is the same amount (classic SI loan behaviour).
//   - Compound Interest (CI): standard reducing-balance amortization —
//     interest shrinks each period as principal is paid down.
// Always generates at least 1 installment (a tenure-less loan is treated as
// a single bullet payment).
// explicitDueDate: only applied to the single installment of a no-tenure
// (n=1) loan — e.g. an Inter-Company simple transfer with no EMI
// breakdown — letting the user set the whole-loan repayment due date
// directly instead of it defaulting to loanDate + 1 month.
function buildEmiSchedule(amount, annualRatePct, tenureMonths, startDate, interestType = "CI", explicitDueDate = null) {
  const n = Math.max(1, parseInt(tenureMonths, 10) || 1);
  const start = new Date(startDate);
  const rows = [];

  if (!annualRatePct || annualRatePct <= 0) {
    const flat = Math.round((amount / n) * 100) / 100;
    let allocated = 0;
    for (let i = 1; i <= n; i++) {
      const principal = i === n ? Math.round((amount - allocated) * 100) / 100 : flat;
      allocated += principal;
      let due;
      if (n === 1 && explicitDueDate) {
        due = new Date(explicitDueDate);
      } else {
        due = new Date(start);
        due.setMonth(due.getMonth() + i);
      }
      rows.push({ installmentNo: i, dueDate: due, emiAmount: principal, principal, interest: 0 });
    }
    return rows;
  }

  if (interestType === "SI") {
    const totalInterest = Math.round(amount * (annualRatePct / 100) * (n / 12) * 100) / 100;
    const flatPrincipal = Math.round((amount / n) * 100) / 100;
    const flatInterest = Math.round((totalInterest / n) * 100) / 100;
    let allocatedPrincipal = 0;
    let allocatedInterest = 0;
    for (let i = 1; i <= n; i++) {
      const principal = i === n ? Math.round((amount - allocatedPrincipal) * 100) / 100 : flatPrincipal;
      const interest = i === n ? Math.round((totalInterest - allocatedInterest) * 100) / 100 : flatInterest;
      allocatedPrincipal += principal;
      allocatedInterest += interest;
      const due = new Date(start);
      due.setMonth(due.getMonth() + i);
      rows.push({
        installmentNo: i,
        dueDate: due,
        emiAmount: Math.round((principal + interest) * 100) / 100,
        principal,
        interest,
      });
    }
    return rows;
  }

  // Compound Interest — reducing-balance amortization.
  const r = annualRatePct / 12 / 100;
  const emi = (amount * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  let balance = amount;
  let allocatedPrincipal = 0;
  for (let i = 1; i <= n; i++) {
    const interest = Math.round(balance * r * 100) / 100;
    let principal = Math.round((emi - interest) * 100) / 100;
    if (i === n) principal = Math.round((amount - allocatedPrincipal) * 100) / 100;
    allocatedPrincipal += principal;
    balance = Math.round((balance - principal) * 100) / 100;
    const due = new Date(start);
    due.setMonth(due.getMonth() + i);
    rows.push({
      installmentNo: i,
      dueDate: due,
      emiAmount: Math.round((principal + interest) * 100) / 100,
      principal,
      interest,
    });
  }
  return rows;
}

async function insertEmiSchedule(tx, loanId, schedule) {
  for (const row of schedule) {
    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .input("InstallmentNo", sql.Int, row.installmentNo)
      .input("DueDate", sql.Date, row.dueDate)
      .input("EMIAmount", sql.Decimal(18, 2), row.emiAmount)
      .input("Principal", sql.Decimal(18, 2), row.principal)
      .input("Interest", sql.Decimal(18, 2), row.interest).query(`
        INSERT INTO dbo.LoanEMISchedule
          (LoanId, InstallmentNo, DueDate, EMIAmount, PrincipalComponent, InterestComponent)
        VALUES
          (@LoanId, @InstallmentNo, @DueDate, @EMIAmount, @Principal, @Interest)
      `);
  }
}

// ── GET /customer-options — combined Customer Master + CRM customer list ──
// "Loan to Customer" can target either the formal ledger-backed Customer
// Master (dbo.AccountHeadMaster, LHeadType='A') or a real-estate buyer in
// dbo.CrmCustomer — two independent id sequences, so each option carries a
// `source` tag ('AH' | 'CRM') the frontend must send back alongside the id.
router.get("/customer-options", requirePageRight("loan-sanction", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const [ahRes, crmRes] = await Promise.all([
      pool.request().query(`
        SELECT LHeadId AS id, LHeadName AS label
        FROM dbo.AccountHeadMaster
        WHERE LHeadType = 'A' AND LHeadStatus = 1
        ORDER BY LHeadName
      `),
      pool.request().query(`
        SELECT Id AS id, CustomerName AS label
        FROM dbo.CrmCustomer
        WHERE IsActive = 1
        ORDER BY CustomerName
      `),
    ]);
    // Deduplicate: CRM is the primary source. If the same name exists in both
    // AH and CRM, drop the AH entry so the person doesn't appear twice.
    const crmNames = new Set(
      crmRes.recordset.map((r) => r.label.trim().toUpperCase()),
    );
    const ahFiltered = ahRes.recordset.filter(
      (r) => !crmNames.has(r.label.trim().toUpperCase()),
    );
    const options = [
      ...ahFiltered.map((r) => ({ id: r.id, label: r.label, source: "AH", sourceLabel: "Customer Master" })),
      ...crmRes.recordset.map((r) => ({ id: r.id, label: r.label, source: "CRM", sourceLabel: "CRM Customer" })),
    ].sort((a, b) => a.label.localeCompare(b.label));
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list ──────────────────────────────────────────────────────────
router.get("/", requirePageRight("loan-sanction", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const nocSearch = typeof req.query.noc === "string" && req.query.noc.trim() ? req.query.noc.trim() : null;
    const request = pool.request();
    if (nocSearch) request.input("NocSearch", sql.NVarChar(255), `%${nocSearch}%`);
    const result = await request.query(`
      SELECT
        ls.LoanId, ls.LoanNo, ls.LoanType, ls.LoanDocNo,
        ls.InterestType, ls.HasInterest,
        ls.LenderCompanyId, lc.name AS LenderCompanyName,
        ls.LenderBankId, lb.LHeadName AS LenderBankName,
        ls.LenderBankAccountId, lba.LHeadName AS LenderBankAccountName,
        ls.BorrowerCompanyId, bc.name AS BorrowerCompanyName,
        ls.BorrowerCustomerId, ls.BorrowerCustomerSource,
        COALESCE(cust_ah.LHeadName, cust_crm.CustomerName) AS BorrowerCustomerName,
        ls.BorrowerBankAccountId, bba.LHeadName AS BorrowerBankAccountName,
        ls.LoanDate, ls.Amount, ls.InterestRate, ls.TenureMonths,
        ls.Purpose, ls.Status, ls.Remarks,
        ls.LenderLHeadId, ls.BorrowerLHeadId,
        ls.CreatedBy, ls.CreatedAt, ls.UpdatedBy, ls.UpdatedAt,
        ls.ClosedAt, ls.NOCAttachmentId, noc.FileName AS NOCFileName,
        (SELECT COUNT(*) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId) AS TotalEMIs,
        (SELECT COUNT(*) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId AND e.IsPaid = 1) AS PaidEMIs
      FROM dbo.LoanSanction ls
      LEFT JOIN dbo.enterprise lc ON lc.id = ls.LenderCompanyId AND lc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster lb ON lb.LHeadId = ls.LenderBankId
      LEFT JOIN dbo.AccountHeadMaster lba ON lba.LHeadId = ls.LenderBankAccountId
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster cust_ah ON cust_ah.LHeadId = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer cust_crm ON cust_crm.Id = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'CRM'
      LEFT JOIN dbo.AccountHeadMaster bba ON bba.LHeadId = ls.BorrowerBankAccountId
      LEFT JOIN dbo.LoanNOCAttachments noc ON noc.AttachmentId = ls.NOCAttachmentId
      ${nocSearch ? "WHERE noc.FileName LIKE @NocSearch" : ""}
      ORDER BY ls.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /emi-reminders — unpaid EMIs due within 7 days (or overdue) ───────
// Registered before "/:id" so it isn't swallowed by the param route.
router.get("/emi-reminders", async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        e.EMIId, e.LoanId, e.InstallmentNo, e.DueDate, e.EMIAmount,
        ls.LoanNo,
        COALESCE(bc.name, cust_ah.LHeadName, cust_crm.CustomerName) AS BorrowerName
      FROM dbo.LoanEMISchedule e
      JOIN dbo.LoanSanction ls ON ls.LoanId = e.LoanId
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster cust_ah ON cust_ah.LHeadId = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer cust_crm ON cust_crm.Id = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'CRM'
      WHERE e.IsPaid = 0 AND e.DueDate <= DATEADD(day, 7, CAST(GETDATE() AS DATE))
      ORDER BY e.DueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /emi-payable — all unpaid EMIs across every loan type ─────────────
// Feeds the Payment page's "Loan EMIs" picker (multi-select or lump sum).
// Registered before "/:id" so it isn't swallowed by the param route.
router.get("/emi-payable", requirePageRight("loan-sanction", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        e.EMIId, e.LoanId, e.InstallmentNo, e.DueDate, e.EMIAmount,
        e.PrincipalComponent, e.InterestComponent,
        ls.LoanNo, ls.LoanType,
        COALESCE(bc.name, cust_ah.LHeadName, cust_crm.CustomerName) AS BorrowerName,
        CASE WHEN e.DueDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS IsOverdue
      FROM dbo.LoanEMISchedule e
      JOIN dbo.LoanSanction ls ON ls.LoanId = e.LoanId
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster cust_ah ON cust_ah.LHeadId = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer cust_crm ON cust_crm.Id = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'CRM'
      WHERE e.IsPaid = 0 AND ls.Status <> 'Closed'
      ORDER BY e.DueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /company-exposure/:companyId — live lender/borrower summary ───────
// Powers the Exposure tab: while sanctioning a loan, picking a Lender
// Company shows what they've already lent out + any EMI currently due to
// them; picking a Borrower Company shows what that company already owes.
// Registered before "/:id" so it isn't swallowed by the param route.
router.get("/company-exposure/:companyId", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const companyId = parseInt(req.params.companyId, 10);
  if (!Number.isFinite(companyId)) return res.status(400).json({ error: "Invalid company id" });
  try {
    const pool = getPool();

    // Per-loan "paid so far" is computed in a derived table first — SQL
    // Server rejects an aggregate (outer SUM) wrapping an expression that
    // itself contains a correlated-subquery aggregate, so the paid total
    // has to be resolved to a plain scalar column before the outer SUM.
    const asLender = await pool.request().input("id", sql.Int, companyId).query(`
      SELECT
        COUNT(*) AS loanCount,
        ISNULL(SUM(x.Amount), 0) AS totalLent,
        ISNULL(SUM(CASE WHEN x.Status <> 'Closed' THEN x.Amount - x.PaidSoFar ELSE 0 END), 0) AS totalOutstanding
      FROM (
        SELECT ls.LoanId, ls.Amount, ls.Status,
          ISNULL((SELECT SUM(e.EMIAmount) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId AND e.IsPaid = 1), 0) AS PaidSoFar
        FROM dbo.LoanSanction ls
        WHERE ls.LenderCompanyId = @id
      ) x
    `);

    const asBorrower = await pool.request().input("id", sql.Int, companyId).query(`
      SELECT
        COUNT(*) AS loanCount,
        ISNULL(SUM(x.Amount), 0) AS totalBorrowed,
        ISNULL(SUM(CASE WHEN x.Status <> 'Closed' THEN x.Amount - x.PaidSoFar ELSE 0 END), 0) AS totalOutstanding
      FROM (
        SELECT ls.LoanId, ls.Amount, ls.Status,
          ISNULL((SELECT SUM(e.EMIAmount) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId AND e.IsPaid = 1), 0) AS PaidSoFar
        FROM dbo.LoanSanction ls
        WHERE ls.BorrowerCompanyId = @id
      ) x
    `);

    const nextDueAsBorrower = await pool.request().input("id", sql.Int, companyId).query(`
      SELECT TOP 1 e.DueDate, e.EMIAmount, ls.LoanNo
      FROM dbo.LoanEMISchedule e
      JOIN dbo.LoanSanction ls ON ls.LoanId = e.LoanId
      WHERE ls.BorrowerCompanyId = @id AND e.IsPaid = 0
      ORDER BY e.DueDate ASC
    `);

    const nextDueAsLender = await pool.request().input("id", sql.Int, companyId).query(`
      SELECT TOP 1 e.DueDate, e.EMIAmount, ls.LoanNo
      FROM dbo.LoanEMISchedule e
      JOIN dbo.LoanSanction ls ON ls.LoanId = e.LoanId
      WHERE ls.LenderCompanyId = @id AND e.IsPaid = 0
      ORDER BY e.DueDate ASC
    `);

    res.json({
      asLender: {
        loanCount: asLender.recordset[0].loanCount,
        totalLent: asLender.recordset[0].totalLent,
        totalOutstanding: asLender.recordset[0].totalOutstanding,
        nextDue: nextDueAsLender.recordset[0] ?? null,
      },
      asBorrower: {
        loanCount: asBorrower.recordset[0].loanCount,
        totalBorrowed: asBorrower.recordset[0].totalBorrowed,
        totalOutstanding: asBorrower.recordset[0].totalOutstanding,
        nextDue: nextDueAsBorrower.recordset[0] ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────
router.get("/:id", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT
        ls.*,
        lc.name AS LenderCompanyName,
        lb.LHeadName AS LenderBankName,
        lba.LHeadName AS LenderBankAccountName,
        bc.name AS BorrowerCompanyName,
        COALESCE(cust_ah.LHeadName, cust_crm.CustomerName) AS BorrowerCustomerName,
        bba.LHeadName AS BorrowerBankAccountName,
        lender_gl.LHeadCode AS LenderLHeadCode,
        lender_grp.Name AS LenderGroupName,
        lender_parent.Name AS LenderParentGroupName,
        borrower_gl.LHeadCode AS BorrowerLHeadCode,
        borrower_grp.Name AS BorrowerGroupName,
        borrower_parent.Name AS BorrowerParentGroupName
      FROM dbo.LoanSanction ls
      LEFT JOIN dbo.enterprise lc ON lc.id = ls.LenderCompanyId AND lc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster lb ON lb.LHeadId = ls.LenderBankId
      LEFT JOIN dbo.AccountHeadMaster lba ON lba.LHeadId = ls.LenderBankAccountId
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster cust_ah ON cust_ah.LHeadId = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer cust_crm ON cust_crm.Id = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'CRM'
      LEFT JOIN dbo.AccountHeadMaster bba ON bba.LHeadId = ls.BorrowerBankAccountId
      LEFT JOIN dbo.AccountHeadMaster lender_gl ON lender_gl.LHeadId = ls.LenderLHeadId
      LEFT JOIN dbo.AccountGroup lender_grp ON lender_grp.AGId = lender_gl.LBelongsTo
      LEFT JOIN dbo.AccountGroup lender_parent ON lender_parent.AGId = lender_grp.ParentGroupId
      LEFT JOIN dbo.AccountHeadMaster borrower_gl ON borrower_gl.LHeadId = ls.BorrowerLHeadId
      LEFT JOIN dbo.AccountGroup borrower_grp ON borrower_grp.AGId = borrower_gl.LBelongsTo
      LEFT JOIN dbo.AccountGroup borrower_parent ON borrower_parent.AGId = borrower_grp.ParentGroupId
      WHERE ls.LoanId = @id
    `);
    if (!result.recordset.length) return res.status(404).json({ error: "Loan not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/schedule — EMI installments for the chain/schedule views ─────
router.get("/:id/schedule", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT EMIId, LoanId, InstallmentNo, DueDate, EMIAmount, PrincipalComponent, InterestComponent,
             IsPaid, PaidDate, PaidBy, PaymentId, CreatedAt
      FROM dbo.LoanEMISchedule
      WHERE LoanId = @id
      ORDER BY InstallmentNo ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/payments — the chain of actual payment transactions ─────────
// Each row is one payment ACTION (which may have covered several EMIs, or
// been a lump sum) — distinct from /schedule, which is the installment
// PLAN. This is what the Repayment History tab renders as its chain.
router.get("/:id/payments", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("id", sql.Int, id).query(`
      SELECT
        p.PaymentId, p.LoanId, p.PaymentRef, p.PaymentDate, p.PaymentType,
        p.PrincipalInterestAmount, p.LateFee, p.TotalAmount, p.ExcessCredited,
        p.ClosedLoan, p.Notes, p.CreatedBy, p.CreatedAt,
        (SELECT COUNT(*) FROM dbo.LoanEMISchedule e WHERE e.PaymentId = p.PaymentId) AS EmisCovered
      FROM dbo.LoanPayment p
      WHERE p.LoanId = @id
      ORDER BY p.PaymentDate ASC, p.PaymentId ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST / — sanction a new loan ─────────────────────────────────────────
// Single-step: creating the record IS sanctioning it (no separate draft
// stage exists in this cut). On success:
//   1. Both counterparties get (or reuse) a system-generated "Loan - <Name>"
//      ledger head under dbo.AccountHeadMaster.
//   2. The borrower's ledger head receives a CREDIT in dbo.OnAccountLedger
//      for the sanctioned amount — this is what makes it show up as an
//      available "Loan" balance on the On A/C Adjustment page (see the
//      RefType='Loan' branch added to routes/onAccount.js's /adjustable).
//   3. An EMI schedule is generated (reducing-balance if InterestRate is
//      set, else a flat principal split) so the Chain/EMI Schedule tabs
//      have installments to check off.
router.post("/", requirePageRight("loan-sanction", "create"), async (req, res) => {
  const {
    loanType,
    loanDocNo,
    lenderCompanyId,
    lenderBankId,
    lenderBankAccountId,
    borrowerCompanyId,
    borrowerCustomerId,
    borrowerCustomerSource,
    borrowerBankAccountId,
    loanDate,
    amount,
    hasInterest,
    interestType,
    interestRate,
    tenureMonths,
    dueDate,
    purpose,
    remarks,
  } = req.body;
  const createdBy = req.user?.email || req.user?.name || "system";

  if (!loanType || !LOAN_TYPES.includes(loanType)) {
    return res.status(400).json({ error: "loanType must be Inter-Company, Bank Loan, or Customer Loan" });
  }
  const isCustomerLoan = loanType === "Customer Loan";
  const isBankLoan = loanType === "Bank Loan";
  const custSource = borrowerCustomerSource === "CRM" ? "CRM" : "AH";
  const useInterest = hasInterest !== false && hasInterest !== "false";
  const iType = INTEREST_TYPES.includes(interestType) ? interestType : "CI";

  if (isBankLoan && !lenderBankId) return res.status(400).json({ error: "Lender bank is required" });
  if (!isBankLoan && !lenderCompanyId) return res.status(400).json({ error: "Lender company is required" });
  if (isCustomerLoan && !borrowerCustomerId) {
    return res.status(400).json({ error: "Borrower customer is required" });
  }
  if (!isCustomerLoan && !borrowerCompanyId) {
    return res.status(400).json({ error: "Borrower company is required" });
  }
  if (!loanDate) return res.status(400).json({ error: "Loan date is required" });
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: "Amount must be greater than 0" });

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    let lenderCompany = null;
    let lenderBank = null;
    if (isBankLoan) {
      const bankRes = await new sql.Request(tx)
        .input("bankId", sql.Int, parseInt(lenderBankId, 10))
        .query("SELECT LHeadId AS id, LHeadName AS name FROM dbo.AccountHeadMaster WHERE LHeadId = @bankId AND LHeadType = 'B'");
      lenderBank = bankRes.recordset[0];
      if (!lenderBank) throw Object.assign(new Error("Lender bank not found"), { status: 400 });
    } else {
      const lenderRes = await new sql.Request(tx)
        .input("lenderId", sql.Int, parseInt(lenderCompanyId, 10))
        .query("SELECT id, name FROM dbo.enterprise WHERE business_type = 'C' AND id = @lenderId");
      lenderCompany = lenderRes.recordset[0];
      if (!lenderCompany) throw Object.assign(new Error("Lender company not found"), { status: 400 });
    }

    let borrowerCompany = null;
    let borrowerCustomer = null;
    if (isCustomerLoan) {
      if (custSource === "CRM") {
        const custRes = await new sql.Request(tx)
          .input("custId", sql.Int, parseInt(borrowerCustomerId, 10))
          .query("SELECT Id AS custId, CustomerName AS custName FROM dbo.CrmCustomer WHERE Id = @custId");
        borrowerCustomer = custRes.recordset[0];
      } else {
        const custRes = await new sql.Request(tx)
          .input("custId", sql.Int, parseInt(borrowerCustomerId, 10))
          .query("SELECT LHeadId AS custId, LHeadName AS custName FROM dbo.AccountHeadMaster WHERE LHeadId = @custId");
        borrowerCustomer = custRes.recordset[0];
      }
      if (!borrowerCustomer) throw Object.assign(new Error("Borrower customer not found"), { status: 400 });
    } else {
      const borrRes = await new sql.Request(tx)
        .input("borrowerId", sql.Int, parseInt(borrowerCompanyId, 10))
        .query("SELECT id, name FROM dbo.enterprise WHERE business_type = 'C' AND id = @borrowerId");
      borrowerCompany = borrRes.recordset[0];
      if (!borrowerCompany) throw Object.assign(new Error("Borrower company not found"), { status: 400 });
    }

    const effectiveRate = useInterest && interestRate != null && interestRate !== "" ? parseFloat(interestRate) : null;

    const insertResult = await new sql.Request(tx)
      .input("LoanNo", sql.NVarChar(50), "PENDING")
      .input("LoanType", sql.NVarChar(20), loanType)
      .input("LoanDocNo", sql.NVarChar(100), loanDocNo || null)
      .input("LenderCompanyId", sql.Int, lenderCompany ? lenderCompany.id : null)
      .input("LenderBankId", sql.Int, lenderBank ? lenderBank.id : null)
      .input("LenderBankAccountId", sql.Int, lenderBankAccountId ? parseInt(lenderBankAccountId, 10) : null)
      .input("BorrowerCompanyId", sql.Int, borrowerCompany ? borrowerCompany.id : null)
      .input("BorrowerCustomerId", sql.Int, borrowerCustomer ? borrowerCustomer.custId : null)
      .input("BorrowerCustomerSource", sql.NVarChar(10), isCustomerLoan ? custSource : null)
      .input("BorrowerBankAccountId", sql.Int, borrowerBankAccountId ? parseInt(borrowerBankAccountId, 10) : null)
      .input("LoanDate", sql.Date, loanDate)
      .input("Amount", sql.Decimal(18, 2), amt)
      .input("HasInterest", sql.Bit, useInterest ? 1 : 0)
      .input("InterestType", sql.NVarChar(10), iType)
      .input("InterestRate", sql.Decimal(5, 2), effectiveRate)
      .input("TenureMonths", sql.Int, tenureMonths != null && tenureMonths !== "" ? parseInt(tenureMonths, 10) : null)
      .input("Purpose", sql.NVarChar(500), purpose || null)
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
        INSERT INTO dbo.LoanSanction
          (LoanNo, LoanType, LoanDocNo, LenderCompanyId, LenderBankId, LenderBankAccountId, BorrowerCompanyId, BorrowerCustomerId,
           BorrowerCustomerSource, BorrowerBankAccountId, LoanDate, Amount, HasInterest, InterestType, InterestRate, TenureMonths,
           Purpose, Status, Remarks, CreatedBy, CreatedAt)
        OUTPUT INSERTED.LoanId
        VALUES
          (@LoanNo, @LoanType, @LoanDocNo, @LenderCompanyId, @LenderBankId, @LenderBankAccountId, @BorrowerCompanyId, @BorrowerCustomerId,
           @BorrowerCustomerSource, @BorrowerBankAccountId, @LoanDate, @Amount, @HasInterest, @InterestType, @InterestRate, @TenureMonths,
           @Purpose, 'Sanctioned', @Remarks, @CreatedBy, SYSDATETIME())
      `);
    const loanId = insertResult.recordset[0].LoanId;
    const loanNo = `LN-${String(loanId).padStart(6, "0")}`;

    const borrowerName = borrowerCompany ? borrowerCompany.name : borrowerCustomer.custName;
    const borrowerKeyPrefix = borrowerCompany ? "C" : custSource === "CRM" ? "CRMCUST" : "CUST";
    const borrowerKeyId = borrowerCompany ? borrowerCompany.id : borrowerCustomer.custId;

    // Bank Loan: the bank already has its own real ledger head — reuse it
    // directly as the lender GL account instead of spawning a "Loan - Bank"
    // shadow account for something that already has a proper one.
    const lenderLHeadId = isBankLoan
      ? lenderBank.id
      : await ensureLoanLedgerHead(pool, "C", lenderCompany.id, lenderCompany.name, createdBy);
    const borrowerLHeadId = await ensureLoanLedgerHead(pool, borrowerKeyPrefix, borrowerKeyId, borrowerName, createdBy);

    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .input("LoanNo", sql.NVarChar(50), loanNo)
      .input("LenderLHeadId", sql.Int, lenderLHeadId)
      .input("BorrowerLHeadId", sql.Int, borrowerLHeadId).query(`
        UPDATE dbo.LoanSanction
        SET LoanNo = @LoanNo, LenderLHeadId = @LenderLHeadId, BorrowerLHeadId = @BorrowerLHeadId
        WHERE LoanId = @LoanId
      `);

    // Borrower receives the loan as an available "on account" balance —
    // same CREDIT/DEBIT ledger the vendor on-account flow uses.
    const lenderName = isBankLoan ? lenderBank.name : lenderCompany.name;
    await new sql.Request(tx)
      .input("PartyId", sql.Int, borrowerLHeadId)
      .input("PartyType", sql.NVarChar(20), "Loan")
      .input("TxnDate", sql.Date, loanDate)
      .input("TxnType", sql.NVarChar(10), "CREDIT")
      .input("Amount", sql.Decimal(18, 2), amt)
      .input("RefType", sql.NVarChar(30), "Loan")
      .input("RefDocNo", sql.NVarChar(100), loanNo)
      .input("RefId", sql.Int, loanId)
      .input("CompanyId", sql.Int, borrowerCompany ? borrowerCompany.id : null)
      .input("Notes", sql.NVarChar(500), `${loanType} loan sanctioned from ${lenderName}`)
      .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, RefId, CompanyId, Notes, CreatedBy)
        VALUES
          (@PartyId, @PartyType, @TxnDate, @TxnType, @Amount, @RefType, @RefDocNo, @RefId, @CompanyId, @Notes, @CreatedBy);
        UPDATE dbo.AccountHeadMaster
          SET OnAccountBalance = ISNULL(OnAccountBalance, 0) + @Amount
          WHERE LHeadId = @PartyId;
      `);

    const schedule = buildEmiSchedule(amt, effectiveRate || 0, tenureMonths, loanDate, iType, dueDate || null);
    await insertEmiSchedule(tx, loanId, schedule);

    await tx.commit();
    await Promise.all([
      bumpCacheVersion("loan-sanction"),
      bumpCacheVersion("on-account"),
    ]);
    res.status(201).json({ loanId, loanNo });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PUT /:id — edit an already-sanctioned loan ─────────────────────────────
// Everything is editable EXCEPT the parties' identity (LoanType,
// LenderCompanyId/LenderBankId, BorrowerCompanyId/BorrowerCustomerId) —
// those define WHO the loan is between and can't change after the fact.
// Financial-core fields (amount, interest, tenure, loan date, due date) DO
// re-run the amortization schedule and adjust the borrower's On A/C
// balance, which is only safe while nothing has actually been repaid yet —
// blocked with a 409 once any EMI/LoanPayment exists. Administrative
// fields (doc no, purpose, remarks, bank A/C tags) can always be edited.
router.put("/:id", requirePageRight("loan-sanction", "edit"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });
  const {
    loanDocNo, purpose, remarks, lenderBankAccountId, borrowerBankAccountId,
    loanDate, amount, hasInterest, interestType, interestRate, tenureMonths, dueDate,
  } = req.body;
  const updatedBy = req.user?.email || req.user?.name || "system";

  // Financial-core edit only kicks in if the caller actually sent one of
  // these — the administrative-only edit path (Loan Doc No/Purpose/
  // Remarks/bank tags) must keep working even after repayment has started.
  const touchesFinancials =
    loanDate !== undefined || amount !== undefined || hasInterest !== undefined ||
    interestType !== undefined || interestRate !== undefined || tenureMonths !== undefined ||
    dueDate !== undefined;

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const loanRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT LoanId, LoanNo, Amount, BorrowerLHeadId, Status FROM dbo.LoanSanction WHERE LoanId = @LoanId");
    const loan = loanRes.recordset[0];
    if (!loan) throw Object.assign(new Error("Loan not found"), { status: 404 });

    if (touchesFinancials) {
      if (loan.Status === "Closed") {
        throw Object.assign(new Error("This loan is closed and its terms can no longer be edited."), { status: 409 });
      }
      const paidRes = await new sql.Request(tx)
        .input("LoanId", sql.Int, loanId)
        .query("SELECT COUNT(*) AS cnt FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId AND IsPaid = 1");
      if (paidRes.recordset[0].cnt > 0) {
        throw Object.assign(
          new Error("This loan already has repayments recorded — amount/interest/tenure/dates can no longer be edited. Only Loan Doc No, Purpose, Remarks, and bank A/C tags can still be changed."),
          { status: 409 },
        );
      }

      const useInterest = hasInterest !== false && hasInterest !== "false";
      const iType = INTEREST_TYPES.includes(interestType) ? interestType : "CI";
      const newAmt = parseFloat(amount);
      if (!newAmt || newAmt <= 0) throw Object.assign(new Error("Amount must be greater than 0"), { status: 400 });
      const newLoanDate = loanDate || loan.LoanDate;
      const effectiveRate = useInterest && interestRate != null && interestRate !== "" ? parseFloat(interestRate) : null;
      const newTenure = tenureMonths != null && tenureMonths !== "" ? parseInt(tenureMonths, 10) : null;

      // Regenerate the schedule from scratch — safe because we already
      // confirmed nothing is paid yet.
      await new sql.Request(tx)
        .input("LoanId", sql.Int, loanId)
        .query("DELETE FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId");
      const schedule = buildEmiSchedule(newAmt, effectiveRate || 0, newTenure, newLoanDate, iType, dueDate || null);
      await insertEmiSchedule(tx, loanId, schedule);

      // Adjust the original sanction CREDIT and the borrower's On A/C
      // balance by the delta rather than re-deriving it, so any unrelated
      // activity on that balance since sanction isn't clobbered.
      const amountDelta = newAmt - Number(loan.Amount);
      if (amountDelta !== 0) {
        await new sql.Request(tx)
          .input("RefId", sql.Int, loanId)
          .input("NewAmount", sql.Decimal(18, 2), newAmt)
          .query(`
            UPDATE TOP (1) dbo.OnAccountLedger
            SET Amount = @NewAmount
            WHERE RefType = 'Loan' AND RefId = @RefId AND TxnType = 'CREDIT'
          `);
        if (loan.BorrowerLHeadId) {
          await new sql.Request(tx)
            .input("PartyId", sql.Int, loan.BorrowerLHeadId)
            .input("Delta", sql.Decimal(18, 2), amountDelta)
            .query(`
              UPDATE dbo.AccountHeadMaster
              SET OnAccountBalance = ISNULL(OnAccountBalance, 0) + @Delta
              WHERE LHeadId = @PartyId
            `);
        }
      }

      // If this loan was already posted to GL with the old amount, reverse
      // that entry — the Posting tab auto-reposts with the new amount the
      // next time it's opened (same auto-post-on-view flow as sanction).
      await new sql.Request(tx)
        .input("SrcId", sql.Int, loanId)
        .query(`
          UPDATE dbo.GeneralLedgerEntry SET IsReversed = 1
          WHERE SourceType = 'LoanPosting' AND SourceId = @SrcId AND IsReversed = 0
        `);

      await new sql.Request(tx)
        .input("LoanId", sql.Int, loanId)
        .input("LoanDate", sql.Date, newLoanDate)
        .input("Amount", sql.Decimal(18, 2), newAmt)
        .input("HasInterest", sql.Bit, useInterest ? 1 : 0)
        .input("InterestType", sql.NVarChar(10), iType)
        .input("InterestRate", sql.Decimal(5, 2), effectiveRate)
        .input("TenureMonths", sql.Int, newTenure)
        .query(`
          UPDATE dbo.LoanSanction
          SET LoanDate = @LoanDate, Amount = @Amount, HasInterest = @HasInterest,
              InterestType = @InterestType, InterestRate = @InterestRate, TenureMonths = @TenureMonths
          WHERE LoanId = @LoanId
        `);
    }

    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .input("LoanDocNo", sql.NVarChar(100), loanDocNo || null)
      .input("Purpose", sql.NVarChar(500), purpose || null)
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("LenderBankAccountId", sql.Int, lenderBankAccountId ? parseInt(lenderBankAccountId, 10) : null)
      .input("BorrowerBankAccountId", sql.Int, borrowerBankAccountId ? parseInt(borrowerBankAccountId, 10) : null)
      .input("UpdatedBy", sql.NVarChar(150), updatedBy).query(`
        UPDATE dbo.LoanSanction
        SET LoanDocNo = @LoanDocNo, Purpose = @Purpose, Remarks = @Remarks,
            LenderBankAccountId = @LenderBankAccountId, BorrowerBankAccountId = @BorrowerBankAccountId,
            UpdatedBy = @UpdatedBy, UpdatedAt = SYSDATETIME()
        WHERE LoanId = @LoanId
      `);

    await tx.commit();
    await Promise.all([bumpCacheVersion("loan-sanction"), bumpCacheVersion("on-account"), bumpCacheVersion("journal-voucher")]);
    res.json({ success: true });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /:id/posting — live posting preview, mirrors GRN's /:id/posting ───
// (same "isPosted / jvNo" shape the frontend already knows how to render).
router.get("/:id/posting", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const loanRes = await pool.request().input("LoanId", sql.Int, loanId).query(`
      SELECT
        ls.LoanId, ls.LoanNo, ls.Amount, ls.LenderCompanyId, ls.LenderLHeadId, ls.BorrowerLHeadId,
        lender_gl.LHeadName AS LenderLHeadName,
        lender_grp.Name AS LenderGroupName,
        borrower_gl.LHeadName AS BorrowerLHeadName,
        borrower_grp.Name AS BorrowerGroupName
      FROM dbo.LoanSanction ls
      LEFT JOIN dbo.AccountHeadMaster lender_gl ON lender_gl.LHeadId = ls.LenderLHeadId
      LEFT JOIN dbo.AccountGroup lender_grp ON lender_grp.AGId = lender_gl.LBelongsTo
      LEFT JOIN dbo.AccountHeadMaster borrower_gl ON borrower_gl.LHeadId = ls.BorrowerLHeadId
      LEFT JOIN dbo.AccountGroup borrower_grp ON borrower_grp.AGId = borrower_gl.LBelongsTo
      WHERE ls.LoanId = @LoanId
    `);
    if (!loanRes.recordset.length) return res.status(404).json({ error: "Loan not found" });
    const loan = loanRes.recordset[0];

    const postedRes = await pool.request().input("SrcId", sql.Int, loanId).query(`
      SELECT TOP 1 EntryId, VoucherNo FROM dbo.GeneralLedgerEntry
      WHERE SourceType = 'LoanPosting' AND SourceId = @SrcId AND IsReversed = 0
    `);
    const existingPost = postedRes.recordset[0];

    res.json({
      loanNo: loan.LoanNo,
      amount: loan.Amount,
      accounts: {
        borrower: loan.BorrowerLHeadId
          ? { id: loan.BorrowerLHeadId, name: loan.BorrowerLHeadName, group: loan.BorrowerGroupName }
          : null,
        lender: loan.LenderLHeadId
          ? { id: loan.LenderLHeadId, name: loan.LenderLHeadName, group: loan.LenderGroupName }
          : null,
      },
      isPosted: !!existingPost,
      jvNo: existingPost?.VoucherNo ?? null,
      jvId: existingPost?.EntryId ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/post-to-gl — post the loan sanction as a real JV, same
//    mechanism GRN/Payment use, so it shows up in Trial Balance ──────────
router.post("/:id/post-to-gl", requirePageRight("loan-sanction", "edit"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });
  const userEmail = req.user?.email || req.user?.name || "system";
  try {
    const pool = getPool();
    const { lockNextDocNumber, backPatchRecordId, resolveDocTypeId } = require("../utils/docNumberLock");
    const { postVoucher } = require("../services/generalLedger");

    const loanRes = await pool.request().input("LoanId", sql.Int, loanId).query(`
      SELECT LoanId, LoanNo, Amount, LenderCompanyId, BorrowerCompanyId, LenderLHeadId, BorrowerLHeadId
      FROM dbo.LoanSanction WHERE LoanId = @LoanId
    `);
    if (!loanRes.recordset.length) return res.status(404).json({ error: "Loan not found" });
    const loan = loanRes.recordset[0];
    if (!loan.LenderLHeadId || !loan.BorrowerLHeadId) {
      return res.status(422).json({ error: "This loan is missing its lender/borrower GL accounts — cannot post." });
    }

    const alreadyPosted = await pool.request().input("SrcId", sql.Int, loanId).query(`
      SELECT TOP 1 EntryId FROM dbo.GeneralLedgerEntry WHERE SourceType = 'LoanPosting' AND SourceId = @SrcId AND IsReversed = 0
    `);
    if (alreadyPosted.recordset.length) return res.status(409).json({ error: "This loan has already been posted to GL." });

    const amt = Number(loan.Amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: "Loan has no amount to post." });

    // Dr the borrower's Loan ledger (they now owe this — a receivable from
    // the sanctioning side), Cr the lender's Loan ledger (funds went out).
    const lines = [
      { LHeadId: loan.BorrowerLHeadId, DebitAmount: amt, CreditAmount: 0, Narration: `Loan Posting: ${loan.LoanNo} — Borrower` },
      { LHeadId: loan.LenderLHeadId, DebitAmount: 0, CreditAmount: amt, Narration: `Loan Posting: ${loan.LoanNo} — Lender` },
    ];

    const dtId = await resolveDocTypeId(pool, sql, "JV").catch(() => null);
    const finalDocNo = dtId
      ? await lockNextDocNumber(pool, sql, {
          docTypeId: dtId,
          tableName: "JournalVoucher",
          docNoColumn: "JVNo",
          issuedBy: userEmail,
        }).catch(() => null)
      : null;

    const insertHdr = await pool.request()
      .input("JVNo", sql.NVarChar(100), finalDocNo || null)
      .input("JVDate", sql.Date, new Date())
      .input("Narration", sql.NVarChar(500), `Loan Posting: ${loan.LoanNo}`)
      .input("CompanyId", sql.Int, loan.LenderCompanyId || loan.BorrowerCompanyId || null)
      .input("DocTypeId", sql.Int, dtId || null)
      .input("CreatedBy", sql.NVarChar(150), userEmail)
      .query(`INSERT INTO dbo.JournalVoucher (JVNo,JVDate,Narration,CompanyId,Status,DocTypeId,CreatedBy) OUTPUT INSERTED.JVID VALUES (@JVNo,@JVDate,@Narration,@CompanyId,'Approved',@DocTypeId,@CreatedBy)`);
    const jvId = insertHdr.recordset[0].JVID;

    let sortOrder = 0;
    for (const line of lines) {
      await pool.request()
        .input("JVID", sql.Int, jvId)
        .input("LHeadId", sql.Int, line.LHeadId)
        .input("DebitAmount", sql.Decimal(18, 2), line.DebitAmount)
        .input("CreditAmount", sql.Decimal(18, 2), line.CreditAmount)
        .input("Narration", sql.NVarChar(255), line.Narration)
        .input("SortOrder", sql.Int, sortOrder++)
        .query(`INSERT INTO dbo.JournalVoucherLines (JVID,LHeadId,DebitAmount,CreditAmount,Narration,SortOrder) VALUES (@JVID,@LHeadId,@DebitAmount,@CreditAmount,@Narration,@SortOrder)`);
    }
    if (finalDocNo) await backPatchRecordId(pool, sql, finalDocNo, "JournalVoucher", jvId);

    await postVoucher(pool, {
      voucherNo: finalDocNo || `JV-${jvId}`,
      voucherDate: new Date(),
      sourceType: "LoanPosting",
      sourceId: loanId,
      companyId: loan.LenderCompanyId || loan.BorrowerCompanyId || null,
      createdBy: userEmail,
      legs: lines.map((l) => ({ lHeadId: l.LHeadId, debit: l.DebitAmount, credit: l.CreditAmount, narration: l.Narration })),
    });

    await Promise.all([bumpCacheVersion("journal-voucher"), bumpCacheVersion("loan-sanction")]);
    res.json({ jvId, jvNo: finalDocNo, message: "Loan posted to GL successfully." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /:id/emi/:emiId/pay — check/uncheck an EMI as paid ────────────────
// Checking it DEBITs the borrower's Loan ledger balance (repayment reduces
// what's still outstanding/adjustable); unchecking reverses that DEBIT.
// When every installment is paid, the loan itself flips to 'Closed'.
router.put("/:id/emi/:emiId/pay", requirePageRight("loan-sanction", "edit"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  const emiId = parseInt(req.params.emiId, 10);
  const paid = !!req.body.paid;
  const actor = req.user?.email || req.user?.name || "system";
  if (!Number.isFinite(loanId) || !Number.isFinite(emiId)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const emiRes = await new sql.Request(tx)
      .input("EMIId", sql.Int, emiId)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT * FROM dbo.LoanEMISchedule WHERE EMIId = @EMIId AND LoanId = @LoanId");
    const emi = emiRes.recordset[0];
    if (!emi) throw Object.assign(new Error("EMI installment not found"), { status: 404 });
    if (!!emi.IsPaid === paid) {
      await tx.commit();
      return res.json({ success: true, unchanged: true });
    }

    const loanRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT BorrowerLHeadId, LoanNo FROM dbo.LoanSanction WHERE LoanId = @LoanId");
    const loan = loanRes.recordset[0];
    if (!loan) throw Object.assign(new Error("Loan not found"), { status: 404 });

    await new sql.Request(tx)
      .input("EMIId", sql.Int, emiId)
      .input("IsPaid", sql.Bit, paid ? 1 : 0)
      .input("PaidDate", sql.Date, paid ? new Date() : null)
      .input("PaidBy", sql.NVarChar(150), paid ? actor : null).query(`
        UPDATE dbo.LoanEMISchedule
        SET IsPaid = @IsPaid, PaidDate = @PaidDate, PaidBy = @PaidBy
        WHERE EMIId = @EMIId
      `);

    if (loan.BorrowerLHeadId) {
      await new sql.Request(tx)
        .input("PartyId", sql.Int, loan.BorrowerLHeadId)
        .input("PartyType", sql.NVarChar(20), "Loan")
        .input("TxnDate", sql.Date, new Date())
        .input("TxnType", sql.NVarChar(10), paid ? "DEBIT" : "CREDIT")
        .input("Amount", sql.Decimal(18, 2), emi.EMIAmount)
        .input("RefType", sql.NVarChar(30), "LoanEMI")
        .input("RefDocNo", sql.NVarChar(100), loan.LoanNo)
        .input("RefId", sql.Int, emiId)
        .input("Notes", sql.NVarChar(500), `EMI #${emi.InstallmentNo} ${paid ? "paid" : "un-marked"} for ${loan.LoanNo}`)
        .input("CreatedBy", sql.NVarChar(150), actor).query(`
          INSERT INTO dbo.OnAccountLedger
            (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, RefId, Notes, CreatedBy)
          VALUES
            (@PartyId, @PartyType, @TxnDate, @TxnType, @Amount, @RefType, @RefDocNo, @RefId, @Notes, @CreatedBy);
          UPDATE dbo.AccountHeadMaster
            SET OnAccountBalance = ISNULL(OnAccountBalance, 0) + (CASE WHEN @TxnType = 'CREDIT' THEN @Amount ELSE -@Amount END)
            WHERE LHeadId = @PartyId;
        `);
    }

    const remaining = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT COUNT(*) AS cnt FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId AND IsPaid = 0");
    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .input("Status", sql.NVarChar(20), remaining.recordset[0].cnt === 0 ? "Closed" : "Sanctioned")
      .query("UPDATE dbo.LoanSanction SET Status = @Status, UpdatedBy = NULL, UpdatedAt = SYSDATETIME() WHERE LoanId = @LoanId");

    await tx.commit();
    await Promise.all([
      bumpCacheVersion("loan-sanction"),
      bumpCacheVersion("on-account"),
    ]);
    res.json({ success: true });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /:id/pay — flexible repayment: single EMI, multiple EMIs, or a
//    lump sum. Applies to every loan type.
//
// Body: { emiIds?: number[], lumpSumAmount?: number, lateFee?: number,
//         paymentDate, notes? }
// Exactly one of emiIds / lumpSumAmount is expected.
//
// Payoff validator (as specified): once the running total actually paid
// toward principal+interest (across every LoanPayment row for this loan,
// including this one) reaches or exceeds the full schedule total, the loan
// is marked Closed regardless of which individual installments that total
// lines up against — a 4-month, interest-bearing loan can be paid off in
// month 1 with one lump sum. Any amount paid beyond what was actually owed
// is credited to the LENDER's own ledger (the receiver of the payment) as
// an on-account credit, adjustable later via the On A/C Adjustment page —
// it is never silently dropped.
// Late fee is tracked separately and does NOT count toward the payoff
// total — it's an additional charge, not principal/interest.
router.post("/:id/pay", requirePageRight("loan-sanction", "edit"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  const { emiIds, lumpSumAmount, lateFee, paymentDate, notes } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });

  const fee = lateFee != null && lateFee !== "" ? parseFloat(lateFee) : 0;
  const isLumpSum = lumpSumAmount != null && lumpSumAmount !== "";
  const requestedEmiIds = Array.isArray(emiIds) ? emiIds.map((n) => parseInt(n, 10)).filter(Number.isFinite) : [];
  if (!isLumpSum && requestedEmiIds.length === 0) {
    return res.status(400).json({ error: "Select at least one EMI, or enter a lump sum amount" });
  }
  if (!paymentDate) return res.status(400).json({ error: "Payment date is required" });

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const loanRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT LoanId, LoanNo, LoanType, Status, BorrowerLHeadId, LenderLHeadId FROM dbo.LoanSanction WHERE LoanId = @LoanId");
    const loan = loanRes.recordset[0];
    if (!loan) throw Object.assign(new Error("Loan not found"), { status: 404 });
    if (loan.Status === "Closed") {
      throw Object.assign(new Error("This loan is already closed."), { status: 409 });
    }

    const allEmisRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT EMIId, EMIAmount, IsPaid FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId ORDER BY InstallmentNo ASC");
    const allEmis = allEmisRes.recordset;
    const unpaidEmis = allEmis.filter((e) => !e.IsPaid);
    const totalScheduleAmount = allEmis.reduce((s, e) => s + Number(e.EMIAmount), 0);

    const alreadyPaidRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT ISNULL(SUM(PrincipalInterestAmount), 0) AS paid FROM dbo.LoanPayment WHERE LoanId = @LoanId");
    const alreadyPaid = Number(alreadyPaidRes.recordset[0].paid);

    let principalInterestAmount;
    let emiIdsToMark = [];

    if (isLumpSum) {
      principalInterestAmount = parseFloat(lumpSumAmount);
      if (!principalInterestAmount || principalInterestAmount <= 0) {
        throw Object.assign(new Error("Lump sum amount must be greater than 0"), { status: 400 });
      }
      // Greedily apply the lump sum to unpaid EMIs in due-date order for
      // as far as it covers full installments — this is just how the
      // payment gets attributed to the plan; the payoff check below is
      // what actually decides closure, independent of exact EMI matching.
      let remaining = principalInterestAmount;
      for (const emi of unpaidEmis) {
        if (remaining >= Number(emi.EMIAmount) - 0.01) {
          emiIdsToMark.push(emi.EMIId);
          remaining -= Number(emi.EMIAmount);
        } else {
          break;
        }
      }
    } else {
      const matched = allEmis.filter((e) => requestedEmiIds.includes(e.EMIId));
      if (matched.length !== requestedEmiIds.length) {
        throw Object.assign(new Error("One or more selected EMIs were not found on this loan"), { status: 400 });
      }
      const alreadyPaidSelected = matched.filter((e) => e.IsPaid);
      if (alreadyPaidSelected.length > 0) {
        throw Object.assign(new Error("One or more selected EMIs are already paid"), { status: 409 });
      }
      principalInterestAmount = matched.reduce((s, e) => s + Number(e.EMIAmount), 0);
      emiIdsToMark = matched.map((e) => e.EMIId);
    }

    const newTotalPaid = alreadyPaid + principalInterestAmount;
    const willClose = newTotalPaid >= totalScheduleAmount - 0.01;
    const excess = willClose ? Math.max(0, Math.round((newTotalPaid - totalScheduleAmount) * 100) / 100) : 0;
    const totalAmount = Math.round((principalInterestAmount + fee) * 100) / 100;

    const paymentRef = `PAY-${loan.LoanNo}-${Date.now().toString().slice(-6)}`;
    const paymentType = isLumpSum ? "LumpSum" : "EMI";

    const paymentInsert = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .input("PaymentRef", sql.NVarChar(100), paymentRef)
      .input("PaymentDate", sql.Date, paymentDate)
      .input("PaymentType", sql.NVarChar(20), paymentType)
      .input("PrincipalInterestAmount", sql.Decimal(18, 2), principalInterestAmount)
      .input("LateFee", sql.Decimal(18, 2), fee)
      .input("TotalAmount", sql.Decimal(18, 2), totalAmount)
      .input("ExcessCredited", sql.Decimal(18, 2), excess)
      .input("ClosedLoan", sql.Bit, willClose ? 1 : 0)
      .input("Notes", sql.NVarChar(500), notes || null)
      .input("CreatedBy", sql.NVarChar(150), actor).query(`
        INSERT INTO dbo.LoanPayment
          (LoanId, PaymentRef, PaymentDate, PaymentType, PrincipalInterestAmount, LateFee, TotalAmount, ExcessCredited, ClosedLoan, Notes, CreatedBy)
        OUTPUT INSERTED.PaymentId
        VALUES
          (@LoanId, @PaymentRef, @PaymentDate, @PaymentType, @PrincipalInterestAmount, @LateFee, @TotalAmount, @ExcessCredited, @ClosedLoan, @Notes, @CreatedBy)
      `);
    const paymentId = paymentInsert.recordset[0].PaymentId;

    // If the payoff closes the loan, every remaining EMI is settled by this
    // payment (that's the whole point of an early lump-sum payoff) —
    // otherwise, only the specific EMIs this payment actually covers.
    const emisToUpdate = willClose ? unpaidEmis.map((e) => e.EMIId) : emiIdsToMark;
    for (const emiId of emisToUpdate) {
      await new sql.Request(tx)
        .input("EMIId", sql.Int, emiId)
        .input("PaymentId", sql.Int, paymentId)
        .input("PaidDate", sql.Date, paymentDate)
        .input("PaidBy", sql.NVarChar(150), actor).query(`
          UPDATE dbo.LoanEMISchedule
          SET IsPaid = 1, PaidDate = @PaidDate, PaidBy = @PaidBy, PaymentId = @PaymentId
          WHERE EMIId = @EMIId
        `);
    }

    // Borrower's loan balance goes down by the principal+interest portion —
    // late fee is a separate charge, not a reduction of the loan itself.
    if (loan.BorrowerLHeadId) {
      await new sql.Request(tx)
        .input("PartyId", sql.Int, loan.BorrowerLHeadId)
        .input("PartyType", sql.NVarChar(20), "Loan")
        .input("TxnDate", sql.Date, paymentDate)
        .input("TxnType", sql.NVarChar(10), "DEBIT")
        .input("Amount", sql.Decimal(18, 2), principalInterestAmount)
        .input("RefType", sql.NVarChar(30), "LoanPayment")
        .input("RefDocNo", sql.NVarChar(100), paymentRef)
        .input("RefId", sql.Int, paymentId)
        .input("Notes", sql.NVarChar(500), `${paymentType} payment ${paymentRef} for ${loan.LoanNo}${willClose ? " (loan closed)" : ""}`)
        .input("CreatedBy", sql.NVarChar(150), actor).query(`
          INSERT INTO dbo.OnAccountLedger
            (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, RefId, Notes, CreatedBy)
          VALUES
            (@PartyId, @PartyType, @TxnDate, @TxnType, @Amount, @RefType, @RefDocNo, @RefId, @Notes, @CreatedBy);
          UPDATE dbo.AccountHeadMaster
            SET OnAccountBalance = ISNULL(OnAccountBalance, 0) - @Amount
            WHERE LHeadId = @PartyId;
        `);
    }

    // Overpayment on early closure goes to the LENDER (the receiver of the
    // money) as an on-account credit — never dropped, adjustable later.
    if (excess > 0 && loan.LenderLHeadId) {
      await new sql.Request(tx)
        .input("PartyId", sql.Int, loan.LenderLHeadId)
        .input("PartyType", sql.NVarChar(20), "Loan")
        .input("TxnDate", sql.Date, paymentDate)
        .input("TxnType", sql.NVarChar(10), "CREDIT")
        .input("Amount", sql.Decimal(18, 2), excess)
        .input("RefType", sql.NVarChar(30), "LoanOverpayment")
        .input("RefDocNo", sql.NVarChar(100), paymentRef)
        .input("RefId", sql.Int, paymentId)
        .input("Notes", sql.NVarChar(500), `Overpayment on early closure of ${loan.LoanNo} — available for adjustment`)
        .input("CreatedBy", sql.NVarChar(150), actor).query(`
          INSERT INTO dbo.OnAccountLedger
            (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, RefId, Notes, CreatedBy)
          VALUES
            (@PartyId, @PartyType, @TxnDate, @TxnType, @Amount, @RefType, @RefDocNo, @RefId, @Notes, @CreatedBy);
          UPDATE dbo.AccountHeadMaster
            SET OnAccountBalance = ISNULL(OnAccountBalance, 0) + @Amount
            WHERE LHeadId = @PartyId;
        `);
    }

    if (willClose) {
      await new sql.Request(tx)
        .input("LoanId", sql.Int, loanId)
        .input("PaymentId", sql.Int, paymentId).query(`
          UPDATE dbo.LoanSanction
          SET Status = 'Closed', ClosedAt = SYSDATETIME(), ClosurePaymentId = @PaymentId, UpdatedAt = SYSDATETIME()
          WHERE LoanId = @LoanId
        `);
    }

    await tx.commit();
    await Promise.all([
      bumpCacheVersion("loan-sanction"),
      bumpCacheVersion("on-account"),
    ]);
    res.status(201).json({
      paymentId,
      paymentRef,
      totalAmount,
      loanClosed: willClose,
      excessCredited: excess,
    });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /:id/document — upload a supporting document against the loan
//    (agreement, sanction letter, etc.) — unlike the NOC, this can be
//    uploaded any time, not just once the loan is closed.
router.post("/:id/document", requirePageRight("loan-sanction", "edit"), upload.single("file"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  const actor = req.user?.email || req.user?.name || "system";
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const pool = getPool();
    const loanRes = await pool.request().input("LoanId", sql.Int, loanId)
      .query("SELECT LoanId FROM dbo.LoanSanction WHERE LoanId = @LoanId");
    if (!loanRes.recordset[0]) return res.status(404).json({ error: "Loan not found" });

    const insertRes = await pool
      .request()
      .input("LoanId", sql.Int, loanId)
      .input("DocType", sql.NVarChar(30), req.body.docType || "Agreement")
      .input("FileName", sql.NVarChar(255), req.file.originalname)
      .input("MimeType", sql.NVarChar(100), req.file.mimetype)
      .input("FileSize", sql.Int, req.file.size)
      .input("FileData", sql.VarBinary(sql.MAX), req.file.buffer)
      .input("UploadedBy", sql.NVarChar(150), actor).query(`
        INSERT INTO dbo.LoanDocumentAttachments (LoanId, DocType, FileName, MimeType, FileSize, FileData, UploadedBy)
        OUTPUT INSERTED.AttachmentId
        VALUES (@LoanId, @DocType, @FileName, @MimeType, @FileSize, @FileData, @UploadedBy)
      `);
    const attachId = insertRes.recordset[0].AttachmentId;
    await bumpCacheVersion("loan-sanction");
    res.status(201).json({ attachmentId: attachId, fileName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:id/documents — list supporting documents uploaded against a loan
router.get("/:id/documents", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("LoanId", sql.Int, loanId).query(`
      SELECT AttachmentId, LoanId, DocType, FileName, MimeType, FileSize, UploadedBy, UploadedAt
      FROM dbo.LoanDocumentAttachments
      WHERE LoanId = @LoanId
      ORDER BY UploadedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /document/:attachId — stream a stored loan document ────────────────
router.get("/document/:attachId", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const attachId = parseInt(req.params.attachId, 10);
  if (!Number.isFinite(attachId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("AttachmentId", sql.Int, attachId)
      .query("SELECT FileName, MimeType, FileData FROM dbo.LoanDocumentAttachments WHERE AttachmentId = @AttachmentId");
    const attachment = result.recordset[0];
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader("Content-Type", attachment.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.FileName)}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(attachment.FileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/noc — upload the No Objection Certificate once a loan is
//    closed. Mirrors routes/grns.js's attachment upload pattern exactly.
router.post("/:id/noc", requirePageRight("loan-sanction", "edit"), upload.single("file"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  const actor = req.user?.email || req.user?.name || "system";
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  try {
    const pool = getPool();
    const loanRes = await pool.request().input("LoanId", sql.Int, loanId)
      .query("SELECT LoanId, Status FROM dbo.LoanSanction WHERE LoanId = @LoanId");
    const loan = loanRes.recordset[0];
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    if (loan.Status !== "Closed") {
      return res.status(400).json({ error: "NOC can only be uploaded once the loan is fully paid and closed." });
    }

    const insertRes = await pool
      .request()
      .input("LoanId", sql.Int, loanId)
      .input("FileName", sql.NVarChar(255), req.file.originalname)
      .input("MimeType", sql.NVarChar(100), req.file.mimetype)
      .input("FileSize", sql.Int, req.file.size)
      .input("FileData", sql.VarBinary(sql.MAX), req.file.buffer)
      .input("UploadedBy", sql.NVarChar(150), actor).query(`
        INSERT INTO dbo.LoanNOCAttachments (LoanId, FileName, MimeType, FileSize, FileData, UploadedBy)
        OUTPUT INSERTED.AttachmentId
        VALUES (@LoanId, @FileName, @MimeType, @FileSize, @FileData, @UploadedBy)
      `);
    const attachId = insertRes.recordset[0].AttachmentId;

    await pool.request().input("LoanId", sql.Int, loanId).input("AttachmentId", sql.Int, attachId)
      .query("UPDATE dbo.LoanSanction SET NOCAttachmentId = @AttachmentId WHERE LoanId = @LoanId");

    await bumpCacheVersion("loan-sanction");
    res.status(201).json({ attachmentId: attachId, fileName: req.file.originalname });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /noc/:attachId — stream a stored NOC file ───────────────────────────
router.get("/noc/:attachId", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const attachId = parseInt(req.params.attachId, 10);
  if (!Number.isFinite(attachId)) return res.status(400).json({ error: "Invalid id" });
  try {
    const pool = getPool();
    const result = await pool.request().input("AttachmentId", sql.Int, attachId)
      .query("SELECT FileName, MimeType, FileData FROM dbo.LoanNOCAttachments WHERE AttachmentId = @AttachmentId");
    const attachment = result.recordset[0];
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    res.setHeader("Content-Type", attachment.MimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(attachment.FileName)}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(attachment.FileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:id — remove a sanctioned loan entirely ────────────────────────
// Blocked once any EMI has actually been paid (that's real repayment
// history — deleting the loan would silently erase it and desync the
// borrower's On A/C balance). For a loan with no repayments yet, this
// reverses the original sanction CREDIT, removes the EMI schedule, and
// deletes the loan row. The auto-generated "Loan - <Company>" GL ledger
// heads are left in place — other loans for the same counterparty may
// still reference them.
router.delete("/:id", requirePageRight("loan-sanction", "delete"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    const loanRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT LoanId, LoanNo, Amount, BorrowerLHeadId FROM dbo.LoanSanction WHERE LoanId = @LoanId");
    const loan = loanRes.recordset[0];
    if (!loan) throw Object.assign(new Error("Loan not found"), { status: 404 });

    const paidRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT COUNT(*) AS cnt FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId AND IsPaid = 1");
    if (paidRes.recordset[0].cnt > 0) {
      throw Object.assign(
        new Error("This loan has EMI payments already recorded and can't be deleted. Reverse those payments first."),
        { status: 409 },
      );
    }

    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("DELETE FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId");

    await new sql.Request(tx)
      .input("RefId", sql.Int, loanId)
      .query("DELETE FROM dbo.OnAccountLedger WHERE RefType = 'Loan' AND RefId = @RefId");

    if (loan.BorrowerLHeadId) {
      await new sql.Request(tx)
        .input("PartyId", sql.Int, loan.BorrowerLHeadId)
        .input("Amount", sql.Decimal(18, 2), loan.Amount)
        .query(`
          UPDATE dbo.AccountHeadMaster
          SET OnAccountBalance = ISNULL(OnAccountBalance, 0) - @Amount
          WHERE LHeadId = @PartyId
        `);
    }

    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("DELETE FROM dbo.LoanSanction WHERE LoanId = @LoanId");

    await tx.commit();
    await Promise.all([
      bumpCacheVersion("loan-sanction"),
      bumpCacheVersion("on-account"),
    ]);
    res.json({ success: true });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
