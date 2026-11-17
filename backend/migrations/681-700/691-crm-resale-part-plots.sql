-- Migration 691: a resale case can sell some of the plots on a multi-plot booking.
--   CrmUnitResale.PlotIds: the plots this case sells, comma-separated PlotMaster ids. NULL = the whole booking (as
--   before). When it names some of the booking's plots, the transfer moves those plots, at their own booked prices,
--   to a new booking for the buyer (CrmUnitResale.ToBookingId), with the paid money shared by those prices; the
--   seller keeps the rest of the booking.
-- Safe to run again.
IF COL_LENGTH('dbo.CrmUnitResale', 'PlotIds') IS NULL
  ALTER TABLE dbo.CrmUnitResale ADD PlotIds NVARCHAR(400) NULL;
GO
PRINT 'Migration 691 complete: resale case can name the plots it sells';
