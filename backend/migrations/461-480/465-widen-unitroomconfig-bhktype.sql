-- Migration 465: dbo.UnitRoomConfig.BhkType was left at NVARCHAR(10) (its
-- original width from migration 330, sized only for the 4 fixed types —
-- "1BHK".."4BHK") when migration 332 introduced arbitrary custom layout
-- types via dbo.RoomLayoutType.TypeKey NVARCHAR(20) and dropped the CHECK
-- constraint that used to cap BhkType to those 4 values. A custom type's
-- normalized key can run past 10 characters — e.g. "1BHK w/o balcony" ->
-- "1BHKW/OBALCONY" (14 chars) — which SQL Server truncated instead of
-- storing, breaking "Add Type" / Save Template for any longer custom label.
-- Widening BhkType to match TypeKey's own NVARCHAR(20) so it can hold
-- anything RoomLayoutType is actually willing to register.

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.UnitRoomConfig') AND name = 'BhkType' AND max_length < 40
)
BEGIN
  ALTER TABLE dbo.UnitRoomConfig ALTER COLUMN BhkType NVARCHAR(20) NOT NULL;
END
GO
