-- Migration 509: a plot template, so plotted blocks can be laid out too.
--
-- Auto Project Setup is floor-driven end to end: blocks -> floors
-- (CrmProjectAutoSetupFloor) -> units per floor. A plotted block has no floors
-- at all, so that path cannot express it — picking "Plotted Development" on a
-- project today still walks the user into defining floors.
--
-- This mirrors CrmProjectAutoSetupUnitTemplate, but hangs off the BLOCK rather
-- than a floor, because a block IS the layout in a plotted development.
--
-- SIZES ARE A STARTING POINT, NOT A RULE. Plots in a real layout differ in
-- size, so DefaultAreaSqFt only seeds the generated rows; each plot is then
-- edited individually with its own area, dimensions, facing and survey number
-- (migration 503 added those columns). Generating identical plots and refining
-- them beats making someone hand-create sixty rows.
--
-- One template per block, which is why the unique index is on BlockId alone —
-- unlike the unit template, where a block legitimately holds several rows (one
-- per unit type).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmProjectAutoSetupPlotTemplate' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmProjectAutoSetupPlotTemplate (
    Id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmPlotTemplate PRIMARY KEY,
    BlockId             INT NOT NULL,
    ProjectId           INT NOT NULL,

    -- How many plots to lay out, and how to number them. The prefix is stored
    -- rather than derived from the block name so a layout can follow the
    -- sanctioned plan's own numbering, which often does not match.
    PlotCount           INT NOT NULL CONSTRAINT DF_CrmPlotTemplate_Count DEFAULT (0),
    NumberPrefix        NVARCHAR(20) NULL,
    StartNumber         INT NOT NULL CONSTRAINT DF_CrmPlotTemplate_Start DEFAULT (1),

    -- Seed values copied onto every generated plot, then edited per plot.
    DefaultAreaSqFt     DECIMAL(18,2) NULL,
    DefaultRatePerSqFt  DECIMAL(18,2) NULL,
    DefaultFacing       NVARCHAR(20)  NULL,
    DefaultRoadWidthFt  DECIMAL(18,2) NULL,

    -- Set once plots have been generated, so a second run does not silently
    -- double the layout. Same guard CrmProjectAutoSetupFloor.IsGenerated gives
    -- the floor path.
    IsGenerated         BIT NOT NULL CONSTRAINT DF_CrmPlotTemplate_IsGenerated DEFAULT (0),
    GeneratedAt         DATETIME2(0) NULL,

    IsActive            BIT NOT NULL CONSTRAINT DF_CrmPlotTemplate_IsActive DEFAULT (1),
    CreatedBy           INT NULL,
    CreatedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_CrmPlotTemplate_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy           INT NULL,
    UpdatedAt           DATETIME2(0) NULL,

    CONSTRAINT FK_CrmPlotTemplate_Block FOREIGN KEY (BlockId) REFERENCES dbo.BlockMaster(Id)
  );
  CREATE UNIQUE INDEX UX_CrmPlotTemplate_Block ON dbo.CrmProjectAutoSetupPlotTemplate(BlockId) WHERE IsActive = 1;
  CREATE NONCLUSTERED INDEX IX_CrmPlotTemplate_Project ON dbo.CrmProjectAutoSetupPlotTemplate(ProjectId) WHERE IsActive = 1;
  PRINT 'Migration 509: created dbo.CrmProjectAutoSetupPlotTemplate.';
END
ELSE
  PRINT 'Migration 509: dbo.CrmProjectAutoSetupPlotTemplate already exists — skipped.';
GO
