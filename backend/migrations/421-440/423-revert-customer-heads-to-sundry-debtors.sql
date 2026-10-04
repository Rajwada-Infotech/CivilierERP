-- Migration 423: Revert Customer Master heads from Sundry Creditors back
-- to Sundry Debtors
--
-- Reverses migration 421. Customers stay Sundry Debtors, full stop — 421's
-- reclassification is no longer wanted. Same scope and reasoning as 421
-- itself, just the opposite direction: Trial Balance/Balance Sheet/P&L
-- classify a head purely by its AccountHeadMaster.LBelongsTo chain, so
-- reassigning every existing Customer head's LBelongsTo back to SUNDRY
-- DEBTORS moves all of their historical activity in every report at once.
--
-- Resolved by Code, not a hardcoded AGId — AGId is not stable across
-- dev/production for the same group.
--
-- Scope: every LHeadType='A' head, matching exactly what 421 itself
-- touched (its own WHERE clause had no further exclusion despite its
-- comment claiming one) — reverting anything narrower would leave some
-- heads 421 moved still sitting in the wrong group.

DECLARE @SundryDebtorsId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SDS');

IF @SundryDebtorsId IS NULL
BEGIN
  RAISERROR('Sundry Debtors (Code=SDS) AccountGroup not found', 16, 1);
  RETURN;
END
GO

DECLARE @SundryDebtorsId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SDS');

UPDATE dbo.AccountHeadMaster
  SET LBelongsTo = @SundryDebtorsId
  WHERE LHeadType = 'A' AND LBelongsTo <> @SundryDebtorsId;

PRINT CONCAT('423: moved ', @@ROWCOUNT, ' Customer Master head(s) back to Sundry Debtors.');
GO
