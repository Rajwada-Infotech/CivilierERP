-- Migration 503: UnitMaster gains a KIND, plot attributes, and villa lineage.
--
-- UnitMaster is flat-shaped today: FloorNo, CarpetAreaSqFt, BuiltUpAreaSqFt,
-- SuperBuiltUpAreaSqFt, OpenTerraceAreaSqFt. None of that describes a plot of
-- land, which is instead identified by its dimensions, facing, whether it sits
-- on a corner, and its own survey / sub-division number for registration.
--
-- WHY UnitKind LIVES ON THE UNIT AND NOT ON THE PROJECT
-- Taxability follows what is actually being sold, never the project it sits in.
-- A mixed township holds both plotted and tower blocks, so a booking there can
-- contain either. Deriving "is this GST-free land?" from the project type would
-- silently tax land the moment such a project exists; deriving it from the unit
-- is correct in every case, including mixed, with no special-casing.
--
-- Project/block type (migration 502) therefore drives UI and defaults only —
-- which auto-setup path runs, floor grid vs site map. UnitKind drives money.
--
-- PLOT vs VILLA are separate rows, never one row mutating into the other:
--   * the plot is sold first under a land sale agreement (no GST),
--   * the villa is built later under a separate construction agreement (GST),
--   * and the plot must survive intact afterwards, because it stays the legally
--     registered object.
-- CrmUnitLineage links them, many-to-many, because a buyer who takes 2-3 plots
-- together commonly builds ONE villa spanning them. A ParentUnitId column could
-- not represent that at all.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'UnitKind')
BEGIN
  -- 'FLAT' (the existing, implicit meaning of every current row), 'PLOT', 'VILLA'.
  ALTER TABLE dbo.UnitMaster ADD UnitKind NVARCHAR(20) NOT NULL
    CONSTRAINT DF_UnitMaster_UnitKind DEFAULT (N'FLAT');
  PRINT 'Migration 503: added UnitMaster.UnitKind (existing rows default to FLAT).';
END
ELSE
  PRINT 'Migration 503: UnitMaster.UnitKind already exists — skipped.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_UnitMaster_UnitKind')
  ALTER TABLE dbo.UnitMaster WITH NOCHECK
    ADD CONSTRAINT CK_UnitMaster_UnitKind CHECK (UnitKind IN (N'FLAT', N'PLOT', N'VILLA'));
GO

-- Plot attributes. Nullable and only meaningful when UnitKind = 'PLOT' (or a
-- VILLA describing the land it occupies). A bounded, well-known set, so real
-- typed columns rather than a JSON bag — the unit matrix and pricing need to
-- filter and sort on facing and corner, which JSON would make painful.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'PlotNo')
BEGIN
  ALTER TABLE dbo.UnitMaster ADD
    PlotNo            NVARCHAR(50)   NULL,  -- as printed on the sanctioned layout
    SurveyNo          NVARCHAR(100)  NULL,  -- survey / sub-division no, per-plot registration
    -- Frontage x depth in feet. Kept alongside AreaSqFt rather than replacing
    -- it: an irregular plot's area is not the product of two sides.
    PlotWidthFt       DECIMAL(18,2)  NULL,
    PlotDepthFt       DECIMAL(18,2)  NULL,
    Facing            NVARCHAR(20)   NULL,  -- N / S / E / W / NE / NW / SE / SW
    IsCornerPlot      BIT            NULL,
    RoadWidthFt       DECIMAL(18,2)  NULL,
    -- Registrar's guideline (circle) value per sq ft. Stamp duty is charged on
    -- the higher of consideration and guideline value, and a multi-plot sale
    -- has to apportion back to each plot at registration time.
    GuidelineRatePerSqFt DECIMAL(18,2) NULL;
  PRINT 'Migration 503: added plot attribute columns to UnitMaster.';
END
ELSE
  PRINT 'Migration 503: UnitMaster plot attributes already exist — skipped.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_UnitMaster_Kind_Project' AND object_id = OBJECT_ID('dbo.UnitMaster'))
  CREATE NONCLUSTERED INDEX IX_UnitMaster_Kind_Project
    ON dbo.UnitMaster (UnitKind, ProjectId, BlockId) WHERE IsActive = 1;
GO

-- Villa <-> plot(s). Many-to-many by design (see header).
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CrmUnitLineage' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CrmUnitLineage (
    Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_CrmUnitLineage PRIMARY KEY,
    -- The constructed unit (UnitKind = 'VILLA').
    VillaUnitId   INT NOT NULL,
    -- A plot it stands on (UnitKind = 'PLOT'). One row per plot.
    PlotUnitId    INT NOT NULL,
    IsActive      BIT NOT NULL CONSTRAINT DF_CrmUnitLineage_IsActive DEFAULT (1),
    CreatedBy     INT NULL,
    CreatedAt     DATETIME2(0) NOT NULL CONSTRAINT DF_CrmUnitLineage_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_CrmUnitLineage_Villa FOREIGN KEY (VillaUnitId) REFERENCES dbo.UnitMaster(Id),
    CONSTRAINT FK_CrmUnitLineage_Plot  FOREIGN KEY (PlotUnitId)  REFERENCES dbo.UnitMaster(Id)
  );
  CREATE UNIQUE INDEX UX_CrmUnitLineage_Pair ON dbo.CrmUnitLineage(VillaUnitId, PlotUnitId) WHERE IsActive = 1;
  CREATE NONCLUSTERED INDEX IX_CrmUnitLineage_Plot ON dbo.CrmUnitLineage(PlotUnitId) WHERE IsActive = 1;
  PRINT 'Migration 503: created dbo.CrmUnitLineage (villa <-> plots, many-to-many).';
END
ELSE
  PRINT 'Migration 503: dbo.CrmUnitLineage already exists — skipped.';
GO
