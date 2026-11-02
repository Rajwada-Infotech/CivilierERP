-- Migration 589: the agreed rate per sq ft keeps 4 decimals on applications and bookings.
--
-- When staff type the flat's price instead of the rate, the rate is worked out as
-- price / area (to 4 decimals, so area x rate lands back on the price). These columns
-- held 2 decimals, so the saved rate was rounded and the booking's price drifted from
-- what was agreed: Rs 30,00,000 on 1,234 sq ft became a rate of 2,431.12 and a price of
-- Rs 30,00,002.08. Widening keeps every existing value unchanged (2 decimals fit in 4).
--
-- Unit Master's own list rate stays at 2 decimals: it is typed, never worked out.
-- Safe to run again.

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'RatePerSqFt' AND scale < 4)
  ALTER TABLE dbo.CrmApplication ALTER COLUMN RatePerSqFt DECIMAL(18, 4) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'RatePerSqFt' AND scale < 4)
  ALTER TABLE dbo.CrmBooking ALTER COLUMN RatePerSqFt DECIMAL(18, 4) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBookingUnit') AND name = 'RatePerSqFt' AND scale < 4)
  ALTER TABLE dbo.CrmBookingUnit ALTER COLUMN RatePerSqFt DECIMAL(18, 4) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBookingPlot') AND name = 'RatePerSqFt' AND scale < 4)
  ALTER TABLE dbo.CrmBookingPlot ALTER COLUMN RatePerSqFt DECIMAL(18, 4) NULL;
GO
