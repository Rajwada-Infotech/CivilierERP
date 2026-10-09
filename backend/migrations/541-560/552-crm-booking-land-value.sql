-- Migration 552: the land part of a villa sold directly.
--
-- A villa built on plots nobody bought is sold whole — land and villa — at one
-- villa price, with no plot line on the booking. dbo.CrmBooking.LandValue holds
-- the land part of that price (the plots' area x rate from Plot Master, taken
-- when the booking is made) so GST and the ledger treat it as land, outside
-- GST, and tax only the rest. NULL for every other booking: a plot booking
-- carries its land on its plot lines, and a villa bought by the plot's owner
-- is construction only.

IF COL_LENGTH('dbo.CrmBooking', 'LandValue') IS NULL
  ALTER TABLE dbo.CrmBooking ADD LandValue DECIMAL(18, 2) NULL;
GO
