-- Migration 418: Make "Cash-in-Hand A/c" a real, selectable Bank
--
-- Migration 339 seeded "Cash-in-Hand A/c" as an LHeadType='GL' singleton —
-- an invisible fallback only used when a Cash payment carries no bank at
-- all (backend/services/generalLedger.js's getGLHeadId(GL_ACCOUNTS.
-- CASH_IN_HAND)). It was never selectable on the Payment page's own Bank
-- dropdown (that list is LHeadType='B' only), so a user could never tie a
-- cash payment to it explicitly — only ever hit it as an anonymous
-- system fallback.
--
-- This converts that SAME head to LHeadType='B' instead of seeding a
-- second, disconnected account — one ledger, not two. It's still resolved
-- by a stable LHeadCode ('CASH-IN-HAND'), the same sentinel-lookup
-- convention 'DUMMY-BANK' already uses, since getGLHeadId's generic
-- LHeadType='GL' filter can no longer find it once it's a Bank — see
-- services/generalLedger.js's new getCashInHandBankId().
-- src/pages/finance/Payment.tsx locks the Payment Mode to Cash the moment
-- this bank is picked.
--
-- LBelongsTo is set to the BANKS account group (resolved by Name, not a
-- hardcoded AGId — AGId is not stable across environments; see
-- backend/routes/financialStatements.js's resolveRootIds for the same
-- convention) so it rolls up under Assets -> Banks in Trial Balance and
-- Balance Sheet exactly like a real bank account.

-- An earlier version of this migration mistakenly seeded a brand-new,
-- disconnected "Cash in Hand" head instead of converting the existing one —
-- clean up that duplicate first (it was only ever run in local dev, never
-- shipped, and can't have any real GL activity against it yet).
IF EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Cash in Hand' AND LHeadType = 'B' AND LHeadCode = 'CASH-IN-HAND'
    AND NOT EXISTS (SELECT 1 FROM dbo.GeneralLedgerEntry gle WHERE gle.LHeadId = AccountHeadMaster.LHeadId)
)
BEGIN
  DELETE FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Cash in Hand' AND LHeadType = 'B' AND LHeadCode = 'CASH-IN-HAND'
    AND NOT EXISTS (SELECT 1 FROM dbo.GeneralLedgerEntry gle WHERE gle.LHeadId = AccountHeadMaster.LHeadId);
  PRINT 'Removed the mistakenly-duplicated Cash in Hand head';
END

IF EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = 'Cash-in-Hand A/c' AND LHeadType = 'GL')
BEGIN
  DECLARE @banksGroupId INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Name = 'BANKS');

  UPDATE dbo.AccountHeadMaster
    SET LHeadType = 'B',
        LHeadCode = 'CASH-IN-HAND',
        Status = 'Approved',
        LHeadStatus = 1,
        LBelongsTo = @banksGroupId,
        DisplayName = 'Cash in Hand'
  WHERE LHeadName = 'Cash-in-Hand A/c' AND LHeadType = 'GL';

  PRINT 'Converted Cash-in-Hand A/c to a selectable Bank (LHeadCode=CASH-IN-HAND)';
END
ELSE IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'CASH-IN-HAND')
BEGIN
  -- Defensive fallback for a DB where migration 339 never ran (shouldn't
  -- happen — 339 always runs before this one — but keeps this migration
  -- self-sufficient rather than silently doing nothing).
  DECLARE @banksGroupId2 INT = (SELECT TOP 1 AGId FROM dbo.AccountGroup WHERE Name = 'BANKS');

  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadAddress, LHeadType, LHeadContactPerson, LHeadCode,
     LHeadStatus, Status, LCountry, LHeadPaymentTerms, LHeadCreditLimit,
     LBelongsTo, DisplayName, LDescription, CreatedBy, CreatedAt)
  VALUES
    ('Cash-in-Hand A/c', 'N/A', 'B', 'System Admin', 'CASH-IN-HAND',
     1, 'Approved', 'India', 'N/A', 0,
     @banksGroupId2, 'Cash in Hand',
     'Physical cash-in-hand, selectable as a Bank on the Payment page. Not a real bank account — picking it locks the Payment Mode to Cash.',
     'migration', GETDATE());

  PRINT 'Seeded Cash in Hand bank ledger head (LHeadCode=CASH-IN-HAND)';
END
ELSE
  PRINT 'Cash in Hand bank ledger head already set up — skipping';
