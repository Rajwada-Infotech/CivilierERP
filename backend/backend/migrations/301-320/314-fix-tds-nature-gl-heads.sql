-- Migration 314: fix migration 313 — a T-SQL variable-reuse bug (a SELECT
-- matching no rows leaves the variable at its previous value instead of
-- NULL) meant every TDS Nature after the first (194C) silently reused
-- "TDS 194C A/c" instead of getting its own GL head. Reset the wrongly
-- shared links and (re)create one distinct head per Nature.

DECLARE @IndirectExpenses INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'IE');
DECLARE @SystemUserId INT = (
  SELECT TOP 1 u.id FROM dbo.users u
  JOIN dbo.Role r ON r.RId = u.RoleId
  WHERE r.RName IN ('super_admin', 'admin')
  ORDER BY u.id
);

-- Undo the wrong links (everything that isn't actually 194C but points at
-- the 194C head).
UPDATE dbo.TDSMaster
SET GLHeadId = NULL
WHERE Nature <> '194C'
  AND GLHeadId IN (SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'TDS 194C A/c');

DECLARE @Nature NVARCHAR(20), @HeadName NVARCHAR(200), @HeadCode NVARCHAR(50), @NewHeadId INT;
DECLARE nature_cursor CURSOR LOCAL FOR
  SELECT DISTINCT Nature FROM dbo.TDSMaster WHERE Nature IS NOT NULL AND GLHeadId IS NULL;
OPEN nature_cursor;
FETCH NEXT FROM nature_cursor INTO @Nature;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @HeadName = CONCAT('TDS ', @Nature, ' A/c');
  SET @HeadCode = CONCAT('TDS-', @Nature);
  SET @NewHeadId = NULL;

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

PRINT '314-fix-tds-nature-gl-heads applied successfully.';
GO
