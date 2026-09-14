-- ============================================================
-- Migration 182: Payment Plan Master — Company/Project/Block scoping
-- Lets multiple payment plans be defined per Company/Project/Block
-- (e.g. "Plan A" for Tower 1, a different "Plan A" for Tower 2) instead
-- of one flat globally-unique-by-name list. Existing plans are left with
-- NULL scope columns, which means "applies to any company/project/block
-- that doesn't have a more specific plan" — nothing about how they work
-- today changes; the scoping is additive.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'CompanyId')
BEGIN
  ALTER TABLE dbo.CrmPaymentPlanTemplate ADD CompanyId INT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'ProjectId')
BEGIN
  ALTER TABLE dbo.CrmPaymentPlanTemplate ADD ProjectId INT NULL;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'BlockId')
BEGIN
  ALTER TABLE dbo.CrmPaymentPlanTemplate ADD BlockId INT NULL REFERENCES dbo.BlockMaster(Id);
END
GO

-- Drop the old flat "PlanName must be globally unique" constraint —
-- SQL Server auto-names it, so find it by inspecting which constraint
-- actually enforces uniqueness on the PlanName column alone.
DECLARE @oldConstraint NVARCHAR(200);
SELECT @oldConstraint = kc.name
FROM sys.key_constraints kc
JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE kc.parent_object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate')
  AND kc.type = 'UQ'
  AND c.name = 'PlanName';
IF @oldConstraint IS NOT NULL
BEGIN
  EXEC('ALTER TABLE dbo.CrmPaymentPlanTemplate DROP CONSTRAINT ' + @oldConstraint);
  PRINT 'Dropped old global-unique PlanName constraint: ' + @oldConstraint;
END
GO

-- Replace it with a scoped uniqueness rule: PlanName only needs to be
-- unique within the same (Company, Project, Block) combination, and only
-- while the plan is IsActive — a deactivated/retired plan never blocks
-- reusing its name.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'ScopeKey')
BEGIN
  ALTER TABLE dbo.CrmPaymentPlanTemplate ADD ScopeKey AS (
    CAST(ISNULL(CompanyId, -1) AS NVARCHAR(20)) + '|' +
    CAST(ISNULL(ProjectId, -1) AS NVARCHAR(20)) + '|' +
    CAST(ISNULL(BlockId, -1) AS NVARCHAR(20)) + '|' +
    PlanName
  ) PERSISTED;
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CrmPaymentPlanTemplate_ScopeKey' AND object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate'))
BEGIN
  CREATE UNIQUE INDEX UQ_CrmPaymentPlanTemplate_ScopeKey ON dbo.CrmPaymentPlanTemplate(ScopeKey) WHERE IsActive = 1;
END
GO
