-- Migration 299: On Account Adjustment — informational payment-mode column
-- on dbo.OnAccountLedger, and backfill of historical adjustments that were
-- posted through the old "Dummy Bank" synthetic-payment mechanism.
--
-- Context: routes/onAccount.js's POST /apply-adjustment used to fake an
-- on-account settlement as a real payment against a "Dummy Bank" ledger
-- account (dbo.NewPayment row, PBankID = the DUMMY-BANK head), which then
-- posted Dr <party> / Cr Dummy Bank through the normal payment-approval GL
-- path. That's accounting-wrong — no cash moves in an on-account
-- adjustment. It's now replaced with a direct voucher: Dr <party> / Cr
-- "Company On Account A/c" (see postOnAccountAdjustment in
-- services/generalLedger.js), no bank account involved.
--
-- This migration:
--   1. Adds OnAccountLedger.Mode (informational label only, never validated
--      against a real bank/cheque — see onAccount.js's comment on
--      VALID_OA_MODES).
--   2. Reverses every historical Dummy-Bank-routed adjustment's GL legs
--      (marks IsReversed=1 on the old NewPayment/Dummy-Bank voucher) and
--      posts the correct Dr <party> / Cr "Company On Account A/c" voucher
--      in its place, keyed by the SAME OnAccountLedger.OAId so it's
--      idempotent and matches what apply-adjustment now posts going
--      forward.
--
-- Safe to re-run: step 2's UPDATE only touches rows with IsReversed=0, and
-- the backfill INSERT is guarded by NOT EXISTS against SourceType=
-- 'OnAccountAdjustment' already covering that OAId.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.OnAccountLedger') AND name = 'Mode')
BEGIN
  ALTER TABLE dbo.OnAccountLedger ADD Mode NVARCHAR(30) NULL;
END
GO

-- ── Step 2a: reverse the old Dummy-Bank-routed GL legs ───────────────────────
UPDATE gle
SET gle.IsReversed = 1
FROM dbo.GeneralLedgerEntry gle
JOIN dbo.NewPayment np ON np.PPaymentID = gle.SourceId AND gle.SourceType = 'NewPayment'
JOIN dbo.AccountHeadMaster dummy ON dummy.LHeadId = np.PBankID AND dummy.LHeadCode = 'DUMMY-BANK'
WHERE np.PDocType = 'On Account Adjustment'
  AND np.PLinkedOAId IS NOT NULL
  AND gle.IsReversed = 0;
GO

-- ── Step 2b: post the correct Dr <party> / Cr "Company On Account A/c" leg
--    for each historical adjustment, keyed by OAId (matches what
--    postOnAccountAdjustment posts going forward — SourceType=
--    'OnAccountAdjustment', SourceId=OAId). ──────────────────────────────────
DECLARE @OnAccountHeadId INT =
  (SELECT TOP 1 LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'Company On Account A/c' AND LHeadType = 'GL');

IF @OnAccountHeadId IS NOT NULL
BEGIN
  DECLARE @VoucherNo NVARCHAR(100), @OAId INT, @PartyId INT, @Amount DECIMAL(18,2),
          @RefDocNo NVARCHAR(100), @TxnDate DATE, @CompanyId INT, @ProjectId INT;

  DECLARE backfill_cursor CURSOR LOCAL FAST_FORWARD FOR
    SELECT oa.OAId, oa.PartyId, oa.Amount, oa.RefDocNo, oa.TxnDate, oa.CompanyId, oa.ProjectId
    FROM dbo.OnAccountLedger oa
    JOIN dbo.NewPayment np ON np.PLinkedOAId = oa.OAId
    JOIN dbo.AccountHeadMaster dummy ON dummy.LHeadId = np.PBankID AND dummy.LHeadCode = 'DUMMY-BANK'
    WHERE oa.TxnType = 'DEBIT' AND oa.RefType = 'Invoice'
      AND NOT EXISTS (
        SELECT 1 FROM dbo.GeneralLedgerEntry g
        WHERE g.SourceType = 'OnAccountAdjustment' AND g.SourceId = oa.OAId AND g.IsReversed = 0
      );

  OPEN backfill_cursor;
  FETCH NEXT FROM backfill_cursor INTO @OAId, @PartyId, @Amount, @RefDocNo, @TxnDate, @CompanyId, @ProjectId;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    SET @VoucherNo = CONCAT('OA-ADJ-', @RefDocNo, '-', @OAId, '-BACKFILL');

    INSERT INTO dbo.GeneralLedgerEntry
      (VoucherNo, VoucherDate, LHeadId, DebitAmount, CreditAmount, Narration, SourceType, SourceId, CompanyId, ProjectId)
    VALUES
      (@VoucherNo, @TxnDate, @PartyId, @Amount, 0, CONCAT(@VoucherNo, N' — On Account adjusted against invoice ', @RefDocNo, N' (backfilled)'), 'OnAccountAdjustment', @OAId, @CompanyId, @ProjectId);

    INSERT INTO dbo.GeneralLedgerEntry
      (VoucherNo, VoucherDate, LHeadId, DebitAmount, CreditAmount, Narration, SourceType, SourceId, CompanyId, ProjectId)
    VALUES
      (@VoucherNo, @TxnDate, @OnAccountHeadId, 0, @Amount, CONCAT(@VoucherNo, N' — On Account adjusted against invoice ', @RefDocNo, N' (backfilled)'), 'OnAccountAdjustment', @OAId, @CompanyId, @ProjectId);

    FETCH NEXT FROM backfill_cursor INTO @OAId, @PartyId, @Amount, @RefDocNo, @TxnDate, @CompanyId, @ProjectId;
  END
  CLOSE backfill_cursor;
  DEALLOCATE backfill_cursor;

  PRINT 'On Account Adjustment GL backfill complete.';
END
ELSE
  PRINT 'WARNING: "Company On Account A/c" GL head not found — backfill skipped. Run migration 178/230 first.';
GO

PRINT '299-on-account-ledger-mode-and-backfill applied successfully.';
GO
