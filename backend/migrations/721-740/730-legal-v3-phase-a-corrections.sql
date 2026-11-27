-- Legal V3 phase A — corrections from the 3.0 specification (existing features kept):
--  1. Verification activities get a category (Record Search, Record Verification, Document Collection, Ownership
--     Investigation, Field Investigation, Legal Compliance, Court / Dispute Investigation) and four more finding
--     types (Clear, Document Missing, Further Investigation Required, Not Applicable); two more dates per activity
--     (government expected date, next action date).
--  2. Activity 11 (LA-ULC) is only the preliminary LA / ULC requirement assessment and document readiness; the
--     applications, queries, reports and clearances stay in the LA & ULC stage (no double processing).
--     Activity 16 is the post-registration mutation & conversion activity (stage Post-registration), which is why
--     the verification list has no 16.
--  3. Land Approval records the commercial decision: offered / negotiated / approved price, conditions, the
--     outstanding risks shown and the approver's risk acceptance (LegalLandApproval, one row per approval).
--  4. Enquiries: next action date and the reason of the last hold / rejection.
IF COL_LENGTH('dbo.LegalActivityTemplate', 'Category') IS NULL
  ALTER TABLE dbo.LegalActivityTemplate ADD Category NVARCHAR(40) NULL;
GO
UPDATE dbo.LegalActivityTemplate SET Category = CASE ActivityCode
  WHEN N'ONLINE-SEARCH' THEN N'Record Search' WHEN N'OFFLINE-SEARCH' THEN N'Record Search' WHEN N'BANGLA-BHUMI' THEN N'Record Search'
  WHEN N'RS-PANCHA' THEN N'Document Collection' WHEN N'PLOT-INFO' THEN N'Document Collection' WHEN N'CERTIFIED-COPY' THEN N'Document Collection' WHEN N'MOTHER-DEED-ORIGINAL' THEN N'Document Collection'
  WHEN N'OWNER-MATCH' THEN N'Record Verification' WHEN N'KHAJNA' THEN N'Record Verification'
  WHEN N'DEED-CHAIN' THEN N'Ownership Investigation' WHEN N'OWNERSHIP-FLOW' THEN N'Ownership Investigation' WHEN N'LEGAL-HEIR' THEN N'Ownership Investigation'
  WHEN N'MOUZA-MAP' THEN N'Field Investigation' WHEN N'LAND-SURVEY' THEN N'Field Investigation'
  WHEN N'COURT-SEARCH' THEN N'Court / Dispute Investigation'
  WHEN N'LA-ULC' THEN N'Legal Compliance' WHEN N'MUTATION-CONVERSION' THEN N'Legal Compliance'
  ELSE ISNULL(Category, N'Record Verification') END
WHERE Category IS NULL;
UPDATE dbo.LegalActivityTemplate SET ActivityName = N'LA / ULC requirement assessment and document readiness',
  Description = N'Decide whether LA and / or ULC clearance applies and that its documents are ready. The applications, queries, reports and clearances are handled in the LA & ULC stage.'
WHERE ActivityCode = N'LA-ULC' AND ActivityName = N'LA and ULC application and report receipt';
UPDATE dbo.LegalVerificationActivity SET ActivityName = N'LA / ULC requirement assessment and document readiness'
WHERE ActivityName = N'LA and ULC application and report receipt';
UPDATE dbo.LegalActivityTemplate SET Description = ISNULL(Description + N' · ', N'') + N'Post-registration activity (not part of legal verification, hence no 16 in the verification list).'
WHERE ActivityCode = N'MUTATION-CONVERSION' AND ISNULL(Description, N'') NOT LIKE N'%Post-registration activity%';
GO
IF COL_LENGTH('dbo.LegalVerificationActivity', 'GovtExpectedDate') IS NULL
  ALTER TABLE dbo.LegalVerificationActivity ADD GovtExpectedDate DATE NULL, NextActionDate DATE NULL;
GO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_LegalVerificationActivity_Finding')
  ALTER TABLE dbo.LegalVerificationActivity DROP CONSTRAINT CK_LegalVerificationActivity_Finding;
GO
ALTER TABLE dbo.LegalVerificationActivity ADD CONSTRAINT CK_LegalVerificationActivity_Finding CHECK (Finding IS NULL OR Finding IN (
  N'Clear', N'Found', N'Not Found', N'Not Found in Sources Searched', N'Incomplete', N'Records Not Available', N'Matched', N'Mismatched', N'Discrepancy Found',
  N'Document Missing', N'Additional Documents Required', N'Further Investigation Required', N'Unable to Verify', N'Case Found', N'Not Applicable'));
GO
IF OBJECT_ID('dbo.LegalLandApproval', 'U') IS NULL
  CREATE TABLE dbo.LegalLandApproval (
    ApprovalId INT IDENTITY(1,1) CONSTRAINT PK_LegalLandApproval PRIMARY KEY,
    LandId INT NOT NULL, EnquiryId INT NULL, VersionNo INT NULL, Decision NVARCHAR(20) NOT NULL,
    FinalReviewRef NVARCHAR(100) NULL, OfferedPrice DECIMAL(18,2) NULL, NegotiatedPrice DECIMAL(18,2) NULL, ApprovedPrice DECIMAL(18,2) NULL,
    Conditions NVARCHAR(2000) NULL, OutstandingRisks NVARCHAR(MAX) NULL, RiskAcceptance NVARCHAR(2000) NULL, Remarks NVARCHAR(1000) NULL,
    DecidedBy INT NULL, DecidedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLandApproval_At DEFAULT SYSUTCDATETIME());
GO
IF COL_LENGTH('dbo.LegalLandEnquiry', 'NextActionDate') IS NULL
  ALTER TABLE dbo.LegalLandEnquiry ADD NextActionDate DATE NULL, StatusReason NVARCHAR(500) NULL;
GO
