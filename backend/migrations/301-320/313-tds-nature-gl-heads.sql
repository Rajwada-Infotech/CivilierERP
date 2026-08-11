-- Migration 313: TDS nature-specific GL heads for invoice posting.
--
-- New invoice posting structure (per explicit spec):
--   Dr Expense Head(s)     (invoice total - TDS)
--   Cr Supplier/Creditor   (invoice total - TDS)
--   Dr TDS Nature A/c      TDS amount   <- NEW: one distinct GL head per
--                                          TDS Nature (194C/194J/194I/...),
--                                          not lumped into the Expense Head
--   Cr TDS Payable A/c     TDS amount
--
-- dbo.TDSMaster gets a GLHeadId FK so the posting code can resolve which
-- account to debit for a given TDS record's Nature.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.TDSMaster') AND name = 'GLHeadId'
)
BEGIN
  ALTER TABLE dbo.TDSMaster ADD GLHeadId INT NULL;
END
GO

-- One GL head per distinct Nature already in TDSMaster (194C covers two
-- rows at different rates — they share the same nature-level account).
DECLARE @IndirectExpenses INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'IE');
DECLARE @SystemUserId INT = (
  SELECT TOP 1 u.id FROM dbo.users u
  JOIN dbo.Role r ON r.RId = u.RoleId
  WHERE r.RName IN ('super_admin', 'admin')
  ORDER BY u.id
);

DECLARE @Nature NVARCHAR(20), @HeadName NVARCHAR(200), @HeadCode NVARCHAR(50), @NewHeadId INT;
DECLARE nature_cursor CURSOR LOCAL FOR
  SELECT DISTINCT Nature FROM dbo.TDSMaster WHERE Nature IS NOT NULL;
OPEN nature_cursor;
FETCH NEXT FROM nature_cursor INTO @Nature;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @HeadName = CONCAT('TDS ', @Nature, ' A/c');
  SET @HeadCode = CONCAT('TDS-', @Nature);
  SET @NewHeadId = NULL; -- must reset each loop — a SELECT that matches no
                          -- rows leaves the variable at its PREVIOUS value
                          -- in T-SQL, it does not implicitly NULL it out.

  SELECT @NewHeadId = LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = @HeadName AND LHeadType = 'GL';
  IF @NewHeadId IS NULL
  BEGIN
    INSERT INTO dbo.AccountHeadMaster (
      LHeadName, LHeadAddress, LHeadType, LHeadContactPerson, LHeadStatus,
      LHeadPaymentTerms, LHeadCreditLimit, LBranchName, LGstType, LTDSDeduction,
      LCountry, CreatedBy, CreatedAt, isEdited, LHeadCode, Status,
      IsSystemGenerated, IsTdsApplicable, OnAccountBalance, TdsLimitApplicable,
      LBelongsTo
    )
    VALUES (
      @HeadName, 'N/A', 'GL', 'N/A', 1,
      'N/A', 0, 'Main', 'Unregistered', 0,
      'India', @SystemUserId, GETDATE(), 0, @HeadCode, 'Draft',
      1, 0, 0, 1,
      @IndirectExpenses
    );
    SET @NewHeadId = SCOPE_IDENTITY();
  END

  UPDATE dbo.TDSMaster SET GLHeadId = @NewHeadId WHERE Nature = @Nature AND GLHeadId IS NULL;

  FETCH NEXT FROM nature_cursor INTO @Nature;
END
CLOSE nature_cursor;
DEALLOCATE nature_cursor;
GO

PRINT '313-tds-nature-gl-heads applied successfully.';
GO
