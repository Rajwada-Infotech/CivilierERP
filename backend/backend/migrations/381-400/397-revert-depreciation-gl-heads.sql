-- Reverts migration 393 — removes the two GL heads it seeded
-- ("Depreciation Expense A/c" and "Accumulated Depreciation A/c") per
-- user request. Confirmed zero dbo.GeneralLedgerEntry rows reference
-- either head before writing this (no automated posting existed yet
-- to have created any), so a hard delete is safe — nothing else
-- references them.

DELETE FROM dbo.AccountHeadMaster
WHERE LHeadName IN ('Depreciation Expense A/c', 'Accumulated Depreciation A/c')
  AND LHeadType = 'GL'
  AND IsSystemGenerated = 1;

PRINT 'Removed Depreciation Expense A/c and Accumulated Depreciation A/c.';
