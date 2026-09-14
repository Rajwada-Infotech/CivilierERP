-- Part 1: Broker Master gets RERA registration + a certificate upload,
-- neither of which existed before — brokers were previously just bare
-- ledger-head contact records (name/phone/PAN/GST). Generic "LHead*" naming
-- matches the existing LHeadPan/LGST convention on this shared
-- AccountHeadMaster table (used by every ledger type, not just brokers),
-- even though these two are only ever populated for LHeadType='BR' rows.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'LHeadRera')
  ALTER TABLE dbo.AccountHeadMaster ADD LHeadRera NVARCHAR(50) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'LHeadCertificateUrl')
  ALTER TABLE dbo.AccountHeadMaster ADD LHeadCertificateUrl NVARCHAR(500) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.AccountHeadMaster') AND name = 'LHeadCertificateFileName')
  ALTER TABLE dbo.AccountHeadMaster ADD LHeadCertificateFileName NVARCHAR(300) NULL;
GO

-- Part 2: a broker can now be picked directly on the Application (previously
-- brokerage only ever entered the system after the fact, manually, once an
-- Agreement was already Executed — see crmBrokerage.js). BrokerageRatePercent
-- is a per-Application override of the 2%/1% tier default (NULL = use the
-- tier); BrokerageSplitEnabled opts into releasing half before Agreement
-- execution and half after, instead of one lump payout.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'BrokerId')
  ALTER TABLE dbo.CrmApplication ADD BrokerId INT NULL REFERENCES dbo.AccountHeadMaster(LHeadId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'BrokerageRatePercent')
  ALTER TABLE dbo.CrmApplication ADD BrokerageRatePercent DECIMAL(5,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmApplication') AND name = 'BrokerageSplitEnabled')
  ALTER TABLE dbo.CrmApplication ADD BrokerageSplitEnabled BIT NOT NULL DEFAULT 0;
GO

-- Same three fields carried onto CrmBooking at booking-creation time (see
-- createCrmBookingRecord in crmEntityCreation.js) — the auto-brokerage
-- trigger reads them off the Booking, not the Application, same as every
-- other Application-stage capture (RatePerSqFt, PaymentPlanId, ...) that
-- becomes authoritative on the Booking once one exists.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'BrokerId')
  ALTER TABLE dbo.CrmBooking ADD BrokerId INT NULL REFERENCES dbo.AccountHeadMaster(LHeadId);
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'BrokerageRatePercent')
  ALTER TABLE dbo.CrmBooking ADD BrokerageRatePercent DECIMAL(5,2) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'BrokerageSplitEnabled')
  ALTER TABLE dbo.CrmBooking ADD BrokerageSplitEnabled BIT NOT NULL DEFAULT 0;
GO

-- Part 3: CrmBrokerageMaster rows can now represent one half of a split
-- payout instead of always being the single full commission. TrancheLabel
-- is NULL for the (still-default) single-payout case. IsLocked blocks the
-- "After Agreement" tranche from being approved/paid until the Agreement
-- this booking is attached to actually reaches Executed — see
-- maybeUnlockBrokerageTranche in crmWorkflowGuards.js.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'TrancheLabel')
  ALTER TABLE dbo.CrmBrokerageMaster ADD TrancheLabel NVARCHAR(30) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'IsLocked')
  ALTER TABLE dbo.CrmBrokerageMaster ADD IsLocked BIT NOT NULL DEFAULT 0;
GO

-- The table's original UQ__CrmBroke__... constraint enforces UNIQUE(BookingId)
-- alone — a leftover from when a booking could only ever have one lump-sum
-- brokerage record. A split payout now needs two rows per booking (one per
-- tranche), so that constraint has to go, replaced by two filtered unique
-- indexes that together preserve the original guarantee for the
-- (still-default) single-payout case while allowing exactly one
-- "Before Agreement" and one "After Agreement" row per booking.
IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND is_unique = 1 AND name LIKE 'UQ__CrmBroke%')
BEGIN
  DECLARE @uqName NVARCHAR(200) = (SELECT TOP 1 name FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND is_unique = 1 AND name LIKE 'UQ__CrmBroke%');
  EXEC('ALTER TABLE dbo.CrmBrokerageMaster DROP CONSTRAINT ' + @uqName);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'UQ_CrmBrokerageMaster_BookingId_SinglePayout')
  CREATE UNIQUE INDEX UQ_CrmBrokerageMaster_BookingId_SinglePayout ON dbo.CrmBrokerageMaster(BookingId) WHERE TrancheLabel IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmBrokerageMaster') AND name = 'UQ_CrmBrokerageMaster_BookingId_Tranche')
  CREATE UNIQUE INDEX UQ_CrmBrokerageMaster_BookingId_Tranche ON dbo.CrmBrokerageMaster(BookingId, TrancheLabel) WHERE TrancheLabel IS NOT NULL;
GO
