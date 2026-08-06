-- Migration: collapse ProposedDateByCompany/ProposedDateByCustomer into a
-- single ProposedDate + ProposedDateStatus pair on dbo.CrmAgreement.
--
-- Run this once, after deploying the new backend code (crmWorkflowGuards.js,
-- crmAgreements.js, crmPortal.js) but ideally in the same maintenance window,
-- since the old columns stop being read/written the moment the new code is
-- live. Review the backfill logic against your actual data before running
-- on production.
--
-- NOTE: no explicit BEGIN TRAN/COMMIT TRAN here. The migration runner
-- executes each GO-separated batch as its own request, so an explicit
-- transaction spanning a GO boundary leaves @@TRANCOUNT=1 at the end of the
-- first batch, which the mssql/tedious driver rejects outright before the
-- second batch (and its COMMIT) ever runs. Each batch below already commits
-- implicitly under SQL Server's autocommit mode, so no wrapper is needed.

-- 1. Add the new columns.
ALTER TABLE dbo.CrmAgreement ADD ProposedDate DATE NULL;
ALTER TABLE dbo.CrmAgreement ADD ProposedDateStatus NVARCHAR(30) NULL;
GO
-- The GO above is required, not optional: SQL Server resolves column names
-- for an entire batch at parse time, before any statement in it executes.
-- Without a batch break here, the UPDATE/SELECT below — which reference
-- ProposedDate/ProposedDateStatus — get validated against the pre-ALTER
-- schema and fail with "Invalid column name", even though the ALTER TABLE
-- itself succeeded. (This is what produced Msg 207 if you hit it.)

-- 2. Backfill from existing state. Three cases:
--    a) Both columns set and equal (already "matched" under the old logic,
--       which would already have flipped DateApprovalStatus to 'Pending' at
--       that point) -> ProposedDate = that date, status = 'Matched'.
--    b) Only company's column set -> ProposedDate = company's,
--       status = 'PendingCustomerReview' (waiting on customer).
--    c) Only customer's column set -> ProposedDate = customer's,
--       status = 'PendingCompanyReview' (waiting on company).
--    d) Neither set, or AgreementDate already confirmed -> leave both NULL;
--       AgreementDate itself is untouched by this migration either way.
UPDATE dbo.CrmAgreement
SET
  ProposedDate = CASE
    WHEN AgreementDate IS NOT NULL THEN NULL
    WHEN ProposedDateByCompany IS NOT NULL AND ProposedDateByCustomer IS NOT NULL THEN ProposedDateByCompany
    WHEN ProposedDateByCompany IS NOT NULL THEN ProposedDateByCompany
    WHEN ProposedDateByCustomer IS NOT NULL THEN ProposedDateByCustomer
    ELSE NULL
  END,
  ProposedDateStatus = CASE
    WHEN AgreementDate IS NOT NULL THEN NULL
    WHEN DateApprovalStatus = 'Pending' THEN 'Matched'
    WHEN ProposedDateByCompany IS NOT NULL AND ProposedDateByCustomer IS NOT NULL
         AND CAST(ProposedDateByCompany AS DATE) = CAST(ProposedDateByCustomer AS DATE) THEN 'Matched'
    WHEN ProposedDateByCompany IS NOT NULL THEN 'PendingCustomerReview'
    WHEN ProposedDateByCustomer IS NOT NULL THEN 'PendingCompanyReview'
    ELSE NULL
  END;

-- 3. Sanity check before dropping the old columns — review this result set;
--    it should be empty (or every row explainable) before proceeding.
SELECT Id, AgreementNo, AgreementDate, DateApprovalStatus,
       ProposedDateByCompany, ProposedDateByCustomer, ProposedDate, ProposedDateStatus
FROM dbo.CrmAgreement
WHERE (ProposedDateByCompany IS NOT NULL OR ProposedDateByCustomer IS NOT NULL)
  AND ProposedDate IS NULL AND AgreementDate IS NULL;

-- 4. Once verified, drop the old columns. Commented out on purpose — run
--    manually after confirming step 3's result set looks right.
-- ALTER TABLE dbo.CrmAgreement DROP COLUMN ProposedDateByCompany;
-- ALTER TABLE dbo.CrmAgreement DROP COLUMN ProposedDateByCustomer;
