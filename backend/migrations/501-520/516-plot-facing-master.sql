-- Migration 516: plot facing becomes master data, with its own premium.
--
-- dbo.PlotMaster.Facing is free text today, typed into a box. Three problems
-- follow from that, and the third is the expensive one:
--
--   1. "North", "north" and "N" all coexist and never group, so no report can
--      answer "how many north-facing plots are left".
--   2. Nothing stops a typo becoming a permanent, invisible category.
--   3. A facing premium — real in every plotted layout — had nowhere to live,
--      so it would have been hardcoded in pricing or typed per plot by hand.
--
-- PremiumPercent is therefore ON THE FACING, not in code. A layout where east
-- plots carry 5% is a row edit, and the pricing engine asks the master rather
-- than carrying its own table of which direction is worth what.
--
-- Deliberately a master rather than a CHECK constraint: a CHECK would make
-- adding a facing a migration, which is exactly the hardcoding this removes.
-- PlotMaster.Facing stays an NVARCHAR holding the master's Code, so existing
-- rows and imports keep working and nothing has to be backfilled.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PlotFacingMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.PlotFacingMaster (
    Id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_PlotFacingMaster PRIMARY KEY,
    Code           NVARCHAR(20)  NOT NULL,
    Name           NVARCHAR(50)  NOT NULL,
    -- Added to a plot's rate as a percentage. 0 is the ordinary case and is
    -- stored explicitly rather than left NULL, so "no premium" is a decision
    -- on the record instead of missing data.
    PremiumPercent DECIMAL(6,3)  NOT NULL CONSTRAINT DF_PlotFacingMaster_Premium DEFAULT (0),
    SortOrder      INT           NOT NULL CONSTRAINT DF_PlotFacingMaster_Sort DEFAULT (100),
    IsActive       BIT           NOT NULL CONSTRAINT DF_PlotFacingMaster_IsActive DEFAULT (1),
    CreatedBy      INT NULL,
    CreatedAt      DATETIME2(0)  NOT NULL CONSTRAINT DF_PlotFacingMaster_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy      INT NULL,
    UpdatedAt      DATETIME2(0) NULL
  );
  CREATE UNIQUE INDEX UX_PlotFacingMaster_Code ON dbo.PlotFacingMaster(Code) WHERE IsActive = 1;
  PRINT 'Migration 516: created dbo.PlotFacingMaster.';
END
ELSE
  PRINT 'Migration 516: dbo.PlotFacingMaster already exists — skipped.';
GO

-- The eight compass directions, all at zero premium. Seeded as a starting
-- vocabulary only: every premium here is 0 because what a facing is worth is a
-- commercial decision for each project, not something this migration should
-- assert. Idempotent by Code, so re-running never duplicates and never
-- overwrites a premium someone has since set.
INSERT INTO dbo.PlotFacingMaster (Code, Name, PremiumPercent, SortOrder)
SELECT v.Code, v.Name, 0, v.SortOrder
FROM (VALUES
  ('N',  N'North',       10),
  ('S',  N'South',       20),
  ('E',  N'East',        30),
  ('W',  N'West',        40),
  ('NE', N'North-East',  50),
  ('NW', N'North-West',  60),
  ('SE', N'South-East',  70),
  ('SW', N'South-West',  80)
) AS v(Code, Name, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM dbo.PlotFacingMaster f WHERE f.Code = v.Code);
GO

DECLARE @Rows INT = (SELECT COUNT(*) FROM dbo.PlotFacingMaster WHERE IsActive = 1);
PRINT CONCAT('Migration 516 done. Active facings: ', @Rows,
             '. All seeded at 0% — set a premium per facing where the project charges one.');
GO
