-- 331: Room Composition Builder — BHK-type templates instead of per-Unit configs
--
-- dbo.UnitRoomConfig (migration 330) was one row per Unit, UNIQUE(UnitId) —
-- meaning every single unit in every project/tower/floor had to be
-- configured separately before Work Reporting could offer a Room dropdown
-- for it. Reworked so a composition is configured ONCE per BHK type
-- (1BHK/2BHK/3BHK/4BHK) and every Unit of that type (matched via the
-- existing dbo.UnitMaster.UnitType column, e.g. "3 BHK") automatically
-- inherits it — no per-unit setup at all. See backend/routes/
-- unitBhkConfig.js for the read side of this.

-- Drop the per-Unit uniqueness/FK — BhkType is the identity now, not UnitId.
IF EXISTS (SELECT * FROM sys.key_constraints WHERE name = 'UX_UnitRoomConfig_UnitId')
BEGIN
  ALTER TABLE dbo.UnitRoomConfig DROP CONSTRAINT UX_UnitRoomConfig_UnitId;
END
GO

IF EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_UnitRoomConfig_Unit')
BEGIN
  ALTER TABLE dbo.UnitRoomConfig DROP CONSTRAINT FK_UnitRoomConfig_Unit;
END
GO

-- Collapse any existing per-Unit rows down to one row per BhkType before
-- the new UNIQUE(BhkType) constraint below can apply — keep the most
-- recently updated row for each BhkType (its RoomComposition rows travel
-- with it via UnitRoomConfigId); delete the rest along with their now-
-- orphaned composition rows.
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'UnitRoomConfig' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.UnitRoomConfig)
  BEGIN
    ;WITH ranked AS (
      SELECT Id, BhkType,
             ROW_NUMBER() OVER (PARTITION BY BhkType ORDER BY ISNULL(UpdatedAt, CreatedAt) DESC) AS rn
      FROM dbo.UnitRoomConfig
    )
    DELETE rc FROM dbo.RoomComposition rc
    JOIN ranked r ON r.Id = rc.UnitRoomConfigId
    WHERE r.rn > 1;

    ;WITH ranked AS (
      SELECT Id,
             ROW_NUMBER() OVER (PARTITION BY BhkType ORDER BY ISNULL(UpdatedAt, CreatedAt) DESC) AS rn
      FROM dbo.UnitRoomConfig
    )
    DELETE FROM dbo.UnitRoomConfig WHERE Id IN (SELECT Id FROM ranked WHERE rn > 1);
  END
END
GO

-- UnitId no longer means anything — a template belongs to a BhkType, not a
-- specific unit. Drop the column outright rather than leaving it vestigial.
IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitRoomConfig') AND name = 'UnitId')
BEGIN
  ALTER TABLE dbo.UnitRoomConfig DROP COLUMN UnitId;
END
GO

IF NOT EXISTS (SELECT * FROM sys.key_constraints WHERE name = 'UX_UnitRoomConfig_BhkType')
BEGIN
  ALTER TABLE dbo.UnitRoomConfig ADD CONSTRAINT UX_UnitRoomConfig_BhkType UNIQUE (BhkType);
END
GO
