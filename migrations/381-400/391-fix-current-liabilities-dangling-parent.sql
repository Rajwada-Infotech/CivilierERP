-- Migration 388 hardcoded `SET ParentGroupId = 1` to mean "the LIABILITIES
-- root", following the app's own (wrong) hardcoded ROOT_IDS assumption. On
-- production AGId 1 doesn't exist at all — confirmed live via
-- `SELECT * FROM AccountGroup WHERE ParentGroupId IS NULL`, which lists the
-- real LIABILITIES root as AGId 4 (Code 'LTY'), with no row for AGId 1
-- anywhere. So 388 didn't just fail to fix the "Other Expenses" bug — it
-- pointed CURRENT LIABILITIES at nothing, making Trade Payables/Sundry
-- Creditors/every supplier invisible in every report instead of merely
-- misclassified. financialStatements.js's own ROOT_IDS is fixed in the same
-- change as this migration (resolved by Name at request time now, not
-- hardcoded) — this repairs the data damage that fix doesn't touch.
--
-- Matched by Name only this time, not Code (Code isn't reliable either —
-- dev's LIABILITIES is Code='L', production's is Code='LTY' for the same
-- group).

DECLARE @LiabilitiesId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'LIABILITIES' AND ParentGroupId IS NULL);

IF @LiabilitiesId IS NOT NULL
BEGIN
  UPDATE dbo.AccountGroup
     SET ParentGroupId = @LiabilitiesId
   WHERE Name = 'CURRENT LIABILITIES';
  PRINT 'Reparented CURRENT LIABILITIES under the real LIABILITIES root (AGId ' + CAST(@LiabilitiesId AS VARCHAR) + ').';
END
ELSE
  PRINT 'WARNING: No root "LIABILITIES" group found — CURRENT LIABILITIES left untouched. Investigate manually.';
