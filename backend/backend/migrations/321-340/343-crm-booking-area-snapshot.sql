-- Snapshot the three area breakdown fields from UnitMaster onto CrmBooking
-- so every booking is a self-contained record of exactly what the unit
-- looked like at the time it was sold.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'CarpetAreaSqFt')
  ALTER TABLE dbo.CrmBooking ADD CarpetAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'BuiltUpAreaSqFt')
  ALTER TABLE dbo.CrmBooking ADD BuiltUpAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'SuperBuiltUpAreaSqFt')
  ALTER TABLE dbo.CrmBooking ADD SuperBuiltUpAreaSqFt DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'OpenTerraceAreaSqFt')
  ALTER TABLE dbo.CrmBooking ADD OpenTerraceAreaSqFt DECIMAL(18,2) NULL;
