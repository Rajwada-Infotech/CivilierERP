-- Migration 556: DPR Tag Master + Activity Tag.
--  1. dbo.DprTagMaster — one row per tag; TagName is unique (case-insensitive under the DB collation).
--  2. dbo.ActivityMaster.TagId — the tag an activity is linked to (NULL = untagged). Reports read the
--     tag through this link, so changing an activity's tag shows up everywhere straight away.
--  3. PageDefinitions row for the "DPR Tag Master" menu.

IF OBJECT_ID('dbo.DprTagMaster', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.DprTagMaster (
    Id        INT IDENTITY(1,1) PRIMARY KEY,
    TagName   NVARCHAR(100) NOT NULL,
    IsActive  BIT NOT NULL CONSTRAINT DF_DprTagMaster_IsActive DEFAULT 1,
    CreatedBy NVARCHAR(200) NULL,
    CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_DprTagMaster_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy NVARCHAR(200) NULL,
    UpdatedAt DATETIME2 NULL,
    CONSTRAINT UQ_DprTagMaster_TagName UNIQUE (TagName)
  );
  PRINT 'Migration 556: created DprTagMaster.';
END
GO

IF COL_LENGTH('dbo.ActivityMaster', 'TagId') IS NULL
BEGIN
  ALTER TABLE dbo.ActivityMaster ADD TagId INT NULL;
  ALTER TABLE dbo.ActivityMaster
    ADD CONSTRAINT FK_ActivityMaster_DprTag FOREIGN KEY (TagId) REFERENCES dbo.DprTagMaster(Id);
  PRINT 'Migration 556: added ActivityMaster.TagId.';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'dpr-tag-master' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('dpr-tag-master', 'DPR Tag Master', 'Civil Work DPR', 'Setup', 'view,create,edit,delete', 23, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions dpr-tag-master';
END
GO
