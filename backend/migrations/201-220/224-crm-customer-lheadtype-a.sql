-- Fixes the root cause behind migrations 222/223: crmLedger.js's
-- ensureCrmCustomerLedgerHead() used to mint every CRM customer's ledger
-- head as LHeadType='C', colliding with 'C' meaning Contractor everywhere
-- else in this schema (accountHeadMaster.js, ContractorMaster.tsx). It now
-- mints new ones as LHeadType='A' (Customer) — this migration converts the
-- existing CRMCUST-prefixed rows to match, so they stop appearing in any
-- LHeadType='C' Contractor listing/report.
--
-- Group assignment is untouched — migration 223 already corrected these
-- rows to SUNDRY DEBTORS; this only fixes the type, not the group.
UPDATE dbo.AccountHeadMaster
SET LHeadType = 'A'
WHERE LHeadCode LIKE 'CRMCUST-%'
  AND LHeadType = 'C';

PRINT 'Converted ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' CRM customer head(s) from LHeadType=''C'' to ''A''.';
