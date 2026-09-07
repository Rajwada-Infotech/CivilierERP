-- Seeds "Repair Expense A/c" as a system-generated GL account, selectable
-- like any other expense head when booking a repair-type invoice/expense.
-- Grouped under INDIRECT EXPENSES, alongside the existing "Bank Charges"
-- head — the established home for this kind of general operating expense
-- (not a direct/project cost). Looked up by Name, not a hardcoded AGId
-- (lesson from migrations 387-391 this session: group ids aren't stable
-- across environments, but unique group Names are).

DECLARE @IndirectExpensesGroupId INT = (SELECT AGId FROM dbo.AccountGroup WHERE Name = 'INDIRECT EXPENSES');

IF @IndirectExpensesGroupId IS NOT NULL
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = 'Repair Expense A/c' AND LHeadType = 'GL')
  BEGIN
    INSERT INTO dbo.AccountHeadMaster
      (LHeadName, LHeadCode, LHeadType, LHeadStatus,
       LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
       LBranchName, LCountry, LBelongsTo, IsSystemGenerated)
    VALUES
      ('Repair Expense A/c', 'REPEXP', 'GL', 1,
       'N/A', 'N/A', 'N/A',
       'Main', 'India', @IndirectExpensesGroupId, 1);
    PRINT 'Seeded: Repair Expense A/c';
  END
  ELSE
  BEGIN
    UPDATE dbo.AccountHeadMaster
      SET IsSystemGenerated = 1, LBelongsTo = ISNULL(LBelongsTo, @IndirectExpensesGroupId)
    WHERE LHeadName = 'Repair Expense A/c' AND LHeadType = 'GL';
    PRINT 'Already exists: Repair Expense A/c';
  END
END
ELSE
  PRINT 'WARNING: No "INDIRECT EXPENSES" group found — Repair Expense A/c not seeded.';
GO
