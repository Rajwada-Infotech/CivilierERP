-- ============================================================
-- Migration: 230-trial-balance-on-account-connect.sql
--
-- Trial Balance reads exclusively from dbo.GeneralLedgerEntry, joined to
-- dbo.AccountHeadMaster via LBelongsTo (Account Group) — any head with a
-- NULL LBelongsTo is silently excluded from the report entirely (see
-- backend/routes/trialBalance.js: "WHERE ahm.LBelongsTo IS NOT NULL").
-- Two GL heads currently have no group and are invisible in Trial Balance:
--   - "Bank Charges"          -> belongs under Expenses > Other Expenses
--   - "Company On Account A/c" -> the natural home for supplier/contractor
--     on-account advances, which is a real balance (dbo.AccountHeadMaster.
--     OnAccountBalance / dbo.OnAccountLedger) that has never had a matching
--     GeneralLedgerEntry leg — the payment-approval flow that creates it
--     (backend/routes/newPayment.js) only ever writes OnAccountLedger, not
--     the GL. Rather than retrofitting that live approval flow (out of
--     scope / too risky to touch here), Trial Balance is being taught to
--     read AccountHeadMaster.OnAccountBalance directly for Supplier/
--     Contractor heads and surface it as its own column, so it's visible
--     without pretending it's a GL-derived figure. This migration just
--     gives the two orphaned heads somewhere to live so they render.
--
-- No new AccountGroup rows for "Bank Charges" (INDIRECT EXPENSES, AGId 42,
-- already exists). Adds one new group, "ADVANCES TO SUPPLIERS", as a
-- sibling of TRADE RECEIVABLES/BANKS under CURRENT ASSETS — an advance
-- paid to a supplier ahead of goods received is an asset, not a liability.
--
-- Safe to run multiple times (all operations guarded).
-- ============================================================

SET NOCOUNT ON;
GO

-- ── 1. Bank Charges -> INDIRECT EXPENSES (AGId 42) ──────────────────────────
UPDATE dbo.AccountHeadMaster
SET LBelongsTo = 42
WHERE LHeadName = 'Bank Charges' AND LHeadType = 'GL' AND LBelongsTo IS NULL;
GO

-- ── 2. New group: ADVANCES TO SUPPLIERS, under CURRENT ASSETS (AGId 14) ────
IF NOT EXISTS (SELECT 1 FROM dbo.AccountGroup WHERE Code = 'ATS')
BEGIN
    DECLARE @SystemUserId INT = (
        SELECT TOP 1 id FROM dbo.users WHERE role IN ('super_admin', 'admin') ORDER BY id
    );
    INSERT INTO dbo.AccountGroup (Name, Code, ParentGroupId, Status, CreatedBy, CreatedAt)
    VALUES ('ADVANCES TO SUPPLIERS', 'ATS', 14, 1, @SystemUserId, GETDATE());
    PRINT 'AccountGroup seeded: ADVANCES TO SUPPLIERS (ATS)';
END
ELSE
    PRINT 'AccountGroup ATS already exists — skipped.';
GO

-- ── 3. Company On Account A/c -> ADVANCES TO SUPPLIERS ──────────────────────
UPDATE ahm
SET ahm.LBelongsTo = ag.AGId
FROM dbo.AccountHeadMaster ahm
JOIN dbo.AccountGroup ag ON ag.Code = 'ATS'
WHERE ahm.LHeadName = 'Company On Account A/c'
  AND ahm.LHeadType = 'GL'
  AND ahm.LBelongsTo IS NULL;
GO

PRINT '================================================================';
PRINT '230-trial-balance-on-account-connect applied successfully.';
PRINT '================================================================';
GO
