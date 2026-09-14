-- Every Bank (LHeadType='B') ledger head now always belongs to BANKS
-- (ASSETS > CURRENT ASSETS > BANKS, Code='BNK') — matches how
-- Suppliers/Contractors -> Sundry Creditors and Customers -> Sundry
-- Debtors already work (see bankMaster.js's getBanksGroupId, now applied
-- server-side on create/update). Backfills every existing bank head, old
-- or new — most were sitting directly under the parent CURRENT ASSETS
-- group instead of the more specific BANKS leaf, and at least one had no
-- group at all.
DECLARE @BanksId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'BNK');

IF @BanksId IS NOT NULL
BEGIN
  UPDATE dbo.AccountHeadMaster
  SET LBelongsTo = @BanksId
  WHERE LHeadType = 'B'
    AND (LBelongsTo IS NULL OR LBelongsTo <> @BanksId);

  PRINT 'Assigned ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' Bank head(s) to BANKS.';
END
ELSE
BEGIN
  PRINT 'BANKS account group (Code=BNK) not found — skipped.';
END
