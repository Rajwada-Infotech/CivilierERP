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

  // Matched by name alone, NOT "AND ParentGroupId IS NULL" — that guard used
  // to double as an identity check back when this group was deliberately
  // parentless, but migration 383 gave it a real parent (nested it under
  // Current Liabilities for Trial Balance's benefit) while keeping the same
  // Name/Code. The old guard would silently stop matching after that, and
  // every loan sanctioned from then on would insert with LBelongsTo = NULL —
  // invisible in every financial report, not just misclassified.
  const group = await pool
    .request()
    .query("SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LOANS AND ADVANCES'");
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

// Get-or-create the ledger head that represents a Bank Loan's lender — an
// EXTERNAL bank (SBI, HDFC, whichever), not necessarily one we already have
// an account with. Previously a Bank Loan's "lender" was required to
// already exist as one of OUR OWN registered bank accounts
// (AccountHeadMaster LHeadType='B', scoped to a company) — wrong for any
// loan from a bank we don't otherwise bank with, and wrong classification-
// wise even when it happened to match: crediting a Bank-type (asset) head
// for what's actually a liability misrepresents it on the Balance Sheet.
// Mirrors ensureLoanLedgerHead's shadow-account pattern (same
// 'LOANS AND ADVANCES' group, LHeadType='LN' — correct liability
// classification, and already flows through Trial Balance/Balance Sheet
// the same way Inter-Company/Customer Loan counterparties do) but keyed by
// the bank's NAME rather than a numeric company/customer id, since an
// external bank has no id of its own in this system. Named as the bank
// itself (not "Loan - <name>") so it reads naturally in an account list —
// context (the Loans & Advances group) already makes clear it's a payable.
async function ensureBankLoanLenderHead(pool, bankName, createdBy) {
  const name = String(bankName || "").trim();
  if (!name) throw Object.assign(new Error("Lender bank name is required"), { status: 400 });

  const existing = await pool
    .request()
    .input("Name", sql.NVarChar(200), name)
    .query("SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadType = 'LN' AND LHeadName = @Name");
  if (existing.recordset.length) return existing.recordset[0].LHeadId;

  const group = await pool
    .request()
    .query("SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LOANS AND ADVANCES'");
  const groupId = group.recordset[0]?.AGId ?? null;

  const inserted = await pool
    .request()
    .input("LHeadName", sql.NVarChar(200), name)
    .input("LHeadAddress", sql.VarChar(300), "N/A")
    .input("LHeadContactPerson", sql.VarChar(100), "N/A")
    .input("LHeadType", sql.VarChar(50), "LN")
    .input("LHeadStatus", sql.Bit, 1)
    .input("LBelongsTo", sql.Int, groupId)
    .input("Status", sql.NVarChar(20), "Approved")
    .input("ApprovedBy", sql.NVarChar(100), createdBy)
    .input("CreatedBy", sql.NVarChar(100), createdBy).query(`
      INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadAddress, LHeadContactPerson, LHeadType, LHeadStatus, LBelongsTo, Status, ApprovedBy, ApprovedAt, CreatedBy, CreatedAt)
      OUTPUT INSERTED.LHeadId
      VALUES
        (@LHeadName, @LHeadAddress, @LHeadContactPerson, @LHeadType, @LHeadStatus, @LBelongsTo, @Status, @ApprovedBy, SYSDATETIME(), @CreatedBy, SYSDATETIME())
    `);
  const newId = inserted.recordset[0].LHeadId;
  // Dedup here is by name (a bank has no numeric id to key a code off of
  // the way ensureLoanLedgerHead does) — but every other head still gets a
  // real, unique code, since some reports/exports expect one.
  await pool
    .request()
    .input("LHeadId", sql.Int, newId)
    .input("LHeadCode", sql.NVarChar(20), `LNBANK${newId}`)
    .query("UPDATE dbo.AccountHeadMaster SET LHeadCode = @LHeadCode WHERE LHeadId = @LHeadId");
  await bumpCacheVersion("account-head-master");
  return newId;
}

// Resolve a Customer Loan counterparty (AH's Customer Master or CRM's
// buyer list) by id + source — shared by both roles a customer can now
// play: Borrower (the original "we lend to a customer" direction) and
// Lender (the new "customer lends to us" direction, see migration 402).
// Returns { custId, custName } or null if not found.
async function resolveCustomerParty(tx, custId, source) {
  const query =
    source === "CRM"
      ? "SELECT Id AS custId, CustomerName AS custName FROM dbo.CrmCustomer WHERE Id = @custId"
      : "SELECT LHeadId AS custId, LHeadName AS custName FROM dbo.AccountHeadMaster WHERE LHeadId = @custId";
  const res = await new sql.Request(tx).input("custId", sql.Int, parseInt(custId, 10)).query(query);
  return res.recordset[0] || null;
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
    const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;

    const pool = getPool();
    const nocSearch = typeof req.query.noc === "string" && req.query.noc.trim() ? req.query.noc.trim() : null;
    const request = pool.request();
    if (companyId) request.input("CompanyId", sql.Int, companyId);
    if (nocSearch) request.input("NocSearch", sql.NVarChar(255), `%${nocSearch}%`);
    // A loan touches a company if it is the lender OR the borrower.
    // Bank Loan / Customer Loan (Customer-to-Company direction): LenderCompanyId
    // is NULL (lender is a bank/customer instead), so only BorrowerCompanyId matches.
    // Customer Loan (Company-to-Customer direction, the original one): BorrowerCompanyId
    // is NULL (borrower is a customer), so only LenderCompanyId matches.
    // Inter-Company: both may match; UNION across both sides ensures the row appears once.
    // No companyId at all → the "All companies" view: every loan, unfiltered.
    const companyFilter = companyId ? "(ls.LenderCompanyId = @CompanyId OR ls.BorrowerCompanyId = @CompanyId)" : "1=1";
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
        ls.LenderCustomerId, ls.LenderCustomerSource, ls.LenderCustomerBankName,
        COALESCE(lender_cust_ah.LHeadName, lender_cust_crm.CustomerName) AS LenderCustomerName,
        ls.LoanDate, ls.Amount, ls.InterestRate, ls.TenureMonths,
        ls.Purpose, ls.Status, ls.Remarks,
        ls.LenderLHeadId, ls.BorrowerLHeadId,
        ls.CreatedBy, ls.CreatedAt, ls.UpdatedBy, ls.UpdatedAt,
        ls.ClosedAt, ls.NOCAttachmentId, noc.FileName AS NOCFileName,
        -- sanctionInstrumentLabel() on the frontend needs these to show
        -- the cheque/mode line under the Status column — never selected
        -- here before, only on the detail route, so it always rendered
        -- nothing on the list.
        ls.PaymentMode, ls.ChequeNo, ls.ChequeDate, ls.DigitalRefNumber,
        (SELECT COUNT(*) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId) AS TotalEMIs,
        (SELECT COUNT(*) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId AND e.IsPaid = 1) AS PaidEMIs,
        -- Real amounts, not just installment counts — a linear "count paid
        -- / count total" ratio is wrong for amortized loans (front-loaded
        -- interest under CI) and for any lump-sum payment, which doesn't
        -- move PaidEMIs at all. See LoanDashboard.tsx's outstanding total.
        (SELECT ISNULL(SUM(EMIAmount), 0) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId) AS TotalScheduledAmount,
        (SELECT ISNULL(SUM(PrincipalInterestAmount), 0) FROM dbo.LoanPayment lp WHERE lp.LoanId = ls.LoanId AND lp.IsReversed = 0) AS TotalPaidAmount
      FROM dbo.LoanSanction ls
      LEFT JOIN dbo.enterprise lc ON lc.id = ls.LenderCompanyId AND lc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster lb ON lb.LHeadId = ls.LenderBankId
      LEFT JOIN dbo.AccountHeadMaster lba ON lba.LHeadId = ls.LenderBankAccountId
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster cust_ah ON cust_ah.LHeadId = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer cust_crm ON cust_crm.Id = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'CRM'
      LEFT JOIN dbo.AccountHeadMaster bba ON bba.LHeadId = ls.BorrowerBankAccountId
      LEFT JOIN dbo.AccountHeadMaster lender_cust_ah ON lender_cust_ah.LHeadId = ls.LenderCustomerId AND ls.LenderCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer lender_cust_crm ON lender_cust_crm.Id = ls.LenderCustomerId AND ls.LenderCustomerSource = 'CRM'
      LEFT JOIN dbo.LoanNOCAttachments noc ON noc.AttachmentId = ls.NOCAttachmentId
      WHERE ${companyFilter}
        ${nocSearch ? "AND noc.FileName LIKE @NocSearch" : ""}
      ORDER BY ls.CreatedAt DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /emi-reminders — unpaid EMIs due within 7 days (or overdue) ───────
// Registered before "/:id" so it isn't swallowed by the param route.
router.get("/emi-reminders", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  try {
    const pool = getPool();
    const request = pool.request();
    if (companyId) request.input("CompanyId", sql.Int, companyId);
    // No companyId → the dashboard's "All companies" default: every
    // upcoming EMI, unfiltered — same convention as GET / above.
    const companyFilter = companyId ? "(ls.LenderCompanyId = @CompanyId OR ls.BorrowerCompanyId = @CompanyId)" : "1=1";
    const result = await request.query(`
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
        AND ${companyFilter}
      ORDER BY e.DueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /emi-payable — unpaid EMIs for loans this company can settle from
//    Received Payment ────────────────────────────────────────────────────
// Repayment of every loan type — Inter-Company, Bank Loan, Customer Loan —
// is recorded through Received Payment only; there is no repayment picker
// on the outgoing Payment page any more (see the "Loan Disbursement"
// picker there instead, which is a different action — the initial money-
// out event, not repayment). This scopes to whichever of this company's
// roles is the one settling the EMI:
//   - Customer Loan / Inter-Company: this company is the LENDER (being
//     paid back).
//   - Bank Loan: this company is the BORROWER (paying an external bank
//     back) — there's no "lender company" of ours for that case, but the
//     repayment still gets tracked here rather than a separate outgoing
//     page, per the same single-surface decision.
// DisbursedAt IS NOT NULL excludes any loan that hasn't actually been
// disbursed yet — repaying before disbursing doesn't make sense, and
// disbursement is now always a deliberate separate step (see POST / and
// the "Loan Disbursement" picker).
// Registered before "/:id" so it isn't swallowed by the param route.
router.get("/emi-payable", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  if (!companyId) return res.status(400).json({ error: "companyId is required" });
  try {
    const pool = getPool();
    const result = await pool.request().input("CompanyId", sql.Int, companyId).query(`
      SELECT
        e.EMIId, e.LoanId, e.InstallmentNo, e.DueDate, e.EMIAmount,
        e.PrincipalComponent, e.InterestComponent,
        ls.LoanNo, ls.LoanType,
        COALESCE(bc.name, cust_ah.LHeadName, cust_crm.CustomerName) AS BorrowerName,
        -- Company-only borrower name (NULL for a customer-side loan) — lets
        -- the picker distinguish an internal counterparty from an external
        -- customer.
        bc.name AS BorrowerCompanyName,
        -- Lender is a company for Inter-Company and the original ("Company
        -- to Customer") Customer Loan direction, an external bank for Bank
        -- Loan, or a customer for the new "Customer to Company" direction —
        -- COALESCE across all three rather than assuming company always.
        COALESCE(lc.name, lb.LHeadName, lender_cust_ah.LHeadName, lender_cust_crm.CustomerName) AS LenderName,
        lc.name AS LenderCompanyName,
        CASE WHEN e.DueDate < CAST(GETDATE() AS DATE) THEN 1 ELSE 0 END AS IsOverdue
      FROM dbo.LoanEMISchedule e
      JOIN dbo.LoanSanction ls ON ls.LoanId = e.LoanId
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster cust_ah ON cust_ah.LHeadId = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer cust_crm ON cust_crm.Id = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'CRM'
      LEFT JOIN dbo.enterprise lc ON lc.id = ls.LenderCompanyId AND lc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster lb ON lb.LHeadId = ls.LenderBankId
      LEFT JOIN dbo.AccountHeadMaster lender_cust_ah ON lender_cust_ah.LHeadId = ls.LenderCustomerId AND ls.LenderCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer lender_cust_crm ON lender_cust_crm.Id = ls.LenderCustomerId AND ls.LenderCustomerSource = 'CRM'
      WHERE e.IsPaid = 0 AND ls.Status <> 'Closed' AND ls.DisbursedAt IS NOT NULL
        AND (
          ls.LenderCompanyId = @CompanyId
          OR (ls.LoanType = 'Bank Loan' AND ls.BorrowerCompanyId = @CompanyId)
          OR (ls.LoanType = 'Customer Loan' AND ls.LenderCustomerId IS NOT NULL AND ls.BorrowerCompanyId = @CompanyId)
        )
      ORDER BY e.DueDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /undisbursed — Sanctioned loans this company has lent out but not
//    yet disbursed to GL — Inter-Company AND Customer Loan (both are "we
//    are the lender, money goes OUT of our bank") ─────────────────────────
// Feeds Finance > Payment's "Loan Disbursement" picker — disbursement is a
// deliberate action now (see POST / above and POST /:id/disburse below),
// not automatic at sanction time, so this is how staff find the loans
// still waiting on it. Scoped to the LENDER company (the one whose Payment
// page this shows up on — they are the one paying out). Bank Loan isn't
// included here — we're the BORROWER for that type (money comes IN), so
// it belongs on Received Payment's picker instead (see GET
// /undisbursed-incoming below).
// Registered before "/:id" so it isn't swallowed by the param route.
router.get("/undisbursed", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  if (!companyId) return res.status(400).json({ error: "companyId is required" });
  try {
    const pool = getPool();
    const result = await pool.request().input("CompanyId", sql.Int, companyId).query(`
      SELECT
        ls.LoanId, ls.LoanNo, ls.LoanType, ls.LoanDate, ls.Amount,
        ls.LenderBankAccountId, ls.BorrowerBankAccountId,
        ls.BorrowerCustomerId, ls.BorrowerCustomerSource,
        bc.name AS BorrowerCompanyName,
        COALESCE(crmCust.CustomerName, ahmCust.LHeadName) AS BorrowerCustomerName
      FROM dbo.LoanSanction ls
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.CrmCustomer crmCust ON ls.LoanType = 'Customer Loan' AND ls.BorrowerCustomerSource = 'CRM' AND crmCust.Id = ls.BorrowerCustomerId
      LEFT JOIN dbo.AccountHeadMaster ahmCust ON ls.LoanType = 'Customer Loan' AND ls.BorrowerCustomerSource <> 'CRM' AND ahmCust.LHeadId = ls.BorrowerCustomerId
      WHERE ls.LoanType IN ('Inter-Company', 'Customer Loan') AND ls.Status <> 'Closed'
        AND ls.DisbursedAt IS NULL AND ls.LenderCompanyId = @CompanyId
      ORDER BY ls.LoanDate ASC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /undisbursed-incoming — Sanctioned Bank Loans / Customer-to-Company
//    Customer Loans this company has borrowed but not yet disbursed to GL
//    ("we are the BORROWER, money comes IN from an external party") ───────
// Feeds Received Payment's "Disburse a Bank Loan" picker — also covers the
// Customer Loan's "Customer to Company" direction now (migration 402):
// same shape (external lender, we're the borrower, money comes in), just a
// customer instead of a bank playing the lender role.
// Scoped to the BORROWER company (the one whose Received Payment page this
// shows up on — they are the one receiving the money).
// Registered before "/:id" so it isn't swallowed by the param route.
router.get("/undisbursed-incoming", requirePageRight("loan-sanction", "view"), async (req, res) => {
  const companyId = req.query.companyId ? parseInt(req.query.companyId, 10) : null;
  if (!companyId) return res.status(400).json({ error: "companyId is required" });
  try {
    const pool = getPool();
    const result = await pool.request().input("CompanyId", sql.Int, companyId).query(`
      SELECT
        ls.LoanId, ls.LoanNo, ls.LoanType, ls.LoanDate, ls.Amount,
        ls.LenderBankId, lb.LHeadName AS LenderBankName,
        ls.LenderCustomerId, ls.LenderCustomerSource,
        COALESCE(lb.LHeadName, lender_cust_ah.LHeadName, lender_cust_crm.CustomerName) AS LenderName
      FROM dbo.LoanSanction ls
      LEFT JOIN dbo.AccountHeadMaster lb ON lb.LHeadId = ls.LenderBankId
      LEFT JOIN dbo.AccountHeadMaster lender_cust_ah ON lender_cust_ah.LHeadId = ls.LenderCustomerId AND ls.LenderCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer lender_cust_crm ON lender_cust_crm.Id = ls.LenderCustomerId AND ls.LenderCustomerSource = 'CRM'
      WHERE ls.Status <> 'Closed' AND ls.DisbursedAt IS NULL AND ls.BorrowerCompanyId = @CompanyId
        AND (
          ls.LoanType = 'Bank Loan'
          OR (ls.LoanType = 'Customer Loan' AND ls.LenderCustomerId IS NOT NULL)
        )
      ORDER BY ls.LoanDate ASC
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
        COALESCE(lender_cust_ah.LHeadName, lender_cust_crm.CustomerName) AS LenderCustomerName,
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
      LEFT JOIN dbo.AccountHeadMaster lender_cust_ah ON lender_cust_ah.LHeadId = ls.LenderCustomerId AND ls.LenderCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer lender_cust_crm ON lender_cust_crm.Id = ls.LenderCustomerId AND ls.LenderCustomerSource = 'CRM'
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
        p.IsReversed, p.ReversedAt, p.ReversedReason,
        (SELECT COUNT(*) FROM dbo.LoanEMISchedule e WHERE e.PaymentId = p.PaymentId) AS EmisCovered,
        -- The actual payment instrument used (see migration 340) — a Loan
        -- EMI settles through either Finance > Payment (money going OUT —
        -- Inter-Company/Bank Loan) or Received Payment (money coming IN —
        -- a Customer Loan repayment, migration 356), never both; whichever
        -- one this row is linked to is where mode/cheque/bank/reference
        -- were genuinely captured, so every field below is COALESCEd
        -- across the two possible sources.
        np.PPaymentID AS NewPaymentId,
        rp.RPPaymentID AS ReceivedPaymentId,
        COALESCE(np.PMode, rp.RPMode) AS PaymentMode,
        COALESCE(np.PChequeNo, rp.RPCheckNumber) AS ChequeNo,
        COALESCE(np.PChequeDate, rp.RPChequeDate) AS ChequeDate,
        COALESCE(np.PBankName, rp.RPDepositBankName, rp.RPBankName) AS BankName,
        COALESCE(np.PNeftNumber, rp.RPTransactionId) AS NeftNumber,
        np.PUpiTransactionId AS UpiTransactionId,
        np.PRtgsReference AS RtgsReference,
        np.PImpsReference AS ImpsReference,
        COALESCE(np.DocNo, rp.RPDocNo) AS PaymentDocNo
      FROM dbo.LoanPayment p
      LEFT JOIN dbo.NewPayment np ON np.PPaymentID = p.NewPaymentId
      LEFT JOIN dbo.ReceivedPayment rp ON rp.RPPaymentID = p.ReceivedPaymentId
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
// Core creation logic, extracted so other modules can sanction a loan
// programmatically (e.g. Fund Transfer auto-creates an Inter-Company loan
// the moment it approves a transfer between two different companies —
// see generalLedger.js's postFundTransferApproval) without going through
// req/res or duplicating this validation + ledger-head + EMI-schedule
// logic. Same field names as the route body; throws { status, message }
// on validation failure, matching the route's own error shape.
async function createLoanSanctionInternal(payload, createdBy) {
  const {
    loanType,
    loanDocNo,
    lenderCompanyId,
    lenderBankId,
    // Free-text bank name (e.g. from the Major/Minor bank picker) — a Bank
    // Loan's lender is an external bank, which has no id of its own in this
    // system. lenderBankId is kept accepted too, purely for backward
    // compatibility with any existing caller still sending an
    // AccountHeadMaster id directly (none do as of this change, but nothing
    // stops a future internal caller from doing so).
    lenderBankName,
    lenderBankAccountId,
    // Customer Loan's second direction — a customer as LENDER instead of
    // borrower. lenderCustomerBankName is descriptive only (which bank the
    // money actually came from) — the customer itself already gets a real
    // GL head via ensureLoanLedgerHead, same mechanism their Borrower role
    // already used.
    lenderCustomerId,
    lenderCustomerSource,
    lenderCustomerBankName,
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
    paymentMode,
    chequeLotId,
    chequeLotNumber,
    chequeNo,
    chequeDate,
    isPostDated,
    digitalRefNumber,
    // Demand Draft carries its own ref number + date, same as Cheque has
    // ChequeNo/ChequeDate, rather than sharing the single generic
    // digitalRefNumber field NEFT/RTGS use.
    demandDraftNo,
    demandDraftDate,
  } = payload;

  if (!loanType || !LOAN_TYPES.includes(loanType)) {
    throw Object.assign(new Error("loanType must be Inter-Company, Bank Loan, or Customer Loan"), { status: 400 });
  }
  const isCustomerLoan = loanType === "Customer Loan";
  const isBankLoan = loanType === "Bank Loan";
  // Customer Loan's second direction — a customer lending TO us, mirroring
  // Bank Loan's shape (external lender, we're the borrower) rather than the
  // original "we lend to a customer" direction. Inferred purely from
  // lenderCustomerId being sent, same convention isBankLoan already uses
  // for lenderBankId/lenderBankName.
  const isCustomerToCompany = isCustomerLoan && !!lenderCustomerId;
  const custSource = borrowerCustomerSource === "CRM" ? "CRM" : "AH";
  const lenderCustSource = lenderCustomerSource === "CRM" ? "CRM" : "AH";
  const useInterest = hasInterest !== false && hasInterest !== "false";
  const iType = INTEREST_TYPES.includes(interestType) ? interestType : "CI";

  if (isBankLoan && !lenderBankId && !String(lenderBankName || "").trim()) {
    throw Object.assign(new Error("Lender bank name is required"), { status: 400 });
  }
  if (isCustomerToCompany) {
    if (!borrowerCompanyId) throw Object.assign(new Error("Borrower company is required"), { status: 400 });
  } else {
    if (!isBankLoan && !lenderCompanyId) throw Object.assign(new Error("Lender company is required"), { status: 400 });
    if (isCustomerLoan && !borrowerCustomerId) {
      throw Object.assign(new Error("Borrower customer is required"), { status: 400 });
    }
    if (!isCustomerLoan && !borrowerCompanyId) {
      throw Object.assign(new Error("Borrower company is required"), { status: 400 });
    }
  }
  if (!loanDate) throw Object.assign(new Error("Loan date is required"), { status: 400 });
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) throw Object.assign(new Error("Amount must be greater than 0"), { status: 400 });
  // The UI's number inputs strip the minus sign (can't type a negative
  // through them), but nothing stopped a negative/absurd value from a raw
  // API call — buildEmiSchedule's own guards (Math.max(1, ...) for tenure,
  // a <=0 rate falling to the flat/no-interest branch) keep a bad value
  // from corrupting the EMI schedule it generates, but the raw value still
  // gets persisted to LoanSanction.InterestRate/TenureMonths either way.
  if (interestRate != null && interestRate !== "" && parseFloat(interestRate) < 0) {
    throw Object.assign(new Error("Interest rate cannot be negative"), { status: 400 });
  }
  if (tenureMonths != null && tenureMonths !== "" && parseInt(tenureMonths, 10) <= 0) {
    throw Object.assign(new Error("Tenure must be at least 1 month"), { status: 400 });
  }

  const pool = getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    let lenderCompany = null;
    let lenderBank = null;
    let lenderCustomer = null;
    if (isBankLoan) {
      const trimmedBankName = String(lenderBankName || "").trim();
      if (trimmedBankName) {
        // The normal path — a free-typed/picked bank name, no pre-existing
        // account required. { id: null } here; the real GL head gets
        // resolved further down via ensureBankLoanLenderHead once we're
        // inside the transaction proper (that helper does its own lookups).
        lenderBank = { id: null, name: trimmedBankName };
      } else {
        // Back-compat only: an internal caller passing an existing
        // AccountHeadMaster id directly instead of a name.
        const bankRes = await new sql.Request(tx)
          .input("bankId", sql.Int, parseInt(lenderBankId, 10))
          .query("SELECT LHeadId AS id, LHeadName AS name FROM dbo.AccountHeadMaster WHERE LHeadId = @bankId");
        lenderBank = bankRes.recordset[0];
        if (!lenderBank) throw Object.assign(new Error("Lender bank not found"), { status: 400 });
      }
    } else if (isCustomerToCompany) {
      lenderCustomer = await resolveCustomerParty(tx, lenderCustomerId, lenderCustSource);
      if (!lenderCustomer) throw Object.assign(new Error("Lender customer not found"), { status: 400 });
    } else {
      const lenderRes = await new sql.Request(tx)
        .input("lenderId", sql.Int, parseInt(lenderCompanyId, 10))
        .query("SELECT id, name FROM dbo.enterprise WHERE business_type = 'C' AND id = @lenderId");
      lenderCompany = lenderRes.recordset[0];
      if (!lenderCompany) throw Object.assign(new Error("Lender company not found"), { status: 400 });
    }

    let borrowerCompany = null;
    let borrowerCustomer = null;
    if (isCustomerToCompany || !isCustomerLoan) {
      // Customer-to-Company direction, Bank Loan, and Inter-Company all
      // borrow into a company.
      const borrRes = await new sql.Request(tx)
        .input("borrowerId", sql.Int, parseInt(borrowerCompanyId, 10))
        .query("SELECT id, name FROM dbo.enterprise WHERE business_type = 'C' AND id = @borrowerId");
      borrowerCompany = borrRes.recordset[0];
      if (!borrowerCompany) throw Object.assign(new Error("Borrower company not found"), { status: 400 });
    } else {
      // The original Customer Loan direction — Company to Customer.
      borrowerCustomer = await resolveCustomerParty(tx, borrowerCustomerId, custSource);
      if (!borrowerCustomer) throw Object.assign(new Error("Borrower customer not found"), { status: 400 });
    }

    const effectiveRate = useInterest && interestRate != null && interestRate !== "" ? parseFloat(interestRate) : null;

    const insertResult = await new sql.Request(tx)
      .input("LoanNo", sql.NVarChar(50), "PENDING")
      .input("LoanType", sql.NVarChar(20), loanType)
      .input("LoanDocNo", sql.NVarChar(100), loanDocNo || null)
      .input("LenderCompanyId", sql.Int, lenderCompany ? lenderCompany.id : null)
      .input("LenderBankId", sql.Int, lenderBank ? lenderBank.id : null)
      .input("LenderBankAccountId", sql.Int, lenderBankAccountId ? parseInt(lenderBankAccountId, 10) : null)
      .input("LenderCustomerId", sql.Int, lenderCustomer ? lenderCustomer.custId : null)
      .input("LenderCustomerSource", sql.NVarChar(10), lenderCustomer ? lenderCustSource : null)
      .input("LenderCustomerBankName", sql.NVarChar(200), lenderCustomer ? String(lenderCustomerBankName || "").trim() || null : null)
      .input("BorrowerCompanyId", sql.Int, borrowerCompany ? borrowerCompany.id : null)
      .input("BorrowerCustomerId", sql.Int, borrowerCustomer ? borrowerCustomer.custId : null)
      .input("BorrowerCustomerSource", sql.NVarChar(10), borrowerCustomer ? custSource : null)
      .input("BorrowerBankAccountId", sql.Int, borrowerBankAccountId ? parseInt(borrowerBankAccountId, 10) : null)
      .input("LoanDate", sql.Date, loanDate)
      .input("Amount", sql.Decimal(18, 2), amt)
      .input("HasInterest", sql.Bit, useInterest ? 1 : 0)
      .input("InterestType", sql.NVarChar(10), iType)
      .input("InterestRate", sql.Decimal(5, 2), effectiveRate)
      .input("TenureMonths", sql.Int, tenureMonths != null && tenureMonths !== "" ? parseInt(tenureMonths, 10) : null)
      .input("Purpose", sql.NVarChar(500), purpose || null)
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("PaymentMode", sql.NVarChar(30), paymentMode || null)
      .input("ChequeLotId", sql.Int, chequeLotId ? parseInt(chequeLotId, 10) : null)
      .input("ChequeLotNumber", sql.NVarChar(50), chequeLotNumber || null)
      .input("ChequeNo", sql.NVarChar(20), chequeNo || null)
      .input("ChequeDate", sql.Date, chequeDate || null)
      .input("IsPostDated", sql.Bit, isPostDated ? 1 : 0)
      .input("DigitalRefNumber", sql.NVarChar(100), digitalRefNumber || null)
      .input("DemandDraftNo", sql.NVarChar(30), demandDraftNo || null)
      .input("DemandDraftDate", sql.Date, demandDraftDate || null)
      .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
        INSERT INTO dbo.LoanSanction
          (LoanNo, LoanType, LoanDocNo, LenderCompanyId, LenderBankId, LenderBankAccountId,
           LenderCustomerId, LenderCustomerSource, LenderCustomerBankName,
           BorrowerCompanyId, BorrowerCustomerId,
           BorrowerCustomerSource, BorrowerBankAccountId, LoanDate, Amount, HasInterest, InterestType, InterestRate, TenureMonths,
           Purpose, Status, Remarks, PaymentMode, ChequeLotId, ChequeLotNumber, ChequeNo, ChequeDate, IsPostDated, DigitalRefNumber,
           DemandDraftNo, DemandDraftDate, CreatedBy, CreatedAt)
        OUTPUT INSERTED.LoanId
        VALUES
          (@LoanNo, @LoanType, @LoanDocNo, @LenderCompanyId, @LenderBankId, @LenderBankAccountId,
           @LenderCustomerId, @LenderCustomerSource, @LenderCustomerBankName,
           @BorrowerCompanyId, @BorrowerCustomerId,
           @BorrowerCustomerSource, @BorrowerBankAccountId, @LoanDate, @Amount, @HasInterest, @InterestType, @InterestRate, @TenureMonths,
           @Purpose, 'Sanctioned', @Remarks, @PaymentMode, @ChequeLotId, @ChequeLotNumber, @ChequeNo, @ChequeDate, @IsPostDated, @DigitalRefNumber,
           @DemandDraftNo, @DemandDraftDate, @CreatedBy, SYSDATETIME())
      `);
    const loanId = insertResult.recordset[0].LoanId;
    const loanNo = `LN-${String(loanId).padStart(6, "0")}`;

    const borrowerName = borrowerCompany ? borrowerCompany.name : borrowerCustomer.custName;
    const borrowerKeyPrefix = borrowerCompany ? "C" : custSource === "CRM" ? "CRMCUST" : "CUST";
    const borrowerKeyId = borrowerCompany ? borrowerCompany.id : borrowerCustomer.custId;

    // Bank Loan: get-or-create the external bank's own shadow liability
    // head (see ensureBankLoanLenderHead) — it has no pre-existing account
    // of its own the way one of our own registered banks would. Back-compat
    // path (lenderBank.id already set) skips straight to reusing that id,
    // for the rare internal caller still passing one directly. Customer-to-
    // Company reuses the exact same ensureLoanLedgerHead shadow-account
    // mechanism the customer's Borrower role already relies on — a customer
    // lending TO us needs the same kind of ledger head a customer borrowing
    // FROM us gets, just filling the lender slot instead.
    const lenderLHeadId = isBankLoan
      ? lenderBank.id ?? await ensureBankLoanLenderHead(pool, lenderBank.name, createdBy)
      : isCustomerToCompany
        ? await ensureLoanLedgerHead(pool, lenderCustSource === "CRM" ? "CRMCUST" : "CUST", lenderCustomer.custId, lenderCustomer.custName, createdBy)
        : await ensureLoanLedgerHead(pool, "C", lenderCompany.id, lenderCompany.name, createdBy);
    const borrowerLHeadId = await ensureLoanLedgerHead(pool, borrowerKeyPrefix, borrowerKeyId, borrowerName, createdBy);

    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .input("LoanNo", sql.NVarChar(50), loanNo)
      .input("LenderLHeadId", sql.Int, lenderLHeadId)
      .input("BorrowerLHeadId", sql.Int, borrowerLHeadId)
      // LenderBankId was only ever set at INSERT time for the back-compat
      // (pre-existing account) path — for a fresh free-text bank name it's
      // still null at this point, so backfill it here now that the shadow
      // head exists. Harmless no-op for the non-Bank-Loan types (already
      // NULL, stays NULL).
      .input("LenderBankId", sql.Int, isBankLoan ? lenderLHeadId : null).query(`
        UPDATE dbo.LoanSanction
        SET LoanNo = @LoanNo, LenderLHeadId = @LenderLHeadId, BorrowerLHeadId = @BorrowerLHeadId,
            LenderBankId = COALESCE(LenderBankId, @LenderBankId)
        WHERE LoanId = @LoanId
      `);

    // Borrower receives the loan as an available "on account" balance —
    // same CREDIT/DEBIT ledger the vendor on-account flow uses.
    const lenderName = isBankLoan ? lenderBank.name : isCustomerToCompany ? lenderCustomer.custName : lenderCompany.name;
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
      bumpCacheVersion("account-head-master"),
    ]);
    return { loanId, loanNo, lenderLHeadId, borrowerLHeadId };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

router.post("/", requirePageRight("loan-sanction", "create"), async (req, res) => {
  const createdBy = req.user?.email || req.user?.name || "system";
  try {
    const { loanId, loanNo } = await createLoanSanctionInternal(req.body, createdBy);

    // Disbursement is now always a deliberate, separate step — never
    // automatic at sanction time, for any loan type. Inter-Company used to
    // auto-post both sides of the disbursement right here the moment the
    // loan was sanctioned; that silently moved real money (and, via the
    // Payment page's "Loan EMIs" picker reusing this same disbursement's
    // bank/cheque for what should have been a separate repayment, caused a
    // duplicate-cheque data-entry bug — see fixDuplicateLoanDisbursementPayments.js).
    // Every loan — Inter-Company included — now sits Sanctioned and
    // undisbursed (glPosted always false) until someone explicitly posts
    // it: Finance > Payment's "Loan Disbursement" picker for Inter-Company,
    // or POST /:id/post-to-gl directly (still the only posting mechanism —
    // this route just no longer calls it automatically).
    res.status(201).json({ loanId, loanNo, glPosted: false, glError: null });
  } catch (err) {
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
      if (interestRate != null && interestRate !== "" && parseFloat(interestRate) < 0) {
        throw Object.assign(new Error("Interest rate cannot be negative"), { status: 400 });
      }
      if (tenureMonths != null && tenureMonths !== "" && parseInt(tenureMonths, 10) <= 0) {
        throw Object.assign(new Error("Tenure must be at least 1 month"), { status: 400 });
      }
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
            UPDATE dbo.OnAccountLedger
            SET Amount = @NewAmount
            WHERE RefType = 'Loan' AND RefId = @RefId AND TxnType = 'CREDIT'
              AND OAId = (
                SELECT MIN(OAId) FROM dbo.OnAccountLedger
                WHERE RefType = 'Loan' AND RefId = @RefId AND TxnType = 'CREDIT'
              )
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

    // Inter-Company loans sanctioned via the direct form auto-post two
    // separate company-scoped entries (see POST / above) instead of the
    // single combined JV the manual post-to-gl endpoint still produces for
    // Bank/Customer loans — read back whatever was actually posted, grouped
    // by company, rather than assuming the old single-JV shape.
    let postings = [];
    if (existingPost) {
      const linesRes = await pool.request().input("SrcId", sql.Int, loanId).query(`
        SELECT gle.CompanyId, gle.VoucherNo, gle.DebitAmount, gle.CreditAmount, gle.Narration,
               ah.LHeadId, ah.LHeadName, grp.Name AS GroupName,
               ent.name AS CompanyName
        FROM dbo.GeneralLedgerEntry gle
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
        LEFT JOIN dbo.AccountGroup grp ON grp.AGId = ah.LBelongsTo
        LEFT JOIN dbo.enterprise ent ON ent.id = gle.CompanyId
        WHERE gle.SourceType = 'LoanPosting' AND gle.SourceId = @SrcId AND gle.IsReversed = 0
        ORDER BY gle.CompanyId, gle.EntryId
      `);
      const byCompany = new Map();
      for (const r of linesRes.recordset) {
        const key = r.CompanyId ?? "none";
        if (!byCompany.has(key)) {
          byCompany.set(key, { companyId: r.CompanyId, companyName: r.CompanyName || null, voucherNo: r.VoucherNo, lines: [] });
        }
        byCompany.get(key).lines.push({
          lHeadId: r.LHeadId,
          lHeadName: r.LHeadName,
          groupName: r.GroupName,
          debit: Number(r.DebitAmount) || 0,
          credit: Number(r.CreditAmount) || 0,
          narration: r.Narration,
        });
      }
      postings = Array.from(byCompany.values());
    }

    // Repayments (see POST /:id/pay) each post their own two-sided entry,
    // one SourceId (=PaymentId) per payment — pull them all back in the
    // same company-grouped shape as the sanction posting above, so the UI
    // can render the loan's full posting history (sanction + every
    // repayment) the same way Payment.tsx shows an invoice's full payment
    // chain, not just the one-off sanction entry.
    const paymentsRes = await pool.request().input("LoanId", sql.Int, loanId).query(`
      SELECT PaymentId, PaymentRef, PaymentDate, PaymentType, TotalAmount
      FROM dbo.LoanPayment WHERE LoanId = @LoanId ORDER BY PaymentDate, PaymentId
    `);
    const repaymentPostings = [];
    for (const pmt of paymentsRes.recordset) {
      const repLinesRes = await pool.request().input("SrcId", sql.Int, pmt.PaymentId).query(`
        SELECT gle.CompanyId, gle.VoucherNo, gle.DebitAmount, gle.CreditAmount, gle.Narration,
               ah.LHeadId, ah.LHeadName, grp.Name AS GroupName,
               ent.name AS CompanyName
        FROM dbo.GeneralLedgerEntry gle
        LEFT JOIN dbo.AccountHeadMaster ah ON ah.LHeadId = gle.LHeadId
        LEFT JOIN dbo.AccountGroup grp ON grp.AGId = ah.LBelongsTo
        LEFT JOIN dbo.enterprise ent ON ent.id = gle.CompanyId
        WHERE gle.SourceType = 'LoanRepayment' AND gle.SourceId = @SrcId AND gle.IsReversed = 0
        ORDER BY gle.CompanyId, gle.EntryId
      `);
      if (!repLinesRes.recordset.length) continue; // Bank/Customer loan repayments don't post two-sided
      const byCo = new Map();
      for (const r of repLinesRes.recordset) {
        const key = r.CompanyId ?? "none";
        if (!byCo.has(key)) {
          byCo.set(key, { companyId: r.CompanyId, companyName: r.CompanyName || null, voucherNo: r.VoucherNo, lines: [] });
        }
        byCo.get(key).lines.push({
          lHeadId: r.LHeadId,
          lHeadName: r.LHeadName,
          groupName: r.GroupName,
          debit: Number(r.DebitAmount) || 0,
          credit: Number(r.CreditAmount) || 0,
          narration: r.Narration,
        });
      }
      repaymentPostings.push({
        paymentId: pmt.PaymentId,
        paymentRef: pmt.PaymentRef,
        paymentDate: pmt.PaymentDate,
        paymentType: pmt.PaymentType,
        amount: pmt.TotalAmount,
        postings: Array.from(byCo.values()),
      });
    }

    res.json({
      loanNo: loan.LoanNo,
      amount: loan.Amount,
      repaymentPostings,
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
      postings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:id/post-to-gl — post the loan sanction as a real JV, same
//    mechanism GRN/Payment use, so it shows up in Trial Balance ──────────
// Extracted so scripts/backfill tooling can call the exact same posting
// logic the route runs, rather than reimplementing it — see
// scripts/repostLoanToGL.js. Throws Object.assign(new Error(...), {status})
// on any guard failure, same convention as createLoanSanctionInternal.
async function postLoanToGLInternal(pool, loanId, userEmail) {
  const { postVoucher } = require("../services/generalLedger");

  const loanRes = await pool.request().input("LoanId", sql.Int, loanId).query(`
    SELECT LoanId, LoanNo, LoanType, LoanDate, Amount, LenderCompanyId, BorrowerCompanyId,
           LenderLHeadId, BorrowerLHeadId, LenderBankAccountId, BorrowerBankAccountId
    FROM dbo.LoanSanction WHERE LoanId = @LoanId
  `);
  if (!loanRes.recordset.length) throw Object.assign(new Error("Loan not found"), { status: 404 });
  const loan = loanRes.recordset[0];
  if (!loan.LenderLHeadId || !loan.BorrowerLHeadId) {
    throw Object.assign(new Error("This loan is missing its lender/borrower GL accounts — cannot post."), { status: 422 });
  }

  const alreadyPosted = await pool.request().input("SrcId", sql.Int, loanId).query(`
    SELECT TOP 1 EntryId FROM dbo.GeneralLedgerEntry WHERE SourceType = 'LoanPosting' AND SourceId = @SrcId AND IsReversed = 0
  `);
  if (alreadyPosted.recordset.length) {
    throw Object.assign(new Error("This loan has already been posted to GL."), { status: 409 });
  }

  // A Fund Transfer-originated Inter-Company loan already posted its own
  // combined bank-movement + lender/borrower legs at approval time (see
  // postFundTransferApproval in generalLedger.js) — posting again here
  // would double-count both loan heads' balances.
  const ftLinked = await pool.request().input("LoanId", sql.Int, loanId).query(`
    SELECT TOP 1 FTId FROM dbo.FundTransfer WHERE LinkedLoanId = @LoanId
  `);
  if (ftLinked.recordset.length) {
    throw Object.assign(new Error("This loan was created by a Fund Transfer, which already posted it to GL."), { status: 409 });
  }

  const amt = Number(loan.Amount);
  if (!amt || amt <= 0) throw Object.assign(new Error("Loan has no amount to post."), { status: 400 });

  // Inter-Company involves TWO of our own companies — each needs its own
  // book entry (Lender's books show the receivable, Borrower's books show
  // the payable), same two-voucher split POST / already does at creation
  // time. A single combined voucher tagged to only one company (the old
  // behavior here) left the other company's books with no entry at all —
  // permanently broken double-entry across the other company's books. Bank
  // Loan/Customer Loan only ever involve ONE of our own companies (the
  // other side is an external bank or customer), so those still get one
  // voucher.
  if (loan.LoanType === "Inter-Company") {
    if (!loan.LenderBankAccountId || !loan.BorrowerBankAccountId) {
      throw Object.assign(new Error("This Inter-Company loan is missing a Lender or Borrower Bank A/C — cannot post."), { status: 422 });
    }
    await postVoucher(pool, {
      voucherNo: loan.LoanNo,
      voucherDate: loan.LoanDate,
      sourceType: "LoanPosting",
      sourceId: loanId,
      companyId: loan.LenderCompanyId,
      createdBy: userEmail,
      legs: [
        { lHeadId: loan.BorrowerLHeadId, debit: amt, narration: `${loan.LoanNo} — inter-company loan receivable (funds sent)` },
        { lHeadId: loan.LenderBankAccountId, credit: amt, narration: `${loan.LoanNo} — loan disbursed` },
      ],
    });
    await postVoucher(pool, {
      voucherNo: loan.LoanNo,
      voucherDate: loan.LoanDate,
      sourceType: "LoanPosting",
      sourceId: loanId,
      companyId: loan.BorrowerCompanyId,
      createdBy: userEmail,
      legs: [
        { lHeadId: loan.BorrowerBankAccountId, debit: amt, narration: `${loan.LoanNo} — loan received` },
        { lHeadId: loan.LenderLHeadId, credit: amt, narration: `${loan.LoanNo} — inter-company loan payable (funds received)` },
      ],
    });
  } else {
    // Dr the borrower's Loan ledger (they now owe this — a receivable from
    // the sanctioning side), Cr the lender's Loan ledger (funds went out).
    const lines = [
      { LHeadId: loan.BorrowerLHeadId, DebitAmount: amt, CreditAmount: 0, Narration: `Loan Posting: ${loan.LoanNo} — Borrower` },
      { LHeadId: loan.LenderLHeadId, DebitAmount: 0, CreditAmount: amt, Narration: `Loan Posting: ${loan.LoanNo} — Lender` },
    ];
    await postVoucher(pool, {
      voucherNo: loan.LoanNo,
      // The loan's own date, not the date it happened to get posted —
      // matches the Inter-Company branch above, which already got this
      // right.
      voucherDate: loan.LoanDate,
      sourceType: "LoanPosting",
      sourceId: loanId,
      companyId: loan.LenderCompanyId || loan.BorrowerCompanyId || null,
      createdBy: userEmail,
      legs: lines.map((l) => ({ lHeadId: l.LHeadId, debit: l.DebitAmount, credit: l.CreditAmount, narration: l.Narration })),
    });
  }

  // BUG 9 FIX: stamp DisbursedAt when the GL posting confirms money moved.
  // Null until then; setting it here (and in the Inter-Company auto-post
  // path in POST / above) gives the loan a distinct disbursement moment
  // separate from its sanction date, enabling the "Given vs Received"
  // lifecycle distinction on the frontend. Uses the loan's own LoanDate,
  // not SYSDATETIME() — "Post to GL" can happen well after the real
  // disbursement (a legacy loan reposted today shouldn't show today as
  // its disbursement date).
  await pool.request()
    .input("LoanId", sql.Int, loanId)
    .input("LoanDate", sql.Date, loan.LoanDate)
    .query("UPDATE dbo.LoanSanction SET DisbursedAt = @LoanDate WHERE LoanId = @LoanId AND DisbursedAt IS NULL");

  await bumpCacheVersion("loan-sanction");
  return { voucherNo: loan.LoanNo };
}

router.post("/:id/post-to-gl", requirePageRight("loan-sanction", "edit"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });
  const userEmail = req.user?.email || req.user?.name || "system";
  try {
    const pool = getPool();
    const result = await postLoanToGLInternal(pool, loanId, userEmail);
    res.json({ voucherNo: result.voucherNo, message: "Loan posted to GL successfully." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /:id/disburse — Bank Loan / Customer Loan disbursement ───────────
// The deliberate counterpart to Inter-Company's POST /:id/post-to-gl, for
// the two loan types where the other side isn't one of our own companies.
// Unlike Inter-Company (which posts straight against a real bank head in
// one click, no separate document needed), these need an actual NewPayment
// (Customer Loan — money OUT to a customer) or ReceivedPayment (Bank Loan
// — money IN from an external bank) as the real bank-side record, the same
// way POST /:id/pay already requires for repayment. Callers create that
// payment first through the normal Payment/Received Payment form (so a
// real bank/cheque/reference gets captured), then call this with its id to
// link it and post the loan-ledger side.
router.post("/:id/disburse", requirePageRight("loan-sanction", "edit"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  const { newPaymentId, receivedPaymentId } = req.body;
  const userEmail = req.user?.email || req.user?.name || "system";
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();
    const loanRes = await pool.request().input("LoanId", sql.Int, loanId)
      .query("SELECT LoanId, LoanNo, LoanType, DisbursedAt, LenderCustomerId FROM dbo.LoanSanction WHERE LoanId = @LoanId");
    const loan = loanRes.recordset[0];
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    if (loan.LoanType === "Inter-Company") {
      return res.status(400).json({ error: "Inter-Company loans are disbursed via POST /:id/post-to-gl, not this route." });
    }
    if (loan.DisbursedAt) {
      return res.status(409).json({ error: "This loan has already been disbursed." });
    }

    // Customer Loan's "Customer to Company" direction (migration 402) is
    // money coming IN, same as Bank Loan — the ORIGINAL "Company to
    // Customer" direction is money going OUT. LenderCustomerId being set is
    // what tells the two apart (see isCustomerToCompany in
    // createLoanSanctionInternal).
    const isCustomerToCompanyLoan = loan.LoanType === "Customer Loan" && !!loan.LenderCustomerId;

    let paymentId, paymentType, paymentDate;
    if (loan.LoanType === "Customer Loan" && !isCustomerToCompanyLoan) {
      paymentId = Number.isFinite(parseInt(newPaymentId, 10)) ? parseInt(newPaymentId, 10) : null;
      if (!paymentId) return res.status(400).json({ error: "newPaymentId is required to disburse a Customer Loan (money going out)." });
      const npRes = await pool.request().input("Id", sql.Int, paymentId)
        .query("SELECT PPaymentID, PDate, DocNo FROM dbo.NewPayment WHERE PPaymentID = @Id");
      if (!npRes.recordset.length) return res.status(404).json({ error: "That payment was not found." });
      paymentType = "NewPayment";
      paymentDate = npRes.recordset[0].PDate;
    } else if (loan.LoanType === "Bank Loan" || isCustomerToCompanyLoan) {
      paymentId = Number.isFinite(parseInt(receivedPaymentId, 10)) ? parseInt(receivedPaymentId, 10) : null;
      if (!paymentId) return res.status(400).json({ error: "receivedPaymentId is required to disburse this loan (money coming in)." });
      const rpRes = await pool.request().input("Id", sql.Int, paymentId)
        .query("SELECT RPPaymentID, RPDocDate, RPDocNo FROM dbo.ReceivedPayment WHERE RPPaymentID = @Id");
      if (!rpRes.recordset.length) return res.status(404).json({ error: "That received payment was not found." });
      paymentType = "ReceivedPayment";
      paymentDate = rpRes.recordset[0].RPDocDate;
    } else {
      return res.status(400).json({ error: `Unknown loan type: ${loan.LoanType}` });
    }

    // postLoanToGLInternal posts the loan-ledger legs (Dr borrower / Cr
    // lender against the "Loan - X" heads) and stamps DisbursedAt using the
    // loan's own LoanDate — same mechanism Inter-Company's post-to-gl uses,
    // just reached from this route for these two types instead.
    const result = await postLoanToGLInternal(pool, loanId, userEmail);

    await pool.request()
      .input("LoanId", sql.Int, loanId)
      .input("PaymentId", sql.Int, paymentId)
      .input("PaymentType", sql.NVarChar(20), paymentType)
      .query(`
        UPDATE dbo.LoanSanction
        SET DisbursementPaymentId = @PaymentId, DisbursementPaymentType = @PaymentType
        WHERE LoanId = @LoanId
      `);

    await bumpCacheVersion("loan-sanction");
    res.json({ voucherNo: result.voucherNo, message: "Loan disbursement recorded and posted to GL." });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PUT /:id/emi/:emiId/pay — REMOVED. This let a single EMI (and, once it
// was the last one, the whole loan) be marked paid/Closed with no
// dbo.LoanPayment row and no payment mode/cheque/bank captured at all —
// exactly the "closed with no payment details" failure mode this file's own
// header comment says can't happen ("repaid... driven exclusively from the
// Payment page's Loan EMIs tab — the Loan Sanction page itself is
// read-only"). Confirmed unreachable from the UI (the EMI Schedule tab's
// paid/unpaid marker is a static icon, no click handler — see
// LoanSanction.tsx) and the only caller, loanSanctionApi.ts's
// toggleEmiPaid(), had zero call sites anywhere in src/. Removed rather
// than fixed in place: POST /:id/pay already is the one correct way to
// settle an EMI, and having a second path invites this bug to come back.

// Posts a Customer Loan repayment to GL — the single-sided counterpart to
// the Inter-Company two-sided posting below. A customer isn't one of our
// own companies, so there's no second set of books to post into: only the
// LENDER company's side is real. Dr the lender's bank account (cash
// actually received from the customer), Cr the customer's Loan ledger head
// (what they still owe shrinks).
// Returns { posted: true } on success, or { posted: false, reason } if a
// required field is missing so the caller can surface a clear warning
// rather than silently no-oping.
async function postCustomerLoanRepayment(pool, { loan, paymentId, paymentRef, paymentDate, principalInterestAmount, actor }) {
  if (!loan.LenderCompanyId || !loan.BorrowerLHeadId) {
    return { posted: false, reason: "Missing lender company or borrower GL head — GL not posted." };
  }
  if (!loan.LenderBankAccountId) {
    // BUG 7 FIX: Previously silently skipped. Now surfaces a reason so the
    // caller can warn the user that the repayment was recorded but GL was not
    // updated — they should tag a Lender Bank A/C on the loan to fix this.
    return { posted: false, reason: "No Lender Bank A/C is tagged on this loan — repayment recorded but GL not posted. Edit the loan and add a Lender Bank A/C to enable GL postings." };
  }
  const { postVoucher } = require("../services/generalLedger");
  await postVoucher(pool, {
    voucherNo: paymentRef,
    voucherDate: paymentDate,
    sourceType: "LoanRepayment",
    sourceId: paymentId,
    companyId: loan.LenderCompanyId,
    createdBy: actor,
    legs: [
      { lHeadId: loan.LenderBankAccountId, debit: principalInterestAmount, narration: `${paymentRef} — loan repayment received from ${loan.LoanNo}'s borrower` },
      { lHeadId: loan.BorrowerLHeadId, credit: principalInterestAmount, narration: `${paymentRef} — loan repayment (${loan.LoanNo})` },
    ],
  });
  return { posted: true };
}

// Posts a Bank Loan repayment to GL — the borrower company (us) pays the
// lending bank. Only our own (borrower) company's books are posted:
//   Dr  the bank's Loan ledger head (LenderLHeadId) — reduces what we owe
//   Cr  our bank account (BorrowerBankAccountId) — cash goes out to the bank
// BUG 2 FIX: Previously, Bank Loan repayments had NO GL posting at all.
// Returns { posted: true } or { posted: false, reason }.
async function postBankLoanRepayment(pool, { loan, paymentId, paymentRef, paymentDate, principalInterestAmount, actor }) {
  if (!loan.BorrowerCompanyId || !loan.LenderLHeadId) {
    return { posted: false, reason: "Missing borrower company or lender GL head — Bank Loan GL not posted." };
  }
  if (!loan.BorrowerBankAccountId) {
    return { posted: false, reason: "No Borrower Bank A/C is tagged on this loan — Bank Loan repayment recorded but GL not posted. Edit the loan and add a Borrower Bank A/C." };
  }
  const { postVoucher } = require("../services/generalLedger");
  await postVoucher(pool, {
    voucherNo: paymentRef,
    voucherDate: paymentDate,
    sourceType: "LoanRepayment",
    sourceId: paymentId,
    companyId: loan.BorrowerCompanyId,
    createdBy: actor,
    legs: [
      { lHeadId: loan.LenderLHeadId, debit: principalInterestAmount, narration: `${paymentRef} — bank loan repayment (${loan.LoanNo})` },
      { lHeadId: loan.BorrowerBankAccountId, credit: principalInterestAmount, narration: `${paymentRef} — bank loan repayment sent` },
    ],
  });
  return { posted: true };
}

// ── POST /:id/pay — flexible repayment: single EMI, multiple EMIs, or a
//    lump sum. Applies to every loan type.
//
// Body: { emiIds?: number[], lumpSumAmount?: number, lateFee?: number,
//         paymentDate, notes? }
// Exactly one of emiIds / lumpSumAmount is expected.
//
// Payoff validator: once the running total actually paid toward
// principal+interest reaches or exceeds the full schedule total AND every
// EMI row is marked paid, willClose becomes true. But this does NOT
// automatically close the loan (see CLOSURE FIX below) — it only signals
// readyToClose in the response so the UI can prompt the user to formally
// close via POST /:id/close. Any amount paid beyond what was owed is
// credited to the LENDER's own ledger as an on-account credit.
// Late fee is tracked separately and does NOT count toward the payoff
// total — it's an additional charge, not principal/interest.
router.post("/:id/pay", requirePageRight("loan-sanction", "edit"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  const { emiIds, lumpSumAmount, lateFee, paymentDate, notes, newPaymentId, receivedPaymentId } = req.body;
  const actor = req.user?.email || req.user?.name || "system";
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });

  // Exactly one of these is expected — the dbo.NewPayment row Finance >
  // Payment just created (money going OUT, see migration 340) or the
  // dbo.ReceivedPayment row Received Payment just created (money coming
  // IN — a Customer Loan repayment, migration 356). Links this LoanPayment
  // back to whichever one actually carries payment mode/cheque no./bank/
  // reference, so the loan's own Repayment History isn't blind to how it
  // was paid. Both optional: some callers (e.g. a future manual
  // settle-from-Loan-Sanction path) may not have either yet.
  const resolvedNewPaymentId = Number.isFinite(parseInt(newPaymentId, 10)) ? parseInt(newPaymentId, 10) : null;
  const resolvedReceivedPaymentId = Number.isFinite(parseInt(receivedPaymentId, 10)) ? parseInt(receivedPaymentId, 10) : null;

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
      .query(`
        SELECT LoanId, LoanNo, LoanType, Status, BorrowerLHeadId, LenderLHeadId,
               LenderCompanyId, BorrowerCompanyId, LenderBankAccountId, BorrowerBankAccountId,
               LenderCustomerId
        FROM dbo.LoanSanction WHERE LoanId = @LoanId
      `);
    const loan = loanRes.recordset[0];
    if (!loan) throw Object.assign(new Error("Loan not found"), { status: 404 });
    if (loan.Status === "Closed") {
      throw Object.assign(new Error("This loan is already closed."), { status: 409 });
    }

    // UPDLOCK+ROWLOCK — without it, two concurrent /:id/pay requests for
    // this loan both read the same unpaid EMIs under READ COMMITTED and
    // both proceed to mark them paid, double-recording the same repayment.
    // Taking the lock here serializes concurrent requests on this loan's
    // EMI rows; the second one blocks until the first commits, then sees
    // the now-paid rows and (via the AND IsPaid = 0 guard on the UPDATE
    // below, plus the rowsAffected check) fails loudly instead of quietly
    // double-paying.
    const allEmisRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT EMIId, EMIAmount, IsPaid FROM dbo.LoanEMISchedule WITH (UPDLOCK, ROWLOCK) WHERE LoanId = @LoanId ORDER BY InstallmentNo ASC");
    const allEmis = allEmisRes.recordset;
    const unpaidEmis = allEmis.filter((e) => !e.IsPaid);
    const totalScheduleAmount = allEmis.reduce((s, e) => s + Number(e.EMIAmount), 0);

    const alreadyPaidRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT ISNULL(SUM(PrincipalInterestAmount), 0) AS paid FROM dbo.LoanPayment WHERE LoanId = @LoanId AND IsReversed = 0");
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

    // Closure requires TWO conditions to be simultaneously true:
    //   1. The running total paid (across all LoanPayment rows) has reached or
    //      exceeded the full schedule amount (financial payoff).
    //   2. Every EMI row in LoanEMISchedule will be IsPaid = 1 after this
    //      payment applies — this payment must mark all remaining EMIs, not
    //      just some of them, even if the numeric total already matches.
    //      This prevents an edge case where a rounding excess or an out-of-order
    //      payment satisfies the numeric threshold while leaving installments
    //      technically open, creating a "Closed" loan with unpaid EMI rows.
    // For lump-sum early payoff, emisToUpdate is set to unpaidEmis (all
    // remaining), so allEmisAfterPayment will be 0 — correct closure.
    // For a partial EMI selection, some installments stay unpaid even if the
    // dollar total happens to match — correctly NOT closed.
    const emisToUpdateForCloseCheck = (isLumpSum && newTotalPaid >= totalScheduleAmount - 0.01)
      ? unpaidEmis.map((e) => e.EMIId)
      : emiIdsToMark;
    const remainingUnpaidAfterPayment = unpaidEmis.filter(
      (e) => !emisToUpdateForCloseCheck.includes(e.EMIId)
    ).length;
    const willClose = newTotalPaid >= totalScheduleAmount - 0.01 && remainingUnpaidAfterPayment === 0;
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
      .input("NewPaymentId", sql.Int, resolvedNewPaymentId)
      .input("ReceivedPaymentId", sql.Int, resolvedReceivedPaymentId)
      .input("CreatedBy", sql.NVarChar(150), actor).query(`
        INSERT INTO dbo.LoanPayment
          (LoanId, PaymentRef, PaymentDate, PaymentType, PrincipalInterestAmount, LateFee, TotalAmount, ExcessCredited, ClosedLoan, Notes, NewPaymentId, ReceivedPaymentId, CreatedBy)
        OUTPUT INSERTED.PaymentId
        VALUES
          (@LoanId, @PaymentRef, @PaymentDate, @PaymentType, @PrincipalInterestAmount, @LateFee, @TotalAmount, @ExcessCredited, @ClosedLoan, @Notes, @NewPaymentId, @ReceivedPaymentId, @CreatedBy)
      `);
    const paymentId = paymentInsert.recordset[0].PaymentId;

    // emisToUpdateForCloseCheck already contains the correct set: either all
    // remaining unpaid EMIs (lump-sum closure) or just the selected ones.
    const emisToUpdate = emisToUpdateForCloseCheck;
    for (const emiId of emisToUpdate) {
      const emiUpdateRes = await new sql.Request(tx)
        .input("EMIId", sql.Int, emiId)
        .input("PaymentId", sql.Int, paymentId)
        .input("PaidDate", sql.Date, paymentDate)
        .input("PaidBy", sql.NVarChar(150), actor).query(`
          UPDATE dbo.LoanEMISchedule
          SET IsPaid = 1, PaidDate = @PaidDate, PaidBy = @PaidBy, PaymentId = @PaymentId
          WHERE EMIId = @EMIId AND IsPaid = 0
        `);
      // Defense in depth alongside the UPDLOCK above — if this EMI was
      // somehow already paid by the time we get here, don't silently
      // record a second payment on top of it.
      if (!emiUpdateRes.rowsAffected[0]) {
        throw Object.assign(new Error("One of the selected EMIs was already paid by another request. Reload and try again."), { status: 409 });
      }
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
        .input("Notes", sql.NVarChar(500), `${paymentType} payment ${paymentRef} for ${loan.LoanNo}`)
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

    // CLOSURE FIX: Do NOT auto-close the loan here. Closing a loan is a
    // deliberate managerial action — it means the lender is satisfied the
    // debt is settled, NOC has been issued, and the account is formally
    // reconciled. That confirmation must come from a human, not from the
    // payment system reaching a number. willClose is kept as a HINT only
    // so the response can tell the UI "all EMIs are paid — prompt the user
    // to formally close". The actual close happens via POST /:id/close.

    await tx.commit();
    await Promise.all([
      bumpCacheVersion("loan-sanction"),
      bumpCacheVersion("on-account"),
      bumpCacheVersion("account-head-master"),
    ]);

    // Inter-Company: repayment reverses the sanction-time cash movement —
    // same two company-scoped legs, flipped. Borrower's books debit the
    // Lender's counterparty head (paying down what's owed) and credit
    // their own bank; Lender's books debit their own bank (cash back in)
    // and credit the Borrower's counterparty head (receivable shrinks).
    // Only the principal+interest portion moves the loan ledger — late fee
    // is a separate charge, same as the OnAccountLedger entries above.
    // Everything above this point is already committed (tx.commit() ran
    // above) — LoanPayment, the EMI IsPaid flags, and the OnAccountLedger
    // entries are real regardless of what happens next. GL posting from
    // here on is intentionally wrapped in its own try/catch, same pattern
    // as the Customer/Bank Loan branches below: a failure here becomes a
    // glPostingWarning on the response, never a 500. Letting it escape to
    // the outer catch used to call tx.rollback() on an already-committed
    // transaction (a silent no-op) and return 500 for a payment that had,
    // in fact, already succeeded — inviting a client retry that would
    // record the same repayment twice.
    let glPostingWarning = null;
    if (
      loan.LoanType === "Inter-Company" &&
      loan.LenderLHeadId && loan.BorrowerLHeadId &&
      loan.LenderCompanyId && loan.BorrowerCompanyId &&
      loan.LenderBankAccountId && loan.BorrowerBankAccountId
    ) {
      try {
        const { postVoucher } = require("../services/generalLedger");
        await postVoucher(pool, {
          voucherNo: paymentRef,
          voucherDate: paymentDate,
          sourceType: "LoanRepayment",
          sourceId: paymentId,
          companyId: loan.BorrowerCompanyId,
          createdBy: actor,
          legs: [
            { lHeadId: loan.LenderLHeadId, debit: principalInterestAmount, narration: `${paymentRef} — loan repayment (${loan.LoanNo})` },
            { lHeadId: loan.BorrowerBankAccountId, credit: principalInterestAmount, narration: `${paymentRef} — loan repayment sent` },
          ],
        });
        await postVoucher(pool, {
          voucherNo: paymentRef,
          voucherDate: paymentDate,
          sourceType: "LoanRepayment",
          sourceId: paymentId,
          companyId: loan.LenderCompanyId,
          createdBy: actor,
          legs: [
            { lHeadId: loan.LenderBankAccountId, debit: principalInterestAmount, narration: `${paymentRef} — loan repayment received` },
            { lHeadId: loan.BorrowerLHeadId, credit: principalInterestAmount, narration: `${paymentRef} — loan repayment (${loan.LoanNo})` },
          ],
        });
        await bumpCacheVersion("journal-voucher");
      } catch (glErr) {
        console.error("[loan-sanction] Inter-Company repayment GL posting failed after payment committed:", glErr.message);
        glPostingWarning = "Repayment was recorded, but posting it to the General Ledger failed. Retry from the loan's Posting tab.";
      }
    }

    // Customer Loan's ORIGINAL direction only (Company to Customer):
    // single-sided posting into the LENDER's (our) own books only — a
    // customer has no company books of its own to post the mirror leg
    // into. See postCustomerLoanRepayment above. The newer "Customer to
    // Company" direction (migration 402, LenderCustomerId set) is the
    // opposite shape — we're the BORROWER — and is handled by the Bank-
    // Loan-shaped branch below instead, since it's the identical posting:
    // Dr the lender's Loan ledger, Cr our own bank account.
    // BUG 7 FIX: the function now returns { posted, reason } so we can
    // surface a warning to the user when GL is skipped due to a missing bank
    // A/C tag, rather than silently no-oping. Also try/catch-wrapped for the
    // same post-commit reason as the Inter-Company branch above — postVoucher
    // itself can still throw (unbalanced legs, DB error), not just return
    // {posted:false} for the missing-bank-account precondition.
    const isCustomerToCompanyLoan = loan.LoanType === "Customer Loan" && !!loan.LenderCustomerId;
    if (loan.LoanType === "Customer Loan" && !isCustomerToCompanyLoan) {
      try {
        const glResult = await postCustomerLoanRepayment(pool, { loan, paymentId, paymentRef, paymentDate, principalInterestAmount, actor });
        if (glResult && glResult.posted) {
          await bumpCacheVersion("journal-voucher");
        } else if (glResult && !glResult.posted) {
          glPostingWarning = glResult.reason;
        }
      } catch (glErr) {
        console.error("[loan-sanction] Customer Loan repayment GL posting failed after payment committed:", glErr.message);
        glPostingWarning = "Repayment was recorded, but posting it to the General Ledger failed. Retry from the loan's Posting tab.";
      }
    }

    // Bank Loan, and Customer Loan's "Customer to Company" direction:
    // posting into the BORROWER (our) company's books only — the external
    // lender (bank or customer) has no ledger in our system to post the
    // mirror leg into. Same shape either way: Dr the lender's Loan ledger
    // head, Cr our own bank account — postBankLoanRepayment already reads
    // only generic loan fields, so it applies unchanged to both.
    // BUG 2 FIX: Bank Loan repayments now post to GL.
    if (loan.LoanType === "Bank Loan" || isCustomerToCompanyLoan) {
      try {
        const glResult = await postBankLoanRepayment(pool, { loan, paymentId, paymentRef, paymentDate, principalInterestAmount, actor });
        if (glResult && glResult.posted) {
          await bumpCacheVersion("journal-voucher");
        } else if (glResult && !glResult.posted) {
          glPostingWarning = glResult.reason;
        }
      } catch (glErr) {
        console.error("[loan-sanction] Bank Loan repayment GL posting failed after payment committed:", glErr.message);
        glPostingWarning = "Repayment was recorded, but posting it to the General Ledger failed. Retry from the loan's Posting tab.";
      }
    }

    res.status(201).json({
      paymentId,
      paymentRef,
      totalAmount,
      // loanClosed is always false now — closure requires an explicit POST
      // /:id/close call. readyToClose = true is the signal to the UI to
      // show the "Close Loan" button, not to close silently.
      loanClosed: false,
      readyToClose: willClose,
      excessCredited: excess,
      glPostingWarning,
    });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /:id/close — EXPLICIT loan closure ──────────────────────────────
// The only correct way to mark a loan as Closed. Requires:
//   1. All EMIs must be IsPaid = 1
//   2. The total paid via LoanPayment must equal or exceed the schedule total
// Sets Status = 'Closed', ClosedAt, ClosurePaymentId (last payment).
// This is a deliberate human action — it is NOT triggered automatically
// when the last payment is recorded (see CLOSURE FIX comment in POST /:id/pay).
router.post("/:id/close", requirePageRight("loan-sanction", "edit"), async (req, res) => {
  const loanId = parseInt(req.params.id, 10);
  const actor = req.user?.email || req.user?.name || "system";
  if (!Number.isFinite(loanId)) return res.status(400).json({ error: "Invalid id" });

  try {
    const pool = getPool();

    const loanRes = await pool.request().input("LoanId", sql.Int, loanId)
      .query("SELECT LoanId, LoanNo, Status FROM dbo.LoanSanction WHERE LoanId = @LoanId");
    const loan = loanRes.recordset[0];
    if (!loan) return res.status(404).json({ error: "Loan not found" });
    if (loan.Status === "Closed") return res.status(409).json({ error: "Loan is already closed." });

    // Verify all EMIs are paid
    const unpaidRes = await pool.request().input("LoanId", sql.Int, loanId)
      .query("SELECT COUNT(*) AS cnt FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId AND IsPaid = 0");
    if (unpaidRes.recordset[0].cnt > 0) {
      return res.status(409).json({
        error: `Cannot close loan — ${unpaidRes.recordset[0].cnt} installment(s) are still unpaid. Complete all repayments first.`,
      });
    }

    // Verify total paid >= total scheduled. A loan with no EMI schedule at
    // all (a simple transfer with no interest/tenure — see EMPTY_FORM's
    // "Inter-Company defaults to a simple transfer" comment on the
    // frontend) has scheduleSum = 0, which previously made totalSchedule
    // itself 0 — the check below then passed trivially even with
    // totalPaid = 0, letting a completely unpaid loan be closed. Falls
    // back to the loan's own Amount as the target when there's no
    // schedule to sum.
    const totalsRes = await pool.request().input("LoanId", sql.Int, loanId).query(`
      SELECT
        ISNULL((SELECT SUM(PrincipalInterestAmount) FROM dbo.LoanPayment WHERE LoanId = @LoanId AND IsReversed = 0), 0) AS totalPaid,
        (SELECT ISNULL(SUM(EMIAmount), 0) FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId) AS scheduleSum,
        (SELECT Amount FROM dbo.LoanSanction WHERE LoanId = @LoanId) AS loanAmount
    `);
    const { totalPaid, scheduleSum, loanAmount } = totalsRes.recordset[0];
    const totalSchedule = Number(scheduleSum) > 0 ? Number(scheduleSum) : Number(loanAmount);
    if (Number(totalPaid) < totalSchedule - 0.01) {
      return res.status(409).json({
        error: `Cannot close loan — total paid (₹${Number(totalPaid).toFixed(2)}) is less than total scheduled (₹${Number(totalSchedule).toFixed(2)}). Record the remaining payment first.`,
      });
    }

    // Find the last payment ID for ClosurePaymentId reference
    const lastPayRes = await pool.request().input("LoanId", sql.Int, loanId)
      .query("SELECT TOP 1 PaymentId FROM dbo.LoanPayment WHERE LoanId = @LoanId ORDER BY PaymentId DESC");
    const closurePaymentId = lastPayRes.recordset[0]?.PaymentId ?? null;

    await pool.request()
      .input("LoanId", sql.Int, loanId)
      .input("PaymentId", sql.Int, closurePaymentId)
      .input("Actor", sql.NVarChar(150), actor).query(`
        UPDATE dbo.LoanSanction
        SET Status = 'Closed',
            ClosedAt = SYSDATETIME(),
            ClosurePaymentId = @PaymentId,
            UpdatedBy = @Actor,
            UpdatedAt = SYSDATETIME()
        WHERE LoanId = @LoanId
      `);

    await bumpCacheVersion("loan-sanction");
    res.json({ success: true, message: `Loan ${loan.LoanNo} has been closed.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

    // Also guard against LoanPayment rows — a lump-sum partial payment may
    // exist without any individual EMI being IsPaid yet (e.g. first partial
    // payment just recorded). Deleting in that state silently erases real
    // financial history and de-syncs the borrower's On A/C balance.
    const paymentRowRes = await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("SELECT COUNT(*) AS cnt FROM dbo.LoanPayment WHERE LoanId = @LoanId");
    if (paymentRowRes.recordset[0].cnt > 0) {
      throw Object.assign(
        new Error("This loan has repayment transactions recorded and can't be deleted. Reverse those payments first."),
        { status: 409 },
      );
    }

    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("DELETE FROM dbo.LoanEMISchedule WHERE LoanId = @LoanId");

    // Previously skipped — left orphaned blob rows behind for every deleted
    // loan's attached agreement/sanction-letter documents.
    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("DELETE FROM dbo.LoanDocumentAttachments WHERE LoanId = @LoanId");

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

    // Reverse whatever GL this loan posted at sanction time (Inter-Company
    // auto-post at creation, or a manual POST /:id/post-to-gl) — previously
    // never called here, leaving GeneralLedgerEntry rows for a loan that no
    // longer exists permanently bloating Trial Balance with a ghost balance.
    const { reversePostingBySource } = require("../services/generalLedger");
    await reversePostingBySource(tx, "LoanPosting", loanId);

    await new sql.Request(tx)
      .input("LoanId", sql.Int, loanId)
      .query("DELETE FROM dbo.LoanSanction WHERE LoanId = @LoanId");

    await tx.commit();
    await Promise.all([
      bumpCacheVersion("loan-sanction"),
      bumpCacheVersion("on-account"),
      bumpCacheVersion("account-head-master"),
      bumpCacheVersion("journal-voucher"),
    ]);
    res.json({ success: true });
  } catch (err) {
    await tx.rollback().catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.createLoanSanctionInternal = createLoanSanctionInternal;
module.exports.postLoanToGLInternal = postLoanToGLInternal;
module.exports.postCustomerLoanRepayment = postCustomerLoanRepayment;
module.exports.postBankLoanRepayment = postBankLoanRepayment;
