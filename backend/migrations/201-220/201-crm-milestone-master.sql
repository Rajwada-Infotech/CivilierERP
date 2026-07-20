-- Milestone names in Payment Plan Master were free-typed per plan (no
-- reusable catalog), so the same stage ended up spelled differently across
-- plans. This is the reusable source of truth Payment Plan Master now picks
-- from instead of retyping — seeded with the existing 7-stage default
-- (DEFAULT_MILESTONES in crmEntityCreation.js) as the starting catalog.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmMilestoneMaster')
BEGIN
  CREATE TABLE dbo.CrmMilestoneMaster (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    Name          NVARCHAR(200) NOT NULL,
    DefaultPercent DECIMAL(5,2) NULL,
    SortOrder     INT NOT NULL DEFAULT 0,
    IsActive      BIT NOT NULL DEFAULT 1,
    CreatedBy     INT NULL,
    CreatedAt     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy     INT NULL,
    UpdatedAt     DATETIME2 NULL,
    CONSTRAINT UQ_CrmMilestoneMaster_Name UNIQUE (Name)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.CrmMilestoneMaster)
BEGIN
  INSERT INTO dbo.CrmMilestoneMaster (Name, DefaultPercent, SortOrder, CreatedBy, CreatedAt) VALUES
    ('Booking',        5,  1, NULL, SYSDATETIME()),
    ('Agreement',      10, 2, NULL, SYSDATETIME()),
    ('Foundation',     15, 3, NULL, SYSDATETIME()),
    ('Superstructure', 20, 4, NULL, SYSDATETIME()),
    ('Slab Casting',   20, 5, NULL, SYSDATETIME()),
    ('Plastering',     15, 6, NULL, SYSDATETIME()),
    ('Handover',       15, 7, NULL, SYSDATETIME());
END
GO

-- Payment Plan Master items can now reference a catalog entry instead of
-- (or alongside) free-typing MilestoneName — nullable so existing/custom
-- one-off items keep working unchanged.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentPlanTemplateItem') AND name = 'MilestoneMasterId')
  ALTER TABLE dbo.CrmPaymentPlanTemplateItem ADD MilestoneMasterId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'crm-milestone-master')
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('crm-milestone-master', 'Milestone Master', 'CRM', 'CRM Finance', 'view,create,edit,delete', 914, 1, 'migration-201', SYSDATETIME());
GO
