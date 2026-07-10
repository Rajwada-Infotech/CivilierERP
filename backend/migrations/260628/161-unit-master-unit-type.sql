-- ============================================================
-- Migration 161: Type of Unit on Unit Master (1 BHK, 2 BHK, etc.)
-- Previously UnitType was a free-form field re-typed by hand every time a
-- unit was picked elsewhere (e.g. CrmBooking's create dialog). It now lives
-- once on dbo.UnitMaster and is auto-fetched everywhere the unit is
-- selected, instead of being chosen manually per transaction.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'UnitType')
BEGIN
  ALTER TABLE dbo.UnitMaster ADD UnitType NVARCHAR(50) NULL;
END
GO

PRINT 'Migration 161 complete — UnitType added to UnitMaster';
