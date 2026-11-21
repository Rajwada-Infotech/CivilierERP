-- Migration 285: Extra Work (Extra Charges) can now be added at the
-- Application stage, same as Parking already could — no scarce/exclusive
-- resource is involved (unlike a physical parking slot), so this is a
-- direct row (ApplicationId set, BookingId NULL until the booking exists),
-- not a hold-then-convert flow like Parking's.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmExtraCharge') AND name = 'ApplicationId')
BEGIN
  ALTER TABLE dbo.CrmExtraCharge ADD ApplicationId INT NULL;
  PRINT 'Added CrmExtraCharge.ApplicationId';
END
GO

-- BookingId was NOT NULL (unlike CrmParkingAllotment.BookingId, which is
-- already nullable for exactly this reason) — an Application-stage row has
-- no Booking yet by definition, so this must allow NULL or every insert
-- from the new Application-stage route fails outright.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmExtraCharge') AND name = 'BookingId' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.CrmExtraCharge ALTER COLUMN BookingId INT NULL;
  PRINT 'CrmExtraCharge.BookingId is now nullable';
END
GO
