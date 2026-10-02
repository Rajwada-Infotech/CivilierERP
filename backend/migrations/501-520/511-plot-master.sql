-- Plot Master is the land inventory for plotted developments. Unit Master is
-- reserved for a constructed asset created after a plot (or group of plots)
-- is converted into a villa, shop, or other saleable unit.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PlotMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.PlotMaster (
    Id                    INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PlotMaster PRIMARY KEY,
    ProjectId             INT NOT NULL,
    BlockId               INT NOT NULL,
    PlotNo                NVARCHAR(50) NOT NULL,
    PlotName              NVARCHAR(100) NOT NULL,
    SurveyNo              NVARCHAR(100) NULL,
    AreaSqFt              DECIMAL(18,2) NULL,
    RatePerSqFt           DECIMAL(18,2) NULL,
    PlotWidthFt           DECIMAL(18,2) NULL,
    PlotDepthFt           DECIMAL(18,2) NULL,
    Facing                NVARCHAR(20) NULL,
    IsCornerPlot          BIT NULL,
    RoadWidthFt           DECIMAL(18,2) NULL,
    GuidelineRatePerSqFt  DECIMAL(18,2) NULL,
    ConvertedUnitId       INT NULL,
    ConvertedAt           DATETIME2(0) NULL,
    IsActive              BIT NOT NULL CONSTRAINT DF_PlotMaster_IsActive DEFAULT (1),
    CreatedBy             INT NULL,
    CreatedAt             DATETIME2(0) NOT NULL CONSTRAINT DF_PlotMaster_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy             INT NULL,
    UpdatedAt             DATETIME2(0) NULL,
    CONSTRAINT FK_PlotMaster_Project FOREIGN KEY (ProjectId) REFERENCES dbo.enterprise(id),
    CONSTRAINT FK_PlotMaster_Block FOREIGN KEY (BlockId) REFERENCES dbo.BlockMaster(Id),
    CONSTRAINT FK_PlotMaster_ConvertedUnit FOREIGN KEY (ConvertedUnitId) REFERENCES dbo.UnitMaster(Id)
  );
  CREATE UNIQUE INDEX UX_PlotMaster_Block_PlotNo ON dbo.PlotMaster(BlockId, PlotNo) WHERE IsActive = 1;
  CREATE NONCLUSTERED INDEX IX_PlotMaster_Project ON dbo.PlotMaster(ProjectId, BlockId) WHERE IsActive = 1;
  CREATE NONCLUSTERED INDEX IX_PlotMaster_ConvertedUnit ON dbo.PlotMaster(ConvertedUnitId) WHERE ConvertedUnitId IS NOT NULL;
END
GO

-- Keep any early UnitMaster PLOT rows available for historical foreign keys,
-- but move their master data into PlotMaster. New plotted setup never creates
-- a UnitMaster PLOT row.
INSERT INTO dbo.PlotMaster
  (ProjectId, BlockId, PlotNo, PlotName, SurveyNo, AreaSqFt, RatePerSqFt,
   PlotWidthFt, PlotDepthFt, Facing, IsCornerPlot, RoadWidthFt,
   GuidelineRatePerSqFt, IsActive, CreatedBy, CreatedAt)
SELECT u.ProjectId, u.BlockId, COALESCE(NULLIF(u.PlotNo, N''), u.UnitName), u.UnitName,
       u.SurveyNo, u.AreaSqFt, u.RatePerSqFt, u.PlotWidthFt, u.PlotDepthFt,
       u.Facing, u.IsCornerPlot, u.RoadWidthFt, u.GuidelineRatePerSqFt,
       u.IsActive, u.CreatedBy, u.CreatedAt
FROM dbo.UnitMaster u
WHERE u.UnitKind = N'PLOT'
  AND NOT EXISTS (
    SELECT 1 FROM dbo.PlotMaster p
    WHERE p.BlockId = u.BlockId AND p.PlotNo = COALESCE(NULLIF(u.PlotNo, N''), u.UnitName)
  );
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmApplicationPlot' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmApplicationPlot (
    Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmApplicationPlot PRIMARY KEY,
    ApplicationId INT NOT NULL REFERENCES dbo.CrmApplication(Id),
    PlotId        INT NOT NULL REFERENCES dbo.PlotMaster(Id),
    Status        NVARCHAR(30) NOT NULL CONSTRAINT DF_CrmApplicationPlot_Status DEFAULT (N'Active'),
    IsPrimary     BIT NOT NULL CONSTRAINT DF_CrmApplicationPlot_IsPrimary DEFAULT (0),
    CreatedBy     INT NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_CrmApplicationPlot_CreatedAt DEFAULT (SYSDATETIME())
  );
  CREATE UNIQUE INDEX UX_CrmApplicationPlot_Active ON dbo.CrmApplicationPlot(PlotId) WHERE Status = N'Active';
  CREATE NONCLUSTERED INDEX IX_CrmApplicationPlot_Application ON dbo.CrmApplicationPlot(ApplicationId) WHERE Status = N'Active';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmBookingPlot' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmBookingPlot (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmBookingPlot PRIMARY KEY,
    BookingId       INT NOT NULL REFERENCES dbo.CrmBooking(Id),
    PlotId          INT NOT NULL REFERENCES dbo.PlotMaster(Id),
    AreaSqFt        DECIMAL(18,2) NULL,
    RatePerSqFt     DECIMAL(18,2) NULL,
    PremiumAmount   DECIMAL(18,2) NULL,
    AllocatedValue  DECIMAL(18,2) NULL,
    Status          NVARCHAR(30) NOT NULL CONSTRAINT DF_CrmBookingPlot_Status DEFAULT (N'Active'),
    IsPrimary       BIT NOT NULL CONSTRAINT DF_CrmBookingPlot_IsPrimary DEFAULT (0),
    CreatedBy       INT NULL,
    CreatedAt       DATETIME2(0) NOT NULL CONSTRAINT DF_CrmBookingPlot_CreatedAt DEFAULT (SYSDATETIME())
  );
  CREATE UNIQUE INDEX UX_CrmBookingPlot_Active ON dbo.CrmBookingPlot(PlotId) WHERE Status = N'Active';
  CREATE UNIQUE INDEX UX_CrmBookingPlot_Primary ON dbo.CrmBookingPlot(BookingId) WHERE IsPrimary = 1 AND Status = N'Active';
  CREATE NONCLUSTERED INDEX IX_CrmBookingPlot_Booking ON dbo.CrmBookingPlot(BookingId) WHERE Status = N'Active';
END
GO
