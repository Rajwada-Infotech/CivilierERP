-- Migration 283: Fixed, HSN-Master-driven GST for CRM Bookings
--
-- Business rule (explicit, non-negotiable per product owner):
--   Unit Value + Parking Total <= Rs. 45,00,000  -> 1% GST  (affordable residential)
--   Unit Value + Parking Total >  Rs. 45,00,000  -> 5% GST  (other residential)
--   Extra Work (Extra Charges)  -> always 18% GST
-- These rates are never entered/edited per-booking — they are resolved live
-- from dbo.HSN every time the booking's totals change, and the ONLY way to
-- change a rate going forward is editing the HSN Master row itself. Three
-- new dbo.HSN rows back these rates (none existed before — the 59 pre-
-- existing rows are all materials/works-contract services, none at 1% or 5%).
-- New columns on CrmBooking store the resolved snapshot (same pattern as
-- CrmParkingAllotment.GstRateSnapshot) so a later HSN Master edit doesn't
-- retroactively rewrite GST on bookings already priced under the old rate.

IF NOT EXISTS (SELECT 1 FROM dbo.HSN WHERE HCode = '9954AFH')
BEGIN
  INSERT INTO dbo.HSN (HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, CreatedBy, CreatedAt)
  VALUES ('9954AFH', 'Construction of Affordable Residential Apartment (Unit + Parking value <= Rs. 45 Lakh)', 'Affordable Residential', 0.5, 0.5, 1, 1, (SELECT MIN(id) FROM dbo.users), SYSDATETIME());
  PRINT 'Inserted HSN 9954AFH (1%)';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.HSN WHERE HCode = '9954OTH')
BEGIN
  INSERT INTO dbo.HSN (HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, CreatedBy, CreatedAt)
  VALUES ('9954OTH', 'Construction of Other (Non-Affordable) Residential Apartment (Unit + Parking value > Rs. 45 Lakh)', 'Other Residential', 2.5, 2.5, 5, 1, (SELECT MIN(id) FROM dbo.users), SYSDATETIME());
  PRINT 'Inserted HSN 9954OTH (5%)';
END
GO

IF NOT EXISTS (SELECT 1 FROM dbo.HSN WHERE HCode = '9954EXW')
BEGIN
  INSERT INTO dbo.HSN (HCode, HDescription, HShortDescription, HCGST, HSGST, HIGST, HStatus, CreatedBy, CreatedAt)
  VALUES ('9954EXW', 'Extra Work / Additional Construction Charges', 'Extra Work', 9, 9, 18, 1, (SELECT MIN(id) FROM dbo.users), SYSDATETIME());
  PRINT 'Inserted HSN 9954EXW (18%)';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'UnitParkingGstRate')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD UnitParkingGstRate DECIMAL(5,2) NULL;
  PRINT 'Added CrmBooking.UnitParkingGstRate';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'UnitParkingGstAmount')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD UnitParkingGstAmount DECIMAL(18,2) NULL;
  PRINT 'Added CrmBooking.UnitParkingGstAmount';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'ExtraWorkGstAmount')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD ExtraWorkGstAmount DECIMAL(18,2) NULL;
  PRINT 'Added CrmBooking.ExtraWorkGstAmount';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'TotalGstAmount')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD TotalGstAmount DECIMAL(18,2) NULL;
  PRINT 'Added CrmBooking.TotalGstAmount';
END
GO
