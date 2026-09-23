-- Migration 467: DPR Activity Chain Template — the "template maker" for
-- Civil Work DPR, mirroring how CRM's Auto Project Setup lets staff define
-- a Unit Type template once and generate it across every floor, instead of
-- creating each Dependency/Activity chain by hand, room by room.
--
-- Scoped per Room Category (dbo.RoomCategoryMaster), not per Block — every
-- room of a given category (every "Bedroom", every "Kitchen") needs
-- essentially the same activity sequence, and which categories exist per
-- Unit is already fully dynamic via UnitRoomConfig/RoomComposition. Nothing
-- here is hardcoded: RoomCategoryMaster and ActivityMaster are both
-- admin-editable master data the template just references by FK.
--
-- One active template per Room Category (UX_...RoomCategory unique index) —
-- editing always deactivate-then-reinserts its item rows, same convention
-- as CrmProjectAutoSetupUnitTemplate's PUT.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DprActivityChainTemplate' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DprActivityChainTemplate (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    RoomCategoryId  INT NOT NULL,
    IsActive        BIT NOT NULL CONSTRAINT DF_DprActivityChainTemplate_IsActive DEFAULT (1),
    CreatedBy       NVARCHAR(200) NULL,
    CreatedAt       DATETIME2(3) NOT NULL CONSTRAINT DF_DprActivityChainTemplate_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy       NVARCHAR(200) NULL,
    UpdatedAt       DATETIME2(3) NULL,
    CONSTRAINT FK_DprActivityChainTemplate_Category FOREIGN KEY (RoomCategoryId) REFERENCES dbo.RoomCategoryMaster(Id)
  );
  -- Enforced only while IsActive = 1 (filtered unique index) — a
  -- soft-deleted template must not block creating a fresh one for the same
  -- category, same pattern UnitRoomConfig's own UX_UnitRoomConfig_UnitId
  -- would need if it ever allowed history rows.
  CREATE UNIQUE INDEX UX_DprActivityChainTemplate_RoomCategory
    ON dbo.DprActivityChainTemplate(RoomCategoryId)
    WHERE IsActive = 1;
  PRINT 'Created dbo.DprActivityChainTemplate';
END
ELSE
  PRINT 'dbo.DprActivityChainTemplate already exists — skipping create';
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DprActivityChainTemplateItem' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.DprActivityChainTemplateItem (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    TemplateId  INT NOT NULL,
    ActivityId  INT NOT NULL,
    SequenceNo  INT NOT NULL,
    CONSTRAINT FK_DprActivityChainTemplateItem_Template
      FOREIGN KEY (TemplateId) REFERENCES dbo.DprActivityChainTemplate(Id) ON DELETE CASCADE,
    CONSTRAINT FK_DprActivityChainTemplateItem_Activity
      FOREIGN KEY (ActivityId) REFERENCES dbo.ActivityMaster(id)
  );
  CREATE UNIQUE INDEX UX_DprActivityChainTemplateItem_Sequence
    ON dbo.DprActivityChainTemplateItem(TemplateId, SequenceNo);
  PRINT 'Created dbo.DprActivityChainTemplateItem';
END
ELSE
  PRINT 'dbo.DprActivityChainTemplateItem already exists — skipping create';
GO

-- Page registration — Setup menu entry, same convention as every other
-- migration-seeded PageDefinitions row in this module.
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions')
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'dpr-activity-chain-template' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('dpr-activity-chain-template', 'Activity Chain Template', 'Civil Work DPR', 'Setup Masters', 'view,create,edit,delete', 25, 1, 'migration', GETDATE());
END
GO
