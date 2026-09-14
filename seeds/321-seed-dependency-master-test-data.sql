-- Seed: mock data for testing the redesigned Dependency Master workflow.
-- One-off test/demo data — not part of the live migration chain (see
-- backend/seeds/README.md). Run manually against a dev database.
--
-- Adds:
--   1. A few Rooms under Unit 28 (TSTRSD/A/101, Project 16 "TEST RESDENCE",
--      Tower "A") on Floor '1', so the Project > Tower > Floor > Flat > Room
--      cascade has something to resolve all the way down.
--   2. An "Interior Works" Activity Master group with 5 real activities
--      (activity_type = 1) to pick from in the Activity Chain Builder.

DECLARE @SystemUserEmail NVARCHAR(300) = (
  SELECT TOP 1 u.email FROM dbo.users u
  JOIN dbo.Role r ON r.RId = u.RoleId
  WHERE r.RName IN ('super_admin', 'admin')
  ORDER BY u.id
);

-- ── Rooms (Unit 28 = TSTRSD/A/101, BlockId 14 = Tower "A", Project 16) ──────
IF NOT EXISTS (SELECT 1 FROM dbo.RoomMaster WHERE UnitId = 28 AND RoomName = 'Bedroom 1')
BEGIN
  INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, Floor, IsActive, CreatedAt)
  VALUES (16, 14, 28, 'Bedroom 1', '1', 1, SYSDATETIME());
END

IF NOT EXISTS (SELECT 1 FROM dbo.RoomMaster WHERE UnitId = 28 AND RoomName = 'Living Room')
BEGIN
  INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, Floor, IsActive, CreatedAt)
  VALUES (16, 14, 28, 'Living Room', '1', 1, SYSDATETIME());
END

IF NOT EXISTS (SELECT 1 FROM dbo.RoomMaster WHERE UnitId = 28 AND RoomName = 'Kitchen')
BEGIN
  INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, Floor, IsActive, CreatedAt)
  VALUES (16, 14, 28, 'Kitchen', '1', 1, SYSDATETIME());
END

-- A second flat on the same floor, so the Flat dropdown has more than one option.
IF NOT EXISTS (SELECT 1 FROM dbo.RoomMaster WHERE UnitId = 29 AND RoomName = 'Bedroom 1')
BEGIN
  INSERT INTO dbo.RoomMaster (ProjectId, BlockId, UnitId, RoomName, Floor, IsActive, CreatedAt)
  VALUES (16, 14, 29, 'Bedroom 1', '1', 1, SYSDATETIME());
END
GO

-- ── Activity Master: group + 5 activities ───────────────────────────────────
DECLARE @SystemUserEmail NVARCHAR(300) = (
  SELECT TOP 1 u.email FROM dbo.users u
  JOIN dbo.Role r ON r.RId = u.RoleId
  WHERE r.RName IN ('super_admin', 'admin')
  ORDER BY u.id
);

DECLARE @GroupId INT;
SELECT @GroupId = id FROM dbo.ActivityMaster WHERE activity_name = 'Interior Works' AND activity_type = 0;
IF @GroupId IS NULL
BEGIN
  INSERT INTO dbo.ActivityMaster (activity_name, short_description, activity_type, is_active, created_by, created_datetime)
  VALUES ('Interior Works', 'Room-level interior finishing activities', 0, 1, @SystemUserEmail, GETDATE());
  SET @GroupId = SCOPE_IDENTITY();
END

DECLARE @Acts TABLE (ActName NVARCHAR(200), ShortDesc NVARCHAR(200));
INSERT INTO @Acts (ActName, ShortDesc) VALUES
  ('Electrical Wiring', 'Conduit laying and wiring'),
  ('Plastering', 'Wall and ceiling plaster'),
  ('Tiling', 'Floor and wall tiling'),
  ('Painting', 'Primer and finish coats'),
  ('Fixture Installation', 'Switches, fittings, fixtures');

INSERT INTO dbo.ActivityMaster (activity_name, short_description, activity_type, group_id, belongsTo, is_active, created_by, created_datetime)
SELECT a.ActName, a.ShortDesc, 1, @GroupId, CAST(@GroupId AS NVARCHAR(50)), 1, @SystemUserEmail, GETDATE()
FROM @Acts a
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.ActivityMaster am WHERE am.activity_name = a.ActName AND am.activity_type = 1
);
GO

PRINT 'Seeded Dependency Master test data (Rooms + Activities).';
GO
