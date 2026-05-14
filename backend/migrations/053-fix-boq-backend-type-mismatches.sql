-- 053-fix-boq-backend-type-mismatches.sql
-- Align BOQ table column types with backend/routes/boq.js.

IF EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = N'FK_BoqActivities_Activity'
    AND parent_object_id = OBJECT_ID(N'dbo.BoqActivities')
)
BEGIN
  ALTER TABLE dbo.BoqActivities DROP CONSTRAINT FK_BoqActivities_Activity;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.BoqActivities')
    AND name = N'ActivityId'
    AND system_type_id <> TYPE_ID(N'nvarchar')
)
BEGIN
  ALTER TABLE dbo.BoqActivities ALTER COLUMN ActivityId NVARCHAR(100) NULL;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.BOQ')
    AND name = N'CreatedBy'
    AND system_type_id <> TYPE_ID(N'nvarchar')
)
BEGIN
  ALTER TABLE dbo.BOQ ALTER COLUMN CreatedBy NVARCHAR(100) NULL;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.BOQ')
    AND name = N'UpdatedBy'
    AND system_type_id <> TYPE_ID(N'nvarchar')
)
BEGIN
  ALTER TABLE dbo.BOQ ALTER COLUMN UpdatedBy NVARCHAR(100) NULL;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.BOQ')
    AND name = N'ApprovedBy'
    AND system_type_id <> TYPE_ID(N'nvarchar')
)
BEGIN
  ALTER TABLE dbo.BOQ ALTER COLUMN ApprovedBy NVARCHAR(100) NULL;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID(N'dbo.BOQ')
    AND name = N'RejectedBy'
    AND system_type_id <> TYPE_ID(N'nvarchar')
)
BEGIN
  ALTER TABLE dbo.BOQ ALTER COLUMN RejectedBy NVARCHAR(100) NULL;
END
GO

PRINT '053-fix-boq-backend-type-mismatches completed.';
