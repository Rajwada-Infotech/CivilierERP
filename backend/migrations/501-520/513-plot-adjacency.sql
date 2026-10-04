-- Physical neighbour relationships for plotted inventory. Plot numbers are
-- labels, not geometry, so adjacency must be recorded explicitly before a
-- multi-plot construction conversion can rely on it.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PlotAdjacency' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.PlotAdjacency (
    Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PlotAdjacency PRIMARY KEY,
    PlotId          INT NOT NULL,
    AdjacentPlotId  INT NOT NULL,
    CreatedBy       INT NULL,
    CreatedAt       DATETIME2(0) NOT NULL CONSTRAINT DF_PlotAdjacency_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT FK_PlotAdjacency_Plot FOREIGN KEY (PlotId) REFERENCES dbo.PlotMaster(Id),
    CONSTRAINT FK_PlotAdjacency_AdjacentPlot FOREIGN KEY (AdjacentPlotId) REFERENCES dbo.PlotMaster(Id),
    CONSTRAINT CK_PlotAdjacency_Distinct CHECK (PlotId < AdjacentPlotId)
  );
  CREATE UNIQUE INDEX UX_PlotAdjacency_Pair ON dbo.PlotAdjacency(PlotId, AdjacentPlotId);
  CREATE INDEX IX_PlotAdjacency_Plot ON dbo.PlotAdjacency(PlotId, AdjacentPlotId);
  CREATE INDEX IX_PlotAdjacency_Adjacent ON dbo.PlotAdjacency(AdjacentPlotId, PlotId);
END
GO
