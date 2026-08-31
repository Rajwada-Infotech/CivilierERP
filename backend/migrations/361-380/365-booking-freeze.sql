-- Migration 365: Booking freeze columns
-- Admin can freeze a booking to prevent any status change, document generation,
-- or payment demand while a legal dispute / court injunction / developer hold
-- is in effect. Freeze has a mandatory expiry date; system surfaces an
-- escalation prompt when freeze expires without resolution.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'IsFrozen')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD IsFrozen BIT NOT NULL DEFAULT 0;
  PRINT 'Added CrmBooking.IsFrozen';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'FrozenAt')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD FrozenAt DATETIME2 NULL;
  PRINT 'Added CrmBooking.FrozenAt';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'FrozenBy')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD FrozenBy INT NULL;
  PRINT 'Added CrmBooking.FrozenBy';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'FreezeReason')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD FreezeReason NVARCHAR(500) NULL;
  PRINT 'Added CrmBooking.FreezeReason';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'FreezeExpiresAt')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD FreezeExpiresAt DATETIME2 NULL;
  PRINT 'Added CrmBooking.FreezeExpiresAt';
END
GO
