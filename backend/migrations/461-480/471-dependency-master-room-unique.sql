-- 471: One Room can only ever have one Dependency Chain — a second chain on
-- the same room would mean two independent, overlapping activity sequences
-- claiming the same physical space, with no way to tell which one Work
-- Allocation/Reporting should actually follow. The app-level check
-- (POST/PUT /api/dependency-master) already refuses this; this is the
-- DB-level backstop against a race between two concurrent requests both
-- passing that check before either has inserted.

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'UX_DependencyMaster_RoomId' AND object_id = OBJECT_ID('dbo.DependencyMaster')
)
BEGIN
  CREATE UNIQUE INDEX UX_DependencyMaster_RoomId ON dbo.DependencyMaster(RoomId);
  PRINT 'Created UX_DependencyMaster_RoomId';
END
ELSE
  PRINT 'UX_DependencyMaster_RoomId already exists — skipping create';
GO
