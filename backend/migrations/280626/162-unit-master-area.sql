-- ============================================================
-- Migration 162: Area (sq ft) on Unit Master
-- Area is a fixed physical attribute of the unit itself, so — same as
-- UnitType (migration 161) — it now lives once on dbo.UnitMaster and is
-- auto-fetched everywhere the unit is selected (e.g. CrmBooking), instead
-- of being re-typed by hand on every booking.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.UnitMaster') AND name = 'AreaSqFt')
BEGIN
  ALTER TABLE dbo.UnitMaster ADD AreaSqFt DECIMAL(18,2) NULL;
END
GO

PRINT 'Migration 162 complete — AreaSqFt added to UnitMaster';
