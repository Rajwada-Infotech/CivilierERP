const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, validate: false, message: { error: "Too many requests, please try again later." } }));
const { getPool, sql } = require("../db");
const authMiddleware = require("../middleware/auth");
const { requirePageRight } = require("../middleware/requirePageRight");
const { bumpCacheVersion } = require("../redis");

router.use(authMiddleware);

const LOAN_TYPES = ["Inter-Company", "Intra-Company", "Customer Loan"];

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

// Standard reducing-balance EMI. Falls back to a flat principal-only split
// (no interest) when no rate is given. Always generates at least 1
// installment (a tenure-less loan is treated as a single bullet payment).
function buildEmiSchedule(amount, annualRatePct, tenureMonths, startDate) {
  const n = Math.max(1, parseInt(tenureMonths, 10) || 1);
  const start = new Date(startDate);
  const rows = [];

  if (!annualRatePct || annualRatePct <= 0) {
    const flat = Math.round((amount / n) * 100) / 100;
    let allocated = 0;
    for (let i = 1; i <= n; i++) {
      const principal = i === n ? Math.round((amount - allocated) * 100) / 100 : flat;
      allocated += principal;
      const due = new Date(start);
      due.setMonth(due.getMonth() + i);
      rows.push({ installmentNo: i, dueDate: due, emiAmount: principal, principal, interest: 0 });
    }
    return rows;
  }

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
    const options = [
      ...ahRes.recordset.map((r) => ({ id: r.id, label: r.label, source: "AH", sourceLabel: "Customer Master" })),
      ...crmRes.recordset.map((r) => ({ id: r.id, label: r.label, source: "CRM", sourceLabel: "CRM Customer" })),
    ];
    res.json(options);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — list ──────────────────────────────────────────────────────────
router.get("/", requirePageRight("loan-sanction", "view"), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT
        ls.LoanId, ls.LoanNo, ls.LoanType,
        ls.LenderCompanyId, lc.name AS LenderCompanyName,
        ls.BorrowerCompanyId, bc.name AS BorrowerCompanyName,
        ls.BorrowerCustomerId, ls.BorrowerCustomerSource,
        COALESCE(cust_ah.LHeadName, cust_crm.CustomerName) AS BorrowerCustomerName,
        ls.LoanDate, ls.Amount, ls.InterestRate, ls.TenureMonths,
        ls.Purpose, ls.Status, ls.Remarks,
        ls.LenderLHeadId, ls.BorrowerLHeadId,
        ls.CreatedBy, ls.CreatedAt, ls.UpdatedBy, ls.UpdatedAt,
        (SELECT COUNT(*) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId) AS TotalEMIs,
        (SELECT COUNT(*) FROM dbo.LoanEMISchedule e WHERE e.LoanId = ls.LoanId AND e.IsPaid = 1) AS PaidEMIs
      FROM dbo.LoanSanction ls
      LEFT JOIN dbo.enterprise lc ON lc.id = ls.LenderCompanyId AND lc.business_type = 'C'
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster cust_ah ON cust_ah.LHeadId = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer cust_crm ON cust_crm.Id = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'CRM'
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
        bc.name AS BorrowerCompanyName,
        COALESCE(cust_ah.LHeadName, cust_crm.CustomerName) AS BorrowerCustomerName
      FROM dbo.LoanSanction ls
      LEFT JOIN dbo.enterprise lc ON lc.id = ls.LenderCompanyId AND lc.business_type = 'C'
      LEFT JOIN dbo.enterprise bc ON bc.id = ls.BorrowerCompanyId AND bc.business_type = 'C'
      LEFT JOIN dbo.AccountHeadMaster cust_ah ON cust_ah.LHeadId = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'AH'
      LEFT JOIN dbo.CrmCustomer cust_crm ON cust_crm.Id = ls.BorrowerCustomerId AND ls.BorrowerCustomerSource = 'CRM'
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
             IsPaid, PaidDate, PaidBy, CreatedAt
      FROM dbo.LoanEMISchedule
      WHERE LoanId = @id
      ORDER BY InstallmentNo ASC
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
    lenderCompanyId,
    borrowerCompanyId,
    borrowerCustomerId,
    borrowerCustomerSource,
    loanDate,
    amount,
    interestRate,
    tenureMonths,
    purpose,
    remarks,
  } = req.body;
  const createdBy = req.user?.email || req.user?.name || "system";

  if (!loanType || !LOAN_TYPES.includes(loanType)) {
    return res.status(400).json({ error: "loanType must be Inter-Company, Intra-Company, or Customer Loan" });
  }
  if (!lenderCompanyId) return res.status(400).json({ error: "Lender company is required" });
  const isCustomerLoan = loanType === "Customer Loan";
  const custSource = borrowerCustomerSource === "CRM" ? "CRM" : "AH";
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

    const lenderRes = await new sql.Request(tx)
      .input("lenderId", sql.Int, parseInt(lenderCompanyId, 10))
      .query("SELECT id, name FROM dbo.enterprise WHERE business_type = 'C' AND id = @lenderId");
    const lenderCompany = lenderRes.recordset[0];
    if (!lenderCompany) throw Object.assign(new Error("Lender company not found"), { status: 400 });

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

    const insertResult = await new sql.Request(tx)
      .input("LoanNo", sql.NVarChar(50), "PENDING")
      .input("LoanType", sql.NVarChar(20), loanType)
      .input("LenderCompanyId", sql.Int, lenderCompany.id)
      .input("BorrowerCompanyId", sql.Int, borrowerCompany ? borrowerCompany.id : null)
      .input("BorrowerCustomerId", sql.Int, borrowerCustomer ? borrowerCustomer.LHeadId : null)
      .input("LoanDate", sql.Date, loanDate)
      .input("Amount", sql.Decimal(18, 2), amt)
      .input("InterestRate", sql.Decimal(5, 2), interestRate != null && interestRate !== "" ? parseFloat(interestRate) : null)
      .input("TenureMonths", sql.Int, tenureMonths != null && tenureMonths !== "" ? parseInt(tenureMonths, 10) : null)
      .input("Purpose", sql.NVarChar(500), purpose || null)
      .input("Remarks", sql.NVarChar(500), remarks || null)
      .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
        INSERT INTO dbo.LoanSanction
          (LoanNo, LoanType, LenderCompanyId, BorrowerCompanyId, BorrowerCustomerId, LoanDate, Amount,
           InterestRate, TenureMonths, Purpose, Status, Remarks, CreatedBy, CreatedAt)
        OUTPUT INSERTED.LoanId
        VALUES
          (@LoanNo, @LoanType, @LenderCompanyId, @BorrowerCompanyId, @BorrowerCustomerId, @LoanDate, @Amount,
           @InterestRate, @TenureMonths, @Purpose, 'Sanctioned', @Remarks, @CreatedBy, SYSDATETIME())
      `);
    const loanId = insertResult.recordset[0].LoanId;
    const loanNo = `LN-${String(loanId).padStart(6, "0")}`;

    const borrowerName = borrowerCompany ? borrowerCompany.name : borrowerCustomer.LHeadName;
    const borrowerKeyPrefix = borrowerCompany ? "C" : "CUST";
    const borrowerKeyId = borrowerCompany ? borrowerCompany.id : borrowerCustomer.LHeadId;

    const lenderLHeadId = await ensureLoanLedgerHead(pool, "C", lenderCompany.id, lenderCompany.name, createdBy);
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
      .input("Notes", sql.NVarChar(500), `${loanType} loan sanctioned from ${lenderCompany.name}`)
      .input("CreatedBy", sql.NVarChar(150), createdBy).query(`
        INSERT INTO dbo.OnAccountLedger
          (PartyId, PartyType, TxnDate, TxnType, Amount, RefType, RefDocNo, RefId, CompanyId, Notes, CreatedBy)
        VALUES
          (@PartyId, @PartyType, @TxnDate, @TxnType, @Amount, @RefType, @RefDocNo, @RefId, @CompanyId, @Notes, @CreatedBy);
        UPDATE dbo.AccountHeadMaster
          SET OnAccountBalance = ISNULL(OnAccountBalance, 0) + @Amount
          WHERE LHeadId = @PartyId;
      `);

    const schedule = buildEmiSchedule(amt, parseFloat(interestRate) || 0, tenureMonths, loanDate);
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
