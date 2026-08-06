-- Migration 290: backfill ProposedDate/ProposedDateStatus and retire the
-- old ProposedDateByCompany/ProposedDateByCustomer columns on dbo.CrmAgreement.
--
-- Context: migration 289 already added ProposedDate + ProposedDateStatus
-- (confirmed via INFORMATION_SCHEMA.COLUMNS — all 6 columns exist on this DB).
-- This migration does NOT re-add columns. It only (re-)runs the backfill
-- idempotently — safe even if 289's UPDATE already ran, partially ran, or
-- never ran — then verifies, then drops the two legacy columns.
--
-- Run steps 1-2, inspect the step-2 result set, THEN uncomment step 3 and
-- run it separately once you're satisfied nothing needs the old columns.

BEGIN TRAN;

-- 1. Idempotent backfill. Only touches rows where ProposedDate is still
--    NULL but one of the legacy columns has data — so re-running this is
--    always safe and never clobbers a row already migrated or already
--    live under the new single-field flow.
UPDATE dbo.CrmAgreement
SET
  ProposedDate = CASE
    WHEN ProposedDateByCompany IS NOT NULL AND ProposedDateByCustomer IS NOT NULL THEN ProposedDateByCompany
    WHEN ProposedDateByCompany IS NOT NULL THEN ProposedDateByCompany
    WHEN ProposedDateByCustomer IS NOT NULL THEN ProposedDateByCustomer
    ELSE ProposedDate
  END,
  ProposedDateStatus = CASE
    WHEN DateApprovalStatus = 'Pending' THEN 'Matched'
    WHEN ProposedDateByCompany IS NOT NULL AND ProposedDateByCustomer IS NOT NULL
         AND CAST(ProposedDateByCompany AS DATE) = CAST(ProposedDateByCustomer AS DATE) THEN 'Matched'
    WHEN ProposedDateByCompany IS NOT NULL THEN 'PendingCustomerReview'
    WHEN ProposedDateByCustomer IS NOT NULL THEN 'PendingCompanyReview'
    ELSE ProposedDateStatus
  END
WHERE ProposedDate IS NULL
  AND AgreementDate IS NULL
  AND (ProposedDateByCompany IS NOT NULL OR ProposedDateByCustomer IS NOT NULL);

-- 2. Verify — this should return ZERO rows before you proceed to step 3.
--    Any row here means a legacy value exists that didn't make it into
--    ProposedDate/ProposedDateStatus; investigate before dropping columns.
SELECT Id, AgreementNo, AgreementDate, DateApprovalStatus,
       ProposedDateByCompany, ProposedDateByCustomer, ProposedDate, ProposedDateStatus
FROM dbo.CrmAgreement
WHERE (ProposedDateByCompany IS NOT NULL OR ProposedDateByCustomer IS NOT NULL)
  AND ProposedDate IS NULL
  AND AgreementDate IS NULL;

COMMIT TRAN;

-- 3. Drop legacy columns. Left commented on purpose — uncomment and run
--    as its own execution ONLY after step 2's result set is empty and
--    you've confirmed no other code path (reports, other migrations,
--    other branches) still reads ProposedDateByCompany/ProposedDateByCustomer.
-- BEGIN TRAN;
-- ALTER TABLE dbo.CrmAgreement DROP COLUMN ProposedDateByCompany;
-- ALTER TABLE dbo.CrmAgreement DROP COLUMN ProposedDateByCustomer;
-- COMMIT TRAN;