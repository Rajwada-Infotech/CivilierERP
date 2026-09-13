-- Migration 421: Reclassify Customer Master heads from Sundry Debtors to
-- Sundry Creditors
--
-- Customer Master (CustomerMaster.tsx, LHeadType='A') used to have its
-- Account Group force-locked server-side to SUNDRY DEBTORS (Code='SDS') on
-- every create/update, regardless of what the client sent — see
-- accountHeadMaster.js. That lock is now open (the field is a normal
-- editable picker, defaulting new customers to SUNDRY CREDITORS,
-- Code='SCS').
--
-- Trial Balance, the Balance Sheet, and P&L all classify a head purely by
-- its AccountHeadMaster.LBelongsTo chain — a transaction itself carries no
-- independent classification, it's rolled up through whatever group its
-- head currently belongs to. Reassigning every existing Customer head's
-- LBelongsTo to SUNDRY CREDITORS is therefore sufficient to move ALL of
-- their historical activity in every report at once; there's no separate
-- per-transaction data to migrate.
--
-- Resolved by Code, not a hardcoded AGId — AGId is not stable across
-- dev/production for the same group (see the long comment at the top of
-- financialStatements.js).
--
-- Scope: only LHeadType='A' heads (Customer Master's own type). Does NOT
-- touch CRM's own customer-side ledger heads (crmLedger.js's
-- ensureCrmCustomerLedgerHead, also LHeadType='A' per migration 224) or
-- projectMaster.js's 'PRJ-<id>-CUST' project-customer heads (LHeadType='C')
-- — reclassifying those wasn't asked for and is a materially different,
-- separate flow from the standalone Customer Master page this migration is
-- scoped to. If CRM customer heads need the same treatment, that's a
-- distinct follow-up, not assumed here.

DECLARE @SundryCreditorsId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SCS');

IF @SundryCreditorsId IS NULL
BEGIN
  RAISERROR('Sundry Creditors (Code=SCS) AccountGroup not found', 16, 1);
  RETURN;
END
GO

DECLARE @SundryCreditorsId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Code = 'SCS');

UPDATE dbo.AccountHeadMaster
  SET LBelongsTo = @SundryCreditorsId
  WHERE LHeadType = 'A' AND LBelongsTo <> @SundryCreditorsId;

PRINT CONCAT('421: moved ', @@ROWCOUNT, ' Customer Master head(s) to Sundry Creditors.');
GO
