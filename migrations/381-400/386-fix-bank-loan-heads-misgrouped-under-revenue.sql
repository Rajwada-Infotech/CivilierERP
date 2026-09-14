-- Production-only misclassification: a "Bank Loan" sanction posts its
-- disbursement/repayment legs straight to the lending bank's own
-- AccountHeadMaster row (LenderLHeadId — see backend/routes/loanSanction.js
-- and generalLedger.js) rather than a dedicated liability head, so that bank
-- head being grouped anywhere other than BANKS (Current Assets, matching
-- every other bank head in this chart of accounts) makes its loan-received
-- credit look like income in the P&L instead of a bank-balance movement —
-- exactly what showed up under "Other Income" in production (₹3.08Cr,
-- entirely bank-named heads plus "Company On Account A/c").
--
-- Confirmed correct destinations against the canonical seeded chart:
--   - Bank heads (LHeadType='B') belong under BANKS (Code 'BNK').
--   - "Company On Account A/c" belongs under ADVANCES TO SUPPLIERS
--     (Code 'ATS') per migration 230 — but that migration only backfilled
--     rows where LBelongsTo was NULL, so a row that already had some other
--     (wrong) group assigned before 230 ran was never touched.
--
-- Scoped to the exact head names confirmed live in production (case-
-- insensitive) rather than a broad heuristic sweep, and forces the
-- correction unconditionally since these are confirmed wrong, not just
-- possibly-unset.

DECLARE @BankGroupId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'BNK');
DECLARE @AdvancesGroupId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'ATS');

UPDATE dbo.AccountHeadMaster
   SET LBelongsTo = @BankGroupId
 WHERE LHeadType = 'B'
   AND @BankGroupId IS NOT NULL
   AND (
     UPPER(LTRIM(RTRIM(LHeadName))) IN (
       'UJJIVAN BANK LIMITED',
       'BANDHAN BANK LIMITED',
       'AXIS BANK LIMITED',
       'AXIS BANK LTD',
       'BANDHAN BANK LTD',
       'ICICI BANK',
       'DUMMY BANK (SYSTEM)'
     )
   );

UPDATE dbo.AccountHeadMaster
   SET LBelongsTo = @AdvancesGroupId
 WHERE LHeadType = 'GL'
   AND @AdvancesGroupId IS NOT NULL
   AND UPPER(LTRIM(RTRIM(LHeadName))) = 'COMPANY ON ACCOUNT A/C';

PRINT 'Reparented misgrouped bank/on-account heads out of Other Income and back to BANKS / ADVANCES TO SUPPLIERS.';
