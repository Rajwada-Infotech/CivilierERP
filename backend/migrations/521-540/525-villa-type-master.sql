-- Migration 525: villa types become master data.
--
-- A plotted layout plans a villa design for each plot (Silver Woods: Type 1-7).
-- Each design has its own base land area, built-up area and, optionally, a
-- super built-up area. Before this they had nowhere to live, so converting
-- plots to a villa meant typing the built-up area by hand each time, and the
-- dialog guessed it from the land area, which is a different number.
--
--   dbo.VillaTypeMaster          one row per design, per project
--   PlotMaster.PlannedVillaTypeId  the design planned for that plot (optional)
--   UnitMaster.VillaTypeId         the design the villa was built to
--
-- Types are per project: "Type 4" in one layout says nothing about another.
-- Safe to re-run.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VillaTypeMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.VillaTypeMaster (
    Id                   INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_VillaTypeMaster PRIMARY KEY,
    ProjectId            INT           NOT NULL,
    Code                 NVARCHAR(20)  NOT NULL,
    Name                 NVARCHAR(100) NOT NULL,
    -- Optional room layout (BHK) the design follows; feeds the villa's rooms.
    LayoutTypeId         INT NULL,
    BaseLandAreaSqFt     DECIMAL(18,2) NULL,
    BuiltUpAreaSqFt      DECIMAL(18,2) NOT NULL,
    SuperBuiltUpAreaSqFt DECIMAL(18,2) NULL,
    SortOrder            INT           NOT NULL CONSTRAINT DF_VillaTypeMaster_Sort DEFAULT (100),
    IsActive             BIT           NOT NULL CONSTRAINT DF_VillaTypeMaster_IsActive DEFAULT (1),
    CreatedBy            INT NULL,
    CreatedAt            DATETIME2(0)  NOT NULL CONSTRAINT DF_VillaTypeMaster_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy            INT NULL,
    UpdatedAt            DATETIME2(0) NULL,
    CONSTRAINT FK_VillaTypeMaster_Layout FOREIGN KEY (LayoutTypeId) REFERENCES dbo.RoomLayoutType(Id),
    CONSTRAINT CK_VillaTypeMaster_Areas CHECK (BuiltUpAreaSqFt > 0
      AND (SuperBuiltUpAreaSqFt IS NULL OR SuperBuiltUpAreaSqFt >= BuiltUpAreaSqFt)
      AND (BaseLandAreaSqFt IS NULL OR BaseLandAreaSqFt > 0))
  );
  CREATE UNIQUE INDEX UX_VillaTypeMaster_Code ON dbo.VillaTypeMaster(ProjectId, Code) WHERE IsActive = 1;
  PRINT 'Migration 525: created dbo.VillaTypeMaster.';
END
GO

IF COL_LENGTH('dbo.PlotMaster', 'PlannedVillaTypeId') IS NULL
  ALTER TABLE dbo.PlotMaster ADD PlannedVillaTypeId INT NULL
    CONSTRAINT FK_PlotMaster_PlannedVillaType FOREIGN KEY REFERENCES dbo.VillaTypeMaster(Id);
GO

IF COL_LENGTH('dbo.UnitMaster', 'VillaTypeId') IS NULL
  ALTER TABLE dbo.UnitMaster ADD VillaTypeId INT NULL
    CONSTRAINT FK_UnitMaster_VillaType FOREIGN KEY REFERENCES dbo.VillaTypeMaster(Id);
GO

PRINT 'Migration 525: villa type master ready.';
GO
