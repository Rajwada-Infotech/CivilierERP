-- Migration 356: FA Item Code generation — ID Template Master + code sequence
--
-- Adds:
--   1. dbo.IDTemplateMaster — one Project Alias per project, used to build
--      the FA Item Code format ProjectAlias/ItemName/0001/FinYear.
--   2. dbo.FAItemCodeSequence — atomic per (Project, Item, FinYear) serial
--      counter (see backend/services/faItemCodeGenerator.js).
--   3. dbo.FixedAssetTagging.FAItemCode — the generated code stored per
--      tagged unit, with a filtered unique index (existing bulk-quantity
--      rows have no code and must not collide with each other on NULL).

-- ── 1. IDTemplateMaster ───────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'IDTemplateMaster'
)
BEGIN
  CREATE TABLE dbo.IDTemplateMaster (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId     INT           NOT NULL UNIQUE,
    ProjectAlias  NVARCHAR(50)  NOT NULL,
    IsActive      BIT           NOT NULL DEFAULT 1,
    CreatedBy     NVARCHAR(200) NULL,
    CreatedAt     DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy     NVARCHAR(200) NULL,
    UpdatedAt     DATETIME2     NULL,
    CONSTRAINT FK_IDTemplateMaster_Project FOREIGN KEY (ProjectId) REFERENCES dbo.enterprise(id)
  );
  PRINT 'Created dbo.IDTemplateMaster';
END
ELSE
  PRINT 'dbo.IDTemplateMaster already exists';
GO

-- ── 2. FAItemCodeSequence ────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'FAItemCodeSequence'
)
BEGIN
  CREATE TABLE dbo.FAItemCodeSequence (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    ProjectId   INT           NOT NULL,
    ItemId      NVARCHAR(100) NOT NULL,
    FinYear     NVARCHAR(20)  NOT NULL,
    LastNumber  INT           NOT NULL DEFAULT 0
  );
  PRINT 'Created dbo.FAItemCodeSequence';
END
ELSE
  PRINT 'dbo.FAItemCodeSequence already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FAItemCodeSequence_Scope' AND object_id = OBJECT_ID('dbo.FAItemCodeSequence'))
BEGIN
  CREATE UNIQUE INDEX UX_FAItemCodeSequence_Scope ON dbo.FAItemCodeSequence(ProjectId, ItemId, FinYear);
END
GO

-- ── 3. FixedAssetTagging.FAItemCode ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetTagging') AND name = 'FAItemCode')
BEGIN
  ALTER TABLE dbo.FixedAssetTagging ADD FAItemCode NVARCHAR(200) NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FixedAssetTagging_FAItemCode' AND object_id = OBJECT_ID('dbo.FixedAssetTagging'))
BEGIN
  CREATE UNIQUE INDEX UX_FixedAssetTagging_FAItemCode ON dbo.FixedAssetTagging(FAItemCode) WHERE FAItemCode IS NOT NULL;
END
GO

-- ── 4. PageDefinitions ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'id-template-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('id-template-master', 'ID Template Master', 'Fixed Asset', 'Fixed Asset', 'view,create,edit,delete', 234, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions id-template-master';
END
ELSE
  PRINT 'PageDefinitions id-template-master already exists';
GO

PRINT '356-fa-item-code-template applied successfully.';
GO
