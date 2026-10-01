-- Migration 499: a booking carries its own BlockId.
--
-- THE PROBLEM
-- Every Company/Project/Block scope filter in CRM resolves the block by joining
-- UnitMaster through the booking's UnitId:
--
--     LEFT JOIN dbo.UnitMaster um ON um.Id = b.UnitId
--     ... AND um.BlockId = @blockId
--
-- A PLOT booking has UnitId NULL by design (plots live in dbo.PlotMaster since
-- migration 491, linked through dbo.CrmBookingPlot), so `um` is NULL, the
-- predicate is NULL, and the row is dropped. Not an error — the booking simply
-- is not there. 81 such filters exist across 31 route files, which means a land
-- sale vanishes from the Booking Register, the Sales Deed list, the Registry and
-- every other block-filtered view the moment someone picks a block.
--
-- THE FIX
-- Denormalise the block onto the booking so the filter has something to read
-- that does not depend on which inventory table the sale came from. One column
-- fixes all 81 sites as they are converted, instead of 81 separate joins each
-- needing its own plot-aware variant.
--
-- Denormalised rather than derived on the fly, deliberately: a booking's block
-- cannot change (the unit or plot it sold does not move), and the alternative —
-- a COALESCE across UnitMaster and a CrmBookingPlot/PlotMaster join — would add
-- that work to every filtered query in the module.
--
-- BlockName is already stored on CrmBooking for display; this is its id
-- counterpart, which is what the filters actually compare.

IF COL_LENGTH('dbo.CrmBooking', 'BlockId') IS NULL
BEGIN
  ALTER TABLE dbo.CrmBooking ADD BlockId INT NULL;
  PRINT 'Migration 499: added CrmBooking.BlockId.';
END
ELSE
  PRINT 'Migration 499: CrmBooking.BlockId already exists — skipped.';
GO

-- Backfill from the unit, for every ordinary booking.
UPDATE b
SET b.BlockId = u.BlockId
FROM dbo.CrmBooking b
JOIN dbo.UnitMaster u ON u.Id = b.UnitId
WHERE b.BlockId IS NULL AND u.BlockId IS NOT NULL;
GO

-- Backfill from the plots, for land bookings. A booking's plots are all in one
-- block in practice; MIN is used so a hand-built mixed-block booking still gets
-- a deterministic value rather than failing the update.
UPDATE b
SET b.BlockId = x.BlockId
FROM dbo.CrmBooking b
CROSS APPLY (
  SELECT MIN(p.BlockId) AS BlockId
  FROM dbo.CrmBookingPlot bp
  JOIN dbo.PlotMaster p ON p.Id = bp.PlotId
  WHERE bp.BookingId = b.Id AND bp.Status = N'Active'
) x
WHERE b.BlockId IS NULL AND x.BlockId IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CrmBooking_BlockId' AND object_id = OBJECT_ID('dbo.CrmBooking'))
  CREATE NONCLUSTERED INDEX IX_CrmBooking_BlockId ON dbo.CrmBooking(BlockId) WHERE BlockId IS NOT NULL;
GO

DECLARE @Total INT = (SELECT COUNT(*) FROM dbo.CrmBooking);
DECLARE @Set   INT = (SELECT COUNT(*) FROM dbo.CrmBooking WHERE BlockId IS NOT NULL);
DECLARE @Miss  INT = (
  SELECT COUNT(*) FROM dbo.CrmBooking b
  WHERE b.BlockId IS NULL
    AND (b.UnitId IS NOT NULL OR EXISTS (SELECT 1 FROM dbo.CrmBookingPlot bp WHERE bp.BookingId = b.Id AND bp.Status = N'Active'))
);
PRINT CONCAT('Migration 499 done. Bookings: ', @Total, ', BlockId set: ', @Set,
             ', still unresolved despite having a unit or plot: ', @Miss, ' (should be 0).');
GO
