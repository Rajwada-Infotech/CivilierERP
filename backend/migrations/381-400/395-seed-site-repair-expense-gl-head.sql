-- Migration 394 seeded "Repair Expense A/c" under INDIRECT EXPENSES only
-- (office/admin repairs). Per user follow-up, repair expense needs both a
-- Direct (site) and an Indirect (office) home -- this migration adds the
-- direct-side counterpart, named distinctly so the two don't collide in a
-- GL Account picker: "Site Repair Expense A/c".
--
-- Grouped under CONSTRUCTION EXPENSES -- confirmed to exist with the same
-- Name in both dev and production (unlike "Direct Expenses", which is a
-- custom umbrella group production has but dev doesn't), so a Name lookup
-- resolves consistently in either environment.

DECLARE @ConstructionExpensesGroupId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'CONSTRUCTION EXPENSES');

IF @ConstructionExpensesGroupId IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = 'Site Repair Expense A/c' AND LHeadType = 'GL')
  BEGIN
    INSERT INTO dbo.AccountHeadMaster
      (LHeadName, LHeadCode, LHeadType, LHeadStatus,
       LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
       LBranchName, LCountry, LBelongsTo, IsSystemGenerated)
    VALUES
      ('Site Repair Expense A/c', 'SREPEXP', 'GL', 1,
       'N/A', 'N/A', 'N/A',
       'Main', 'India', @ConstructionExpensesGroupId, 1);
    PRINT 'Seeded: Site Repair Expense A/c';
  END
  ELSE
  BEGIN
    UPDATE dbo.AccountHeadMaster
      SET IsSystemGenerated = 1, LBelongsTo = ISNULL(LBelongsTo, @ConstructionExpensesGroupId)
    WHERE LHeadName = 'Site Repair Expense A/c' AND LHeadType = 'GL';
    PRINT 'Already exists: Site Repair Expense A/c';
  END
END
ELSE
  PRINT 'WARNING: No "CONSTRUCTION EXPENSES" group found — Site Repair Expense A/c not seeded.';
GO
