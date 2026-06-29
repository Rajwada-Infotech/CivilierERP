-- 135-create-sa-distribution-rules.sql
-- Admin-configurable auto-distribution rules for Sales Automation leads.
-- Level 1 = Admin -> Team Lead, Level 2 = Team Lead -> Salesperson.
-- ScopeType: 'Global' (applies to all leads at that level unless a more
--   specific Campaign/TeamLead rule exists), 'Campaign' (ScopeId = SaCampaign.Id,
--   Level 1 only), 'TeamLead' (ScopeId = Users.id of the team lead, Level 2 only).
-- Idempotent: guarded by IF NOT EXISTS.

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'SaDistributionRule' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.SaDistributionRule (
    Id         INT          IDENTITY(1,1) PRIMARY KEY,
    Level      TINYINT      NOT NULL,
    ScopeType  NVARCHAR(20) NOT NULL,
    ScopeId    INT          NULL,
    Method     NVARCHAR(20) NOT NULL CONSTRAINT DF_SaDistRule_Method DEFAULT ('Percentage'),
    IsActive   BIT          NOT NULL CONSTRAINT DF_SaDistRule_IsActive DEFAULT (1),
    CreatedBy  INT          NULL,
    CreatedAt  DATETIME2(3) NOT NULL CONSTRAINT DF_SaDistRule_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt  DATETIME2(3) NULL
  );

  CREATE INDEX IX_SaDistRule_Lookup
    ON dbo.SaDistributionRule(Level, ScopeType, ScopeId, IsActive);
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE name = 'SaDistributionRuleMember' AND schema_id = SCHEMA_ID('dbo')
)
BEGIN
  CREATE TABLE dbo.SaDistributionRuleMember (
    Id          INT           IDENTITY(1,1) PRIMARY KEY,
    RuleId      INT           NOT NULL CONSTRAINT FK_SaDistRuleMember_Rule FOREIGN KEY REFERENCES dbo.SaDistributionRule(Id),
    UserId      INT           NOT NULL,
    Weight      DECIMAL(7,2)  NOT NULL CONSTRAINT DF_SaDistRuleMember_Weight DEFAULT (0),
    IsActive    BIT           NOT NULL CONSTRAINT DF_SaDistRuleMember_IsActive DEFAULT (1),
    SortOrder   INT           NOT NULL CONSTRAINT DF_SaDistRuleMember_SortOrder DEFAULT (0)
  );

  CREATE INDEX IX_SaDistRuleMember_Rule ON dbo.SaDistributionRuleMember(RuleId, IsActive);
END
GO

PRINT 'Migration 135: SaDistributionRule + SaDistributionRuleMember created';
GO