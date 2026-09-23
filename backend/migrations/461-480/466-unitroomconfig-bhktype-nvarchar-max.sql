-- Migration 466: widen dbo.UnitRoomConfig.BhkType to NVARCHAR(MAX) so no
-- future custom layout type name can ever hit this column's length limit
-- again (465 only bumped it to 20, matching RoomLayoutType.TypeKey, which
-- still leaves room for the same class of truncation error).
--
-- UX_UnitRoomConfig_BhkType (a unique nonclustered index on this column)
-- has to be dropped first — SQL Server refuses to ALTER a column to
-- NVARCHAR(MAX) while any index still references it, and NVARCHAR(MAX)
-- can never be re-indexed the same way. This is safe to lose as a DB-level
-- guarantee: backend/routes/unitBhkConfig.js's own POST /:bhkType/save
-- already looks up any existing row by BhkType before deciding to
-- INSERT vs UPDATE (see "One UnitRoomConfig row per layout type" there),
-- so duplicates are already prevented at the application layer — this
-- index was only ever a backstop against a second, uncoordinated writer
-- going straight to the table, which nothing in this codebase does.
-- It's backed by a UNIQUE KEY constraint, not a plain index (SQL Server
-- error 3723 rejects a bare DROP INDEX on one of those) — has to go via
-- ALTER TABLE ... DROP CONSTRAINT instead.
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = 'UX_UnitRoomConfig_BhkType' AND parent_object_id = OBJECT_ID('dbo.UnitRoomConfig'))
BEGIN
  ALTER TABLE dbo.UnitRoomConfig DROP CONSTRAINT UX_UnitRoomConfig_BhkType;
END
ELSE IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_UnitRoomConfig_BhkType' AND object_id = OBJECT_ID('dbo.UnitRoomConfig'))
BEGIN
  DROP INDEX UX_UnitRoomConfig_BhkType ON dbo.UnitRoomConfig;
END
GO

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.UnitRoomConfig') AND name = 'BhkType' AND max_length <> -1
)
BEGIN
  ALTER TABLE dbo.UnitRoomConfig ALTER COLUMN BhkType NVARCHAR(MAX) NOT NULL;
END
GO
