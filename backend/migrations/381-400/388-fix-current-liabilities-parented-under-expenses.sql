-- Same bug shape as migration 387 (BANKS parented under Revenue), one level
-- higher up the tree: CURRENT LIABILITIES itself (Code 'CL') had
-- ParentGroupId pointing at EXPENSES (ROOT_IDS.EXPENSES = 4) instead of
-- LIABILITIES (ROOT_IDS.LIABILITIES = 1). Every descendant — Trade
-- Payables -> Sundry Creditors -> every supplier/contractor head — rolled
-- up to Expenses as a result, which is why the P&L's "Other Expenses"
-- section on production is actually a flat list of supplier names
-- (Arogan Infrastructure, Rafik Mondal, Bikash Agarwal, Matrix Cyber Zone,
-- Nu Vista Ltd, ...) rather than genuine expense heads.
--
-- Confirmed live on production:
--   AccountHeadMaster (Arogan Infrastructure Pvt Ltd, Rafik Mondal, ...)
--     -> LBelongsTo = SUNDRY CREDITORS (AGId 1168, Code SCS)
--     -> ParentGroupId = TRADE PAYABLES (AGId 1164, Code TP)
--     -> ParentGroupId = CURRENT LIABILITIES (AGId 5, Code CL)
--     -> ParentGroupId = 4 (EXPENSES root)  <-- the actual bug
--
-- ROOT_IDS 1-4 are trusted as stable across environments (hardcoded in
-- financialStatements.js/trialBalance.js, and seeded once as the very
-- first AccountGroup rows by migration 213a) — everything below that,
-- CURRENT LIABILITIES included, is matched by Code, never a hardcoded
-- mid-range AGId, since those diverge per environment (confirmed
-- repeatedly: BANKS is AGId 66 in dev vs 1173 in prod).

UPDATE dbo.AccountGroup
   SET ParentGroupId = 1
 WHERE Code = 'CL' AND Name = 'CURRENT LIABILITIES';

PRINT 'Reparented CURRENT LIABILITIES under LIABILITIES (root id 1) — Trade Payables/Sundry Creditors no longer roll up to Expenses.';
