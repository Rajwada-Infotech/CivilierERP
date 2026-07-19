-- Every Supplier (LHeadType='S') and Contractor (LHeadType='C') ledger head
-- now always belongs to SUNDRY CREDITORS (AccountGroup.Code='SCS') — matches
-- how Brokers already worked (see accountHeadMaster.js's
-- getSundryCreditorsGroupId, now also applied to S/C on create/update).
-- This backfills every existing row, old or new, overwriting whatever
-- group was previously (manually) assigned — Trial Balance excludes any
-- head with a NULL LBelongsTo, so this also brings the 6 currently-ungrouped
-- supplier/contractor heads into view there for the first time.
DECLARE @SundryCreditorsId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SCS');

IF @SundryCreditorsId IS NOT NULL
BEGIN
  UPDATE dbo.AccountHeadMaster
  SET LBelongsTo = @SundryCreditorsId
  WHERE LHeadType IN ('S', 'C')
    AND (LBelongsTo IS NULL OR LBelongsTo <> @SundryCreditorsId);

  PRINT 'Assigned ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' Supplier/Contractor head(s) to SUNDRY CREDITORS.';
END
ELSE
BEGIN
  PRINT 'SUNDRY CREDITORS account group (Code=SCS) not found — skipped.';
END
