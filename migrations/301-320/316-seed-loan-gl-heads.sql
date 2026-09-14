-- Migration 316: system-generated GL heads for loan posting.
-- "Loan Receivable A/c" (staff/inter-company loans given out), "Loan Payable
-- A/c" (loans taken), and "Staff Loan A/c" (advances to employees specifically)
-- — all under LOANS AND ADVANCES (AGId 79), the same group the ad-hoc
-- per-counterparty "Loan - <Company>" heads already live under (LHeadType
-- 'LN'). Needed so the Loan Sanction module's posting logic (not yet built)
-- has fixed, name-lookup-able system accounts instead of a one-off head per
-- loan record.

DECLARE @LoansAndAdvances INT = (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'LNA');
DECLARE @SystemUserId NVARCHAR(300) = (
  SELECT TOP 1 u.email FROM dbo.users u
  JOIN dbo.Role r ON r.RId = u.RoleId
  WHERE r.RName IN ('super_admin', 'admin')
  ORDER BY u.id
);

DECLARE @Heads TABLE (HeadName NVARCHAR(200), HeadCode NVARCHAR(50));
INSERT INTO @Heads (HeadName, HeadCode) VALUES
  ('Loan Receivable A/c', 'LOAN-RCV'),
  ('Loan Payable A/c', 'LOAN-PAY'),
  ('Staff Loan A/c', 'LOAN-STAFF');

INSERT INTO dbo.AccountHeadMaster (
  LHeadName, LHeadAddress, LHeadType, LHeadContactPerson, LHeadStatus,
  LHeadPaymentTerms, LHeadCreditLimit, LBranchName, LGstType, LTDSDeduction,
  LCountry, CreatedBy, ApprovedBy, CreatedAt, ApprovedAt, isEdited, LHeadCode,
  Status, IsSystemGenerated, IsTdsApplicable, OnAccountBalance,
  TdsLimitApplicable, LBelongsTo
)
SELECT
  h.HeadName, 'N/A', 'LN', 'N/A', 1,
  NULL, 0, NULL, NULL, 0,
  NULL, @SystemUserId, @SystemUserId, GETDATE(), GETDATE(), 0, h.HeadCode,
  'Approved', 1, 0, 0,
  1, @LoansAndAdvances
FROM @Heads h
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadName = h.HeadName
);
GO

PRINT '316-seed-loan-gl-heads applied successfully.';
GO
