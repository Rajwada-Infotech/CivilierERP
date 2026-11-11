-- 652: Legal rule configuration + law reference library, and saved government-site fetch evidence.
-- The rules and law list below are reference lists (not sample data): each rule says how an automatic flag is graded
-- and whether it blocks processing; an admin changes them in Setup. They must be validated by a qualified West Bengal
-- property lawyer before being relied on. Safe to re-run.
IF OBJECT_ID('dbo.LegalRuleConfig', 'U') IS NULL
CREATE TABLE dbo.LegalRuleConfig (
  RuleId      INT IDENTITY(1,1) PRIMARY KEY,
  RuleKey     NVARCHAR(40) NOT NULL CONSTRAINT UQ_LegalRuleConfig_Key UNIQUE,
  RuleName    NVARCHAR(200) NOT NULL,
  RiskLevel   NVARCHAR(20) NOT NULL,
  IsBlocking  BIT NOT NULL CONSTRAINT DF_LegalRuleConfig_Block DEFAULT 0,
  LawRef      NVARCHAR(300) NULL,
  Notes       NVARCHAR(1000) NULL,
  LawyerValidated BIT NOT NULL CONSTRAINT DF_LegalRuleConfig_Valid DEFAULT 0,
  IsActive    BIT NOT NULL CONSTRAINT DF_LegalRuleConfig_Active DEFAULT 1,
  CreatedBy   INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalRuleConfig_At DEFAULT SYSUTCDATETIME(),
  UpdatedBy   INT NULL, UpdatedAt DATETIME2 NULL
);
GO
MERGE dbo.LegalRuleConfig AS t
USING (VALUES
  (N'stay_order',            N'Stay order / injunction on a court case',            N'Critical', 1),
  (N'restriction_prohibited',N'Restricted property: transfer prohibited',          N'Critical', 1),
  (N'open_case',             N'Open court case not cleared by a legal officer',    N'High',     1),
  (N'restriction_pending',   N'Restricted property: permission not obtained',      N'High',     1),
  (N'attachment_order',      N'Attachment order in force',                          N'High',     1),
  (N'inheritance_dispute',   N'Inheritance dispute pending',                         N'High',     0),
  (N'seller_no_authority',   N'Seller has no legal authority to sell',               N'High',     0),
  (N'consent_missing',       N'Not all owners have consented',                       N'High',     0),
  (N'area_disputed',         N'A due diligence area is disputed',                    N'High',     0),
  (N'open_loan',             N'Loan / mortgage not closed',                          N'Medium',   0),
  (N'share_mismatch',        N'Current owners'' shares do not add up to 100%',       N'Medium',   0),
  (N'no_owner',              N'No current owner recorded',                           N'Medium',   0),
  (N'title_gap',             N'Ownership transfer without a document copy',          N'Medium',   0),
  (N'no_documents',          N'No legal document uploaded',                          N'Medium',   0),
  (N'doc_expired',           N'A document is past its validity',                     N'Medium',   0),
  (N'seller_id',             N'Seller identity not verified',                        N'Medium',   0),
  (N'consent_pending',       N'Owners'' consent not confirmed',                      N'Medium',   0),
  (N'area_incomplete',       N'A due diligence area is incomplete / needs legal review', N'Medium', 0)
) AS s (RuleKey, RuleName, RiskLevel, IsBlocking) ON t.RuleKey = s.RuleKey
WHEN NOT MATCHED THEN INSERT (RuleKey, RuleName, RiskLevel, IsBlocking) VALUES (s.RuleKey, s.RuleName, s.RiskLevel, s.IsBlocking);
GO
IF OBJECT_ID('dbo.LegalLawReference', 'U') IS NULL
CREATE TABLE dbo.LegalLawReference (
  LawId        INT IDENTITY(1,1) PRIMARY KEY,
  ActName      NVARCHAR(200) NOT NULL CONSTRAINT UQ_LegalLawReference_Act UNIQUE,
  Sections     NVARCHAR(500) NULL,
  Applicability NVARCHAR(1000) NULL,
  LastAmendedOn DATE NULL,
  SourceUrl    NVARCHAR(500) NULL,
  IsActive     BIT NOT NULL CONSTRAINT DF_LegalLawReference_Active DEFAULT 1,
  CreatedBy    INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalLawReference_At DEFAULT SYSUTCDATETIME(),
  UpdatedBy    INT NULL, UpdatedAt DATETIME2 NULL
);
GO
MERGE dbo.LegalLawReference AS t
USING (VALUES
  (N'Transfer of Property Act, 1882'), (N'Registration Act, 1908'), (N'Indian Stamp Act, 1899 (as applicable in West Bengal)'),
  (N'Hindu Succession Act, 1956'), (N'Muslim Personal Law (Shariat) Application Act, 1937'), (N'West Bengal Land Reforms Act, 1955'),
  (N'Waqf Act, 1995 (as amended)'), (N'Indian Easements Act, 1882'), (N'Land acquisition and ceiling legislation'), (N'West Bengal state rules, notifications and amendments')
) AS s (ActName) ON t.ActName = s.ActName
WHEN NOT MATCHED THEN INSERT (ActName) VALUES (s.ActName);
GO
IF OBJECT_ID('dbo.LegalPortalFetchLog', 'U') IS NULL
CREATE TABLE dbo.LegalPortalFetchLog (
  FetchId    INT IDENTITY(1,1) PRIMARY KEY,
  LandId     INT NOT NULL CONSTRAINT FK_LegalPortalFetchLog_Land REFERENCES dbo.LegalLand (LandId) ON DELETE CASCADE,
  LinkId     INT NULL,
  SiteName   NVARCHAR(200) NULL,
  SourceUrl  NVARCHAR(1000) NULL,
  Response   NVARCHAR(MAX) NULL,
  MatchResult NVARCHAR(40) NULL,
  Remarks    NVARCHAR(1000) NULL,
  FetchedBy  INT NULL,
  FetchedAt  DATETIME2 NOT NULL CONSTRAINT DF_LegalPortalFetchLog_At DEFAULT SYSUTCDATETIME()
);
GO
-- Menu right for Setup → Legal Rules / Law Reference Library.
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = N'legal-rule-master')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES (N'legal-rule-master', N'Legal Rules & Law Library', N'Legal', N'Legal Masters - Workflow', N'view,create,edit,delete,print,export', 160, 1, N'migration-652', SYSDATETIME());
