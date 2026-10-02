-- Migration 514: a resale can target a PLOT or a constructed UNIT.
--
-- Migration 506 created dbo.CrmUnitResale with a NOT NULL UnitId pointing at
-- dbo.UnitMaster, because plots lived there at the time. Migration 511 then
-- moved plot inventory into dbo.PlotMaster and reserved UnitMaster for
-- constructed assets — which left the resale table unable to reference the very
-- thing it exists for. An investor exiting a plot had nowhere to record it.
--
-- Both targets are real and both must be supported:
--   * a PLOT resold by an investor before (or instead of) any villa being built
--   * a constructed UNIT (villa, shop) resold after it exists
--
-- So UnitId becomes nullable, PlotId is added, and a CHECK enforces that
-- EXACTLY ONE is set. Allowing neither would create a resale that references
-- nothing; allowing both would make "what changed hands" ambiguous, and every
-- reader would have to invent its own precedence rule.
--
-- Safe to restructure in place: the table is empty (no resale has been recorded
-- yet), so nothing is migrated or reinterpreted here.

IF COL_LENGTH('dbo.CrmUnitResale', 'PlotId') IS NULL
BEGIN
  ALTER TABLE dbo.CrmUnitResale ADD PlotId INT NULL;
  PRINT 'Migration 514: added CrmUnitResale.PlotId.';
END
ELSE
  PRINT 'Migration 514: CrmUnitResale.PlotId already exists — skipped.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CrmUnitResale_Plot')
  ALTER TABLE dbo.CrmUnitResale WITH NOCHECK
    ADD CONSTRAINT FK_CrmUnitResale_Plot FOREIGN KEY (PlotId) REFERENCES dbo.PlotMaster(Id);
GO

-- UnitId must become optional now that a resale may instead name a plot.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmUnitResale') AND name = 'UnitId' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.CrmUnitResale ALTER COLUMN UnitId INT NULL;
  PRINT 'Migration 514: CrmUnitResale.UnitId is now nullable.';
END
ELSE
  PRINT 'Migration 514: CrmUnitResale.UnitId already nullable — skipped.';
GO

-- Exactly one target. Expressed as a CHECK rather than left to the routes, so
-- a bulk import or a direct script cannot create an ambiguous row either.
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_CrmUnitResale_OneTarget')
BEGIN
  ALTER TABLE dbo.CrmUnitResale WITH NOCHECK
    ADD CONSTRAINT CK_CrmUnitResale_OneTarget
    CHECK ((CASE WHEN PlotId IS NULL THEN 0 ELSE 1 END) + (CASE WHEN UnitId IS NULL THEN 0 ELSE 1 END) = 1);
  PRINT 'Migration 514: CrmUnitResale now requires exactly one of PlotId / UnitId.';
END
ELSE
  PRINT 'Migration 514: CK_CrmUnitResale_OneTarget already exists — skipped.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmUnitResale_Plot' AND object_id = OBJECT_ID('dbo.CrmUnitResale'))
  CREATE NONCLUSTERED INDEX IX_CrmUnitResale_Plot ON dbo.CrmUnitResale(PlotId) WHERE IsActive = 1 AND PlotId IS NOT NULL;
GO
