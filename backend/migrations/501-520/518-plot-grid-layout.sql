-- Plot Master matrix layout. GridRow/GridCol are 0-based cell coordinates inside one block's grid.
-- NULL/NULL = not placed yet. Safe to re-run. No GO separators (index is created via EXEC).

IF COL_LENGTH('dbo.PlotMaster', 'GridRow') IS NULL ALTER TABLE dbo.PlotMaster ADD GridRow INT NULL;
IF COL_LENGTH('dbo.PlotMaster', 'GridCol') IS NULL ALTER TABLE dbo.PlotMaster ADD GridCol INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PlotMaster_GridCell' AND object_id = OBJECT_ID('dbo.PlotMaster'))
  EXEC('CREATE UNIQUE INDEX UX_PlotMaster_GridCell ON dbo.PlotMaster (BlockId, GridRow, GridCol) WHERE IsActive = 1 AND GridRow IS NOT NULL AND GridCol IS NOT NULL');

IF OBJECT_ID('dbo.PlotBlockLayout', 'U') IS NULL
  CREATE TABLE dbo.PlotBlockLayout (
    BlockId   INT       NOT NULL CONSTRAINT PK_PlotBlockLayout PRIMARY KEY,
    GridRows  INT       NOT NULL,
    GridCols  INT       NOT NULL,
    UpdatedBy INT       NULL,
    UpdatedAt DATETIME2 NOT NULL CONSTRAINT DF_PlotBlockLayout_UpdatedAt DEFAULT SYSDATETIME()
  );
