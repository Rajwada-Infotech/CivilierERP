-- 203-unit-payment-plan-tagging.sql
--
-- NOTE ON NUMBERING: picked 203 to follow on from 202 (crm-milestone-master
-- drop-default-percent) from the last session. Check dbo.__Migrations for
-- your actual latest applied filename before running this — rename the
-- file (basename only, per the umzug/dbo.__Migrations tracking convention)
-- if 203 is already taken.
--
-- Replaces Payment Plan Master's Company/Project/Block/Unit scoping with a
-- Unit Master -> Payment Plan many-to-many tag table. A plan is now just a
-- reusable milestone template; which units it applies to is decided by
-- tagging it onto units in Unit Master instead.

-- 1) New many-to-many tag table: which Payment Plans apply to which Unit.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmUnitPaymentPlan' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    CREATE TABLE dbo.CrmUnitPaymentPlan (
        Id          INT IDENTITY(1,1) PRIMARY KEY,
        UnitId      INT NOT NULL,
        PlanId      INT NOT NULL,
        IsActive    BIT NOT NULL DEFAULT 1,
        CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSDATETIME()
    );

    CREATE UNIQUE INDEX UX_CrmUnitPaymentPlan_Unit_Plan
        ON dbo.CrmUnitPaymentPlan (UnitId, PlanId);

    CREATE INDEX IX_CrmUnitPaymentPlan_UnitId ON dbo.CrmUnitPaymentPlan (UnitId) WHERE IsActive = 1;
END
GO

-- 2) Drop UnitMaster.DefaultPaymentPlanId — replaced by the tag table above.
--    Guard against an orphaned default constraint the same way earlier
--    migrations in this repo have had to (a column drop fails if a default
--    constraint on it is still attached, and those constraints get
--    system-generated names that vary by environment).
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'DefaultPaymentPlanId')
BEGIN
    DECLARE @dfConstraint NVARCHAR(200);
    SELECT @dfConstraint = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.UnitMaster') AND c.name = 'DefaultPaymentPlanId';

    IF @dfConstraint IS NOT NULL
        EXEC('ALTER TABLE dbo.UnitMaster DROP CONSTRAINT ' + @dfConstraint);

    ALTER TABLE dbo.UnitMaster DROP COLUMN DefaultPaymentPlanId;
END
GO

-- 3) Drop CrmPaymentPlanTemplate's Company/Block/Unit scope columns.
--    (Project scope lived in the separate CrmPaymentPlanProject table,
--    dropped in step 4 below — nothing to drop here for it.)
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'CompanyId')
BEGIN
    DECLARE @dfCompany NVARCHAR(200);
    SELECT @dfCompany = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND c.name = 'CompanyId';
    IF @dfCompany IS NOT NULL EXEC('ALTER TABLE dbo.CrmPaymentPlanTemplate DROP CONSTRAINT ' + @dfCompany);
    ALTER TABLE dbo.CrmPaymentPlanTemplate DROP COLUMN CompanyId;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'BlockId')
BEGIN
    DECLARE @dfBlock NVARCHAR(200);
    SELECT @dfBlock = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND c.name = 'BlockId';
    IF @dfBlock IS NOT NULL EXEC('ALTER TABLE dbo.CrmPaymentPlanTemplate DROP CONSTRAINT ' + @dfBlock);
    ALTER TABLE dbo.CrmPaymentPlanTemplate DROP COLUMN BlockId;
END
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND name = 'UnitId')
BEGIN
    DECLARE @dfUnit NVARCHAR(200);
    SELECT @dfUnit = dc.name
    FROM sys.default_constraints dc
    JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id
    WHERE dc.parent_object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplate') AND c.name = 'UnitId';
    IF @dfUnit IS NOT NULL EXEC('ALTER TABLE dbo.CrmPaymentPlanTemplate DROP CONSTRAINT ' + @dfUnit);
    ALTER TABLE dbo.CrmPaymentPlanTemplate DROP COLUMN UnitId;
END
GO

-- 4) Drop the now-unused Project scope join table entirely.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmPaymentPlanProject' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
    DROP TABLE dbo.CrmPaymentPlanProject;
END
GO