-- Migration 087: Add BookingId to FollowupAgreements

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupAgreements') AND name = 'BookingId'
)
BEGIN
  ALTER TABLE dbo.FollowupAgreements
    ADD BookingId INT NULL;
END;
GO

-- Add FK in a separate batch after the column exists
IF NOT EXISTS (
  SELECT 1 FROM sys.foreign_keys
  WHERE name = 'FK_FAG_Booking'
)
AND OBJECT_ID('dbo.FollowupBookings', 'U') IS NOT NULL
BEGIN
  ALTER TABLE dbo.FollowupAgreements
    ADD CONSTRAINT FK_FAG_Booking
    FOREIGN KEY (BookingId) REFERENCES dbo.FollowupBookings(Id);
END;
GO

-- Index
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_FollowupAgreements_BookingId'
  AND object_id = OBJECT_ID('dbo.FollowupAgreements')
)
BEGIN
  CREATE INDEX IX_FollowupAgreements_BookingId
    ON dbo.FollowupAgreements(BookingId)
    WHERE BookingId IS NOT NULL;
END;
GO