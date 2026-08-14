-- 330: Room Category Master + Unit Room Config (BHK) + Room Composition
--
-- Naming note: dbo.RoomMaster already exists (ProjectId/BlockId/UnitId/
-- RoomName/Floor — see backend/routes/roomMaster.js and the admin
-- RoomMaster.tsx page at /crm/setup/room-master) and is a *different*
-- feature entirely. The "Room Master (BHK Type per Unit)" concept from
-- this workflow spec is deliberately named dbo.UnitRoomConfig here instead
-- of reusing/renaming RoomMaster, to avoid clobbering that existing table.

-- ── Room Category Master — standalone, admin-editable list of room types.
-- CategoryName is the stable internal reference (never shown to users,
-- never renamed); Alias is the editable display label. Existing
-- RoomComposition rows reference CategoryId, so renaming Alias later never
-- breaks anything already saved.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RoomCategoryMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.RoomCategoryMaster (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    CategoryName  NVARCHAR(100) NOT NULL,
    Alias         NVARCHAR(150) NOT NULL,
    IsActive      BIT NOT NULL DEFAULT 1,
    SortOrder     INT NOT NULL DEFAULT 0,
    CreatedBy     NVARCHAR(200) NULL,
    CreatedAt     DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy     NVARCHAR(200) NULL,
    UpdatedAt     DATETIME2(3) NULL,
    CONSTRAINT UX_RoomCategoryMaster_CategoryName UNIQUE (CategoryName)
  );
END
GO

-- ── Unit Room Config — one BHK profile per Unit. Named UnitRoomConfig
-- (not "RoomMaster") to avoid the collision noted above.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'UnitRoomConfig' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.UnitRoomConfig (
    Id          INT IDENTITY(1,1) PRIMARY KEY,
    UnitId      INT NOT NULL,
    BhkType     NVARCHAR(10) NOT NULL,
    IsActive    BIT NOT NULL DEFAULT 1,
    CreatedBy   NVARCHAR(200) NULL,
    CreatedAt   DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy   NVARCHAR(200) NULL,
    UpdatedAt   DATETIME2(3) NULL,
    CONSTRAINT FK_UnitRoomConfig_Unit FOREIGN KEY (UnitId) REFERENCES dbo.UnitMaster(Id),
    CONSTRAINT CK_UnitRoomConfig_BhkType CHECK (BhkType IN ('1BHK','2BHK','3BHK','4BHK')),
    -- One active BHK profile per Unit — the composition builder always
    -- upserts against this rather than piling up duplicate profiles.
    CONSTRAINT UX_UnitRoomConfig_UnitId UNIQUE (UnitId)
  );
END
GO

-- ── Room Composition — quantity of each Room Category under one Unit's
-- BHK profile.
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'RoomComposition' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.RoomComposition (
    Id                INT IDENTITY(1,1) PRIMARY KEY,
    UnitRoomConfigId  INT NOT NULL,
    RoomCategoryId    INT NOT NULL,
    Quantity          INT NOT NULL DEFAULT 0,
    CreatedAt         DATETIME2(3) NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt         DATETIME2(3) NULL,
    CONSTRAINT FK_RoomComposition_UnitRoomConfig FOREIGN KEY (UnitRoomConfigId) REFERENCES dbo.UnitRoomConfig(Id),
    CONSTRAINT FK_RoomComposition_RoomCategory FOREIGN KEY (RoomCategoryId) REFERENCES dbo.RoomCategoryMaster(Id),
    CONSTRAINT CK_RoomComposition_Quantity CHECK (Quantity >= 0),
    CONSTRAINT UX_RoomComposition_Config_Category UNIQUE (UnitRoomConfigId, RoomCategoryId)
  );
END
GO

-- ── Seed the standard categories (user can rename/add more later via the
-- Room Category Master admin screen).
IF NOT EXISTS (SELECT 1 FROM dbo.RoomCategoryMaster)
BEGIN
  INSERT INTO dbo.RoomCategoryMaster (CategoryName, Alias, IsActive, SortOrder) VALUES
    ('BEDROOM',        'Bedroom',        1, 10),
    ('MASTER_BEDROOM', 'Master Bedroom', 1, 20),
    ('KITCHEN',        'Kitchen',        1, 30),
    ('HALL_ROOM',      'Hall Room',      1, 40),
    ('BATHROOM',       'Bathroom',       1, 50),
    ('BALCONY',        'Balcony',        1, 60);
END
GO
