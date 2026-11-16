-- 653: Succession share SUGGESTION (never a decision). Schema + a starter reference list of rules, all marked
-- NOT validated — a qualified West Bengal property lawyer must check each rule (Setup → Succession Rules) before it
-- is relied on. Suggestions are only shown for comparison; a Verifier / Legal Reviewer accepts or overrides them.
IF OBJECT_ID('dbo.LegalSuccessionRule', 'U') IS NULL
CREATE TABLE dbo.LegalSuccessionRule (
  RuleId          INT IDENTITY(1,1) PRIMARY KEY,
  Law             NVARCHAR(60) NOT NULL,
  HeirRole        NVARCHAR(60) NOT NULL,
  Condition       NVARCHAR(40) NOT NULL CONSTRAINT DF_LegalSuccessionRule_Cond DEFAULT N'Always',
  ShareType       NVARCHAR(20) NOT NULL,      -- Fixed | Equal | Residue | Branch
  ShareValue      NVARCHAR(20) NULL,          -- Fixed: "1/8" or "1/2|2/3" (one heir | two or more); Residue: weight
  LawRef          NVARCHAR(300) NULL,
  Notes           NVARCHAR(1000) NULL,
  LawyerValidated BIT NOT NULL CONSTRAINT DF_LegalSuccessionRule_Valid DEFAULT 0,
  IsActive        BIT NOT NULL CONSTRAINT DF_LegalSuccessionRule_Active DEFAULT 1,
  CreatedBy INT NULL, CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_LegalSuccessionRule_At DEFAULT SYSUTCDATETIME(),
  UpdatedBy INT NULL, UpdatedAt DATETIME2 NULL,
  CONSTRAINT UQ_LegalSuccessionRule UNIQUE (Law, HeirRole, Condition)
);
GO
MERGE dbo.LegalSuccessionRule AS t
USING (VALUES
  -- Hindu Succession Act, 1956 — Class I heirs share equally; a predeceased child's branch takes that child's share.
  (N'Hindu Succession Act, 1956', N'Widow',    N'Always', N'Equal',  NULL, N'HSA 1956 s.8, s.10'),
  (N'Hindu Succession Act, 1956', N'Son',      N'Always', N'Equal',  NULL, N'HSA 1956 s.8, s.10'),
  (N'Hindu Succession Act, 1956', N'Daughter', N'Always', N'Equal',  NULL, N'HSA 1956 s.8, s.10'),
  (N'Hindu Succession Act, 1956', N'Mother',   N'Always', N'Equal',  NULL, N'HSA 1956 s.8, s.10'),
  (N'Hindu Succession Act, 1956', N'Child of predeceased son',      N'Always', N'Branch', NULL, N'HSA 1956 s.10'),
  (N'Hindu Succession Act, 1956', N'Child of predeceased daughter', N'Always', N'Branch', NULL, N'HSA 1956 s.10'),
  -- Muslim personal law (Sunni Hanafi) — sharers first, then residuaries (son twice a daughter).
  (N'Muslim law (Hanafi)', N'Wife',     N'Children present', N'Fixed',   N'1/8',     N'Quranic share — Hanafi'),
  (N'Muslim law (Hanafi)', N'Wife',     N'No children',      N'Fixed',   N'1/4',     N'Quranic share — Hanafi'),
  (N'Muslim law (Hanafi)', N'Husband',  N'Children present', N'Fixed',   N'1/4',     N'Quranic share — Hanafi'),
  (N'Muslim law (Hanafi)', N'Husband',  N'No children',      N'Fixed',   N'1/2',     N'Quranic share — Hanafi'),
  (N'Muslim law (Hanafi)', N'Mother',   N'Children present', N'Fixed',   N'1/6',     N'Quranic share — Hanafi'),
  (N'Muslim law (Hanafi)', N'Mother',   N'No children',      N'Fixed',   N'1/3',     N'Quranic share — Hanafi (no siblings assumed)'),
  (N'Muslim law (Hanafi)', N'Father',   N'Children present', N'Fixed',   N'1/6',     N'Quranic share — Hanafi'),
  (N'Muslim law (Hanafi)', N'Father',   N'No children',      N'Residue', N'1',       N'Residuary — Hanafi'),
  (N'Muslim law (Hanafi)', N'Son',      N'Always',           N'Residue', N'2',       N'Residuary — son twice a daughter'),
  (N'Muslim law (Hanafi)', N'Daughter', N'Son present',      N'Residue', N'1',       N'Residuary with a son'),
  (N'Muslim law (Hanafi)', N'Daughter', N'No son',           N'Fixed',   N'1/2|2/3', N'Quranic share — one daughter 1/2, two or more 2/3 together'),
  -- Indian Succession Act, 1925 (Christians and others it applies to).
  (N'Indian Succession Act, 1925', N'Widow',    N'Children present', N'Fixed', N'1/3', N'ISA 1925 s.33'),
  (N'Indian Succession Act, 1925', N'Widow',    N'No children',      N'Fixed', N'1/2', N'ISA 1925 s.33 (kindred present)'),
  (N'Indian Succession Act, 1925', N'Son',      N'Always',           N'Equal', NULL,   N'ISA 1925 s.35'),
  (N'Indian Succession Act, 1925', N'Daughter', N'Always',           N'Equal', NULL,   N'ISA 1925 s.35')
) AS s (Law, HeirRole, Condition, ShareType, ShareValue, LawRef) ON t.Law = s.Law AND t.HeirRole = s.HeirRole AND t.Condition = s.Condition
WHEN NOT MATCHED THEN INSERT (Law, HeirRole, Condition, ShareType, ShareValue, LawRef, Notes)
  VALUES (s.Law, s.HeirRole, s.Condition, s.ShareType, s.ShareValue, s.LawRef, N'Starter rule — NOT validated. To be checked by a qualified property lawyer.');
GO
IF COL_LENGTH('dbo.LegalInheritance', 'SuccessionLaw') IS NULL ALTER TABLE dbo.LegalInheritance ADD SuccessionLaw NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.LegalInheritance', 'ShareDecision') IS NULL ALTER TABLE dbo.LegalInheritance ADD ShareDecision NVARCHAR(40) NULL;
IF COL_LENGTH('dbo.LegalInheritance', 'ShareDecisionBy') IS NULL ALTER TABLE dbo.LegalInheritance ADD ShareDecisionBy INT NULL;
IF COL_LENGTH('dbo.LegalInheritance', 'ShareDecisionAt') IS NULL ALTER TABLE dbo.LegalInheritance ADD ShareDecisionAt DATETIME2 NULL;
IF COL_LENGTH('dbo.LegalInheritance', 'ShareDecisionRemarks') IS NULL ALTER TABLE dbo.LegalInheritance ADD ShareDecisionRemarks NVARCHAR(1000) NULL;
IF COL_LENGTH('dbo.LegalInheritanceHeir', 'HeirRole') IS NULL ALTER TABLE dbo.LegalInheritanceHeir ADD HeirRole NVARCHAR(60) NULL;
IF COL_LENGTH('dbo.LegalInheritanceHeir', 'BranchOf') IS NULL ALTER TABLE dbo.LegalInheritanceHeir ADD BranchOf NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.LegalInheritanceHeir', 'Relinquished') IS NULL ALTER TABLE dbo.LegalInheritanceHeir ADD Relinquished NVARCHAR(10) NULL;
GO
-- Automatic flag: recorded heir shares differ from the suggestion and no one has decided yet.
IF OBJECT_ID('dbo.LegalRuleConfig', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.LegalRuleConfig WHERE RuleKey = N'share_suggestion')
  INSERT INTO dbo.LegalRuleConfig (RuleKey, RuleName, RiskLevel, IsBlocking) VALUES (N'share_suggestion', N'Heir shares differ from the suggested succession shares (not yet reviewed)', N'Medium', 0);
