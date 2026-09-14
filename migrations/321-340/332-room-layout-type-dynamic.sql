-- 332: Dynamic BHK/layout types — the 4 fixed BHK types (migration 330's
-- CK_UnitRoomConfig_BhkType) are now just the seeded defaults, not a hard
-- ceiling. dbo.RoomLayoutType lets the composition builder add arbitrary
-- layout types (Duplex, Triplex, Penthouse, ...) the same way the existing
-- 4 already work — one saved composition template per type, matched
-- against dbo.UnitMaster.UnitType.
--
-- TypeKey is the normalized (uppercased, space-stripped) matching key —
-- same normalizeBhkType() convention already used for UnitMaster.UnitType
-- ("3 BHK" -> "3BHK") — Label is what's actually shown in the picker.

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RoomLayoutType' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.RoomLayoutType (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    TypeKey     NVARCHAR(20) NOT NULL,
    Label       NVARCHAR(50) NOT NULL,
    IsSystem    BIT NOT NULL DEFAULT 0,
    SortOrder   INT NOT NULL DEFAULT 100,
    IsActive    BIT NOT NULL DEFAULT 1,
    CreatedBy   NVARCHAR(200) NULL,
    CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT UX_RoomLayoutType_TypeKey UNIQUE (TypeKey)
  );
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.RoomLayoutType)
BEGIN
  INSERT INTO dbo.RoomLayoutType (TypeKey, Label, IsSystem, SortOrder) VALUES
    ('1BHK', '1 BHK', 1, 10),
    ('2BHK', '2 BHK', 1, 20),
    ('3BHK', '3 BHK', 1, 30),
    ('4BHK', '4 BHK', 1, 40);
END
GO

-- dbo.UnitRoomConfig.BhkType is no longer restricted to the fixed 4 —
-- drop the CHECK constraint from migration 330 so any registered
-- RoomLayoutType.TypeKey can be stored there.
IF EXISTS (SELECT * FROM sys.check_constraints WHERE name = 'CK_UnitRoomConfig_BhkType')
BEGIN
  ALTER TABLE dbo.UnitRoomConfig DROP CONSTRAINT CK_UnitRoomConfig_BhkType;
END
GO
