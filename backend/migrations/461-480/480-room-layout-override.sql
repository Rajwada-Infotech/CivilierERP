-- Migration 480: hierarchical layout overrides for Flat Master.
--
-- A unit's room layout comes from its Unit Composition layout type (global,
-- migration 477). Real buildings have exceptions — a project where every
-- 2 BHK also has a Store Room, a tower whose 3 BHKs have 3 bathrooms, a
-- ground floor without balconies, one odd corner flat. These tables let a
-- layout be overridden for one layout type at one scope:
--
--   UNIT  >  FLOOR (a floor range of one block)  >  BLOCK  >  PROJECT  >  global
--
-- The most specific active override wins (services/unitLayout.js
-- getEffectiveComposition). An override is a FULL room list (not a delta):
-- what it lists is exactly what the units in its scope get.
--
-- New tables only — nothing existing changes until an override is created.

IF OBJECT_ID('dbo.RoomLayoutOverride', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RoomLayoutOverride (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    LayoutTypeId  INT NOT NULL,
    ScopeLevel    NVARCHAR(10) NOT NULL,
    ProjectId     INT NOT NULL,
    BlockId       INT NULL,
    FloorFrom     INT NULL,
    FloorTo       INT NULL,
    UnitId        INT NULL,
    IsActive      BIT NOT NULL CONSTRAINT DF_RoomLayoutOverride_IsActive DEFAULT (1),
    CreatedBy     NVARCHAR(200) NULL,
    CreatedAt     DATETIME2(3) NOT NULL CONSTRAINT DF_RoomLayoutOverride_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy     NVARCHAR(200) NULL,
    UpdatedAt     DATETIME2(3) NULL,
    CONSTRAINT FK_RoomLayoutOverride_LayoutType FOREIGN KEY (LayoutTypeId) REFERENCES dbo.RoomLayoutType(Id),
    CONSTRAINT FK_RoomLayoutOverride_Block FOREIGN KEY (BlockId) REFERENCES dbo.BlockMaster(Id),
    CONSTRAINT FK_RoomLayoutOverride_Unit FOREIGN KEY (UnitId) REFERENCES dbo.UnitMaster(Id),
    CONSTRAINT CK_RoomLayoutOverride_Scope CHECK (
         (ScopeLevel = 'PROJECT' AND BlockId IS NULL     AND FloorFrom IS NULL     AND FloorTo IS NULL     AND UnitId IS NULL)
      OR (ScopeLevel = 'BLOCK'   AND BlockId IS NOT NULL AND FloorFrom IS NULL     AND FloorTo IS NULL     AND UnitId IS NULL)
      OR (ScopeLevel = 'FLOOR'   AND BlockId IS NOT NULL AND FloorFrom IS NOT NULL AND FloorTo IS NOT NULL AND FloorFrom <= FloorTo AND UnitId IS NULL)
      OR (ScopeLevel = 'UNIT'    AND BlockId IS NOT NULL AND FloorFrom IS NULL     AND FloorTo IS NULL     AND UnitId IS NOT NULL)
    )
  );
END
GO

-- One ACTIVE override per scope per layout type (a reset soft-deactivates,
-- so the same scope can be overridden again later). Floor ranges of one
-- block must also not overlap — that is enforced by the API, since a range
-- overlap can't be expressed as a unique index.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RoomLayoutOverride_Project' AND object_id = OBJECT_ID('dbo.RoomLayoutOverride'))
  CREATE UNIQUE INDEX UX_RoomLayoutOverride_Project ON dbo.RoomLayoutOverride(LayoutTypeId, ProjectId)
    WHERE ScopeLevel = 'PROJECT' AND IsActive = 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RoomLayoutOverride_Block' AND object_id = OBJECT_ID('dbo.RoomLayoutOverride'))
  CREATE UNIQUE INDEX UX_RoomLayoutOverride_Block ON dbo.RoomLayoutOverride(LayoutTypeId, BlockId)
    WHERE ScopeLevel = 'BLOCK' AND IsActive = 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RoomLayoutOverride_Floor' AND object_id = OBJECT_ID('dbo.RoomLayoutOverride'))
  CREATE UNIQUE INDEX UX_RoomLayoutOverride_Floor ON dbo.RoomLayoutOverride(LayoutTypeId, BlockId, FloorFrom, FloorTo)
    WHERE ScopeLevel = 'FLOOR' AND IsActive = 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_RoomLayoutOverride_Unit' AND object_id = OBJECT_ID('dbo.RoomLayoutOverride'))
  CREATE UNIQUE INDEX UX_RoomLayoutOverride_Unit ON dbo.RoomLayoutOverride(LayoutTypeId, UnitId)
    WHERE ScopeLevel = 'UNIT' AND IsActive = 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RoomLayoutOverride_Lookup' AND object_id = OBJECT_ID('dbo.RoomLayoutOverride'))
  CREATE INDEX IX_RoomLayoutOverride_Lookup ON dbo.RoomLayoutOverride(LayoutTypeId, ProjectId) INCLUDE (ScopeLevel, BlockId, FloorFrom, FloorTo, UnitId, IsActive);
GO

IF OBJECT_ID('dbo.RoomLayoutOverrideItem', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.RoomLayoutOverrideItem (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    OverrideId      INT NOT NULL,
    RoomCategoryId  INT NOT NULL,
    Quantity        INT NOT NULL,
    CONSTRAINT FK_RoomLayoutOverrideItem_Override FOREIGN KEY (OverrideId) REFERENCES dbo.RoomLayoutOverride(Id),
    CONSTRAINT FK_RoomLayoutOverrideItem_Category FOREIGN KEY (RoomCategoryId) REFERENCES dbo.RoomCategoryMaster(Id),
    CONSTRAINT CK_RoomLayoutOverrideItem_Quantity CHECK (Quantity >= 0 AND Quantity <= 10),
    CONSTRAINT UX_RoomLayoutOverrideItem UNIQUE (OverrideId, RoomCategoryId)
  );
END
GO
