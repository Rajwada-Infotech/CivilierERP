-- Migration 477: real FK between a Unit (and the CRM auto-setup template /
-- block spec that feed it) and its Unit Composition layout type.
--
-- Until now the only link between dbo.UnitMaster and its room layout was
-- the free-text UnitMaster.UnitType ("2 BHK") matched at read time against
-- dbo.RoomLayoutType.TypeKey ("2BHK") by upper-casing and stripping spaces
-- (see normalizeTypeKey in unitBhkConfig.js). Nothing enforced that a
-- UnitType actually had a layout — Unit Master's own hard-coded picker
-- offered types ("1.5 BHK", "Studio", ...) that never matched anything, and
-- "2.5 BHK" units exist today with no registered layout at all.
--
-- LayoutTypeId is added alongside (not instead of) the existing UnitType
-- text: UnitType stays as the display copy that bookings, PDFs, reports and
-- BlockUnitTypeSpec joins already read, so none of those need to change.
-- LayoutTypeId becomes the authoritative link that room generation and
-- Work Reporting resolve through. Nullable + backfilled by the same
-- normalized-key match the app already uses; anything that doesn't match
-- is left NULL rather than guessed.

-- ── 1. RoomLayoutType.TypeKey: NVARCHAR(20) -> NVARCHAR(50) ────────────────
-- Label allows 50 characters (unitBhkConfig.js POST /types) but the
-- normalized key derived from it only had room for 20 — a long custom
-- label failed to register with a truncation error. The unique constraint
-- has to be dropped around the ALTER and recreated.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.RoomLayoutType') AND name = 'TypeKey' AND max_length < 100
)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UX_RoomLayoutType_TypeKey' AND parent_object_id = OBJECT_ID('dbo.RoomLayoutType'))
    ALTER TABLE dbo.RoomLayoutType DROP CONSTRAINT UX_RoomLayoutType_TypeKey;
  ALTER TABLE dbo.RoomLayoutType ALTER COLUMN TypeKey NVARCHAR(50) NOT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UX_RoomLayoutType_TypeKey' AND parent_object_id = OBJECT_ID('dbo.RoomLayoutType'))
BEGIN
  ALTER TABLE dbo.RoomLayoutType ADD CONSTRAINT UX_RoomLayoutType_TypeKey UNIQUE (TypeKey);
END
GO

-- ── 2. Register "2.5 BHK" ──────────────────────────────────────────────────
-- Already used by live units / auto-setup templates / block specs but never
-- registered as a layout type. Registered (not system) so it links up in
-- the backfill below; its room composition is then defined in Unit
-- Composition like any other type.
IF NOT EXISTS (SELECT 1 FROM dbo.RoomLayoutType WHERE TypeKey = '2.5BHK')
BEGIN
  INSERT INTO dbo.RoomLayoutType (TypeKey, Label, IsSystem, SortOrder, IsActive, CreatedBy)
  VALUES ('2.5BHK', '2.5 BHK', 0, 25, 1, 'migration-477');
END
GO

-- ── 3. LayoutTypeId columns + FKs + indexes ────────────────────────────────
IF COL_LENGTH('dbo.UnitMaster', 'LayoutTypeId') IS NULL
  ALTER TABLE dbo.UnitMaster ADD LayoutTypeId INT NULL;
GO
IF COL_LENGTH('dbo.CrmProjectAutoSetupUnitTemplate', 'LayoutTypeId') IS NULL
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD LayoutTypeId INT NULL;
GO
IF COL_LENGTH('dbo.BlockUnitTypeSpec', 'LayoutTypeId') IS NULL
  ALTER TABLE dbo.BlockUnitTypeSpec ADD LayoutTypeId INT NULL;
GO
IF COL_LENGTH('dbo.UnitRoomConfig', 'LayoutTypeId') IS NULL
  ALTER TABLE dbo.UnitRoomConfig ADD LayoutTypeId INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_UnitMaster_LayoutType')
  ALTER TABLE dbo.UnitMaster ADD CONSTRAINT FK_UnitMaster_LayoutType
    FOREIGN KEY (LayoutTypeId) REFERENCES dbo.RoomLayoutType(Id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrmAutoSetupUnitTemplate_LayoutType')
  ALTER TABLE dbo.CrmProjectAutoSetupUnitTemplate ADD CONSTRAINT FK_CrmAutoSetupUnitTemplate_LayoutType
    FOREIGN KEY (LayoutTypeId) REFERENCES dbo.RoomLayoutType(Id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_BlockUnitTypeSpec_LayoutType')
  ALTER TABLE dbo.BlockUnitTypeSpec ADD CONSTRAINT FK_BlockUnitTypeSpec_LayoutType
    FOREIGN KEY (LayoutTypeId) REFERENCES dbo.RoomLayoutType(Id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_UnitRoomConfig_LayoutType')
  ALTER TABLE dbo.UnitRoomConfig ADD CONSTRAINT FK_UnitRoomConfig_LayoutType
    FOREIGN KEY (LayoutTypeId) REFERENCES dbo.RoomLayoutType(Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_UnitMaster_LayoutType' AND object_id = OBJECT_ID('dbo.UnitMaster'))
  CREATE INDEX IX_UnitMaster_LayoutType ON dbo.UnitMaster(LayoutTypeId) WHERE LayoutTypeId IS NOT NULL;
GO

-- ── 4. Backfill by the same normalized-key match the app already uses ──────
UPDATE u SET u.LayoutTypeId = lt.Id
FROM dbo.UnitMaster u
JOIN dbo.RoomLayoutType lt ON lt.TypeKey = UPPER(REPLACE(LTRIM(RTRIM(u.UnitType)), ' ', ''))
WHERE u.LayoutTypeId IS NULL AND u.UnitType IS NOT NULL;
GO

UPDATE t SET t.LayoutTypeId = lt.Id
FROM dbo.CrmProjectAutoSetupUnitTemplate t
JOIN dbo.RoomLayoutType lt ON lt.TypeKey = UPPER(REPLACE(LTRIM(RTRIM(t.UnitType)), ' ', ''))
WHERE t.LayoutTypeId IS NULL AND t.UnitType IS NOT NULL;
GO

UPDATE s SET s.LayoutTypeId = lt.Id
FROM dbo.BlockUnitTypeSpec s
JOIN dbo.RoomLayoutType lt ON lt.TypeKey = UPPER(REPLACE(LTRIM(RTRIM(s.UnitType)), ' ', ''))
WHERE s.LayoutTypeId IS NULL AND s.UnitType IS NOT NULL;
GO

UPDATE c SET c.LayoutTypeId = lt.Id
FROM dbo.UnitRoomConfig c
JOIN dbo.RoomLayoutType lt ON lt.TypeKey = UPPER(REPLACE(LTRIM(RTRIM(c.BhkType)), ' ', ''))
WHERE c.LayoutTypeId IS NULL;
GO

-- Canonicalize the display text to the layout's own Label wherever it
-- linked but was spelled differently ("2BHK" vs "2 BHK"), so the existing
-- text joins (unitMaster.js <-> BlockUnitTypeSpec) keep matching. The
-- block spec is skipped where canonicalizing would collide with an existing
-- row under UX_BlockUnitTypeSpec_BlockType.
UPDATE u SET u.UnitType = lt.Label
FROM dbo.UnitMaster u
JOIN dbo.RoomLayoutType lt ON lt.Id = u.LayoutTypeId
WHERE u.UnitType <> lt.Label COLLATE Latin1_General_BIN;
GO

UPDATE t SET t.UnitType = lt.Label
FROM dbo.CrmProjectAutoSetupUnitTemplate t
JOIN dbo.RoomLayoutType lt ON lt.Id = t.LayoutTypeId
WHERE t.UnitType <> lt.Label COLLATE Latin1_General_BIN;
GO

UPDATE s SET s.UnitType = lt.Label
FROM dbo.BlockUnitTypeSpec s
JOIN dbo.RoomLayoutType lt ON lt.Id = s.LayoutTypeId
WHERE s.UnitType <> lt.Label COLLATE Latin1_General_BIN
  AND NOT EXISTS (
    SELECT 1 FROM dbo.BlockUnitTypeSpec s2
    WHERE s2.BlockId = s.BlockId AND s2.Id <> s.Id AND s2.UnitType = lt.Label
  );
GO

-- ── 5. RoomMaster.RoomName: NVARCHAR(100) -> NVARCHAR(160) ─────────────────
-- Generated rooms are named "{Alias} {n}" and RoomCategoryMaster.Alias
-- allows 150 characters, so a long alias could overflow RoomName and fail a
-- whole unit's room generation. Widening a column that is only INCLUDEd in
-- IX_RoomMaster_ProjectBlockUnit is allowed in place.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.RoomMaster') AND name = 'RoomName' AND max_length < 320
)
BEGIN
  ALTER TABLE dbo.RoomMaster ALTER COLUMN RoomName NVARCHAR(160) NOT NULL;
END
GO

-- ── 6. One composition per layout type — restore the DB-level guarantee ────
-- Migration 466 had to drop UX_UnitRoomConfig_BhkType to widen BhkType to
-- NVARCHAR(MAX); LayoutTypeId is indexable, so the same guarantee comes
-- back here (filtered, so any legacy row that didn't link is unaffected).
-- Only created when the data already satisfies it.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_UnitRoomConfig_LayoutType' AND object_id = OBJECT_ID('dbo.UnitRoomConfig'))
  AND NOT EXISTS (
    SELECT LayoutTypeId FROM dbo.UnitRoomConfig
    WHERE LayoutTypeId IS NOT NULL GROUP BY LayoutTypeId HAVING COUNT(*) > 1
  )
BEGIN
  CREATE UNIQUE INDEX UX_UnitRoomConfig_LayoutType ON dbo.UnitRoomConfig(LayoutTypeId) WHERE LayoutTypeId IS NOT NULL;
END
GO
