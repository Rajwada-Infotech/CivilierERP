-- 304-tds-workflow.sql
--
-- TDS deduction workflow — Invoice snapshot, Payment snapshot/inheritance,
-- and the "TDS Payable" system GL account the postings credit.
--
-- Prerequisites already in place (not touched here):
--   dbo.TDSMaster                          (TDSId, Nature, Name, Percentage, Status)
--   dbo.AccountHeadMaster.IsTdsApplicable  (migration 155 — Supplier/Contractor eligibility)

-- ── TDS Payable A/c — one shared system GL account for every deduction ──────
-- The chart of accounts already has a "TDS PAYABLE" AccountGroup (AGId 62,
-- under DUTY & TAXES) with no GL head under it yet — this is that head.
IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'TDSPAY')
BEGIN
  INSERT INTO dbo.AccountHeadMaster (
    LHeadName, LHeadAddress, LHeadType, LHeadContactPerson, LHeadStatus,
    LHeadPaymentTerms, LHeadCreditLimit, LBranchName, LBelongsTo,
    LGstType, LTDSDeduction, LCountry, LHeadCode, Status,
    IsSystemGenerated, IsTdsApplicable, OnAccountBalance
  )
  VALUES (
    'TDS Payable A/c', 'N/A', 'GL', 'N/A', 1,
    'N/A', 0, 'Main', 62,
    'Unregistered', 0, 'India', 'TDSPAY', 'Draft',
    1, 0, 0
  );
END
GO

-- ── ExpenseBooking — TDS snapshot (selected at invoice time, never re-derived) ──
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ExpenseBooking' AND COLUMN_NAME='TDSId')
BEGIN
  ALTER TABLE dbo.ExpenseBooking ADD
    TDSId         INT            NULL,
    TDSNature     NVARCHAR(200)  NULL,
    TDSName       NVARCHAR(200)  NULL,
    TDSPercentage DECIMAL(5,2)   NULL,
    TDSAmount     DECIMAL(18,2)  NULL DEFAULT 0;
END
GO

-- ── NewPayment — TDS snapshot (inherited from the linked invoice, or ──────────
-- selected directly for a no-invoice payment) ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='NewPayment' AND COLUMN_NAME='TDSId')
BEGIN
  ALTER TABLE dbo.NewPayment ADD
    TDSId         INT            NULL,
    TDSNature     NVARCHAR(200)  NULL,
    TDSName       NVARCHAR(200)  NULL,
    TDSPercentage DECIMAL(5,2)   NULL,
    TDSAmount     DECIMAL(18,2)  NULL DEFAULT 0;
END
GO
