-- 094-add-demand-tracking-to-booking-terms.sql
-- Adds demand-letter tracking columns to BookingPaymentTerms.
-- Each ALTER TABLE is in its own GO batch so SQL Server does not
-- try to resolve column names before the ALTER has run.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.BookingPaymentTerms') AND name = 'DemandStatus'
)
BEGIN
  ALTER TABLE dbo.BookingPaymentTerms
    ADD DemandStatus NVARCHAR(20) NOT NULL
          CONSTRAINT DF_BPT_DemandStatus DEFAULT 'Pending'
          CONSTRAINT CK_BPT_DemandStatus CHECK (DemandStatus IN ('Pending','Demanded','Paid'));
  PRINT 'DemandStatus column added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.BookingPaymentTerms') AND name = 'DemandRaisedOn'
)
BEGIN
  ALTER TABLE dbo.BookingPaymentTerms
    ADD DemandRaisedOn DATE NULL;
  PRINT 'DemandRaisedOn column added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.BookingPaymentTerms') AND name = 'DemandNo'
)
BEGIN
  ALTER TABLE dbo.BookingPaymentTerms
    ADD DemandNo NVARCHAR(60) NULL;
  PRINT 'DemandNo column added.';
END
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.BookingPaymentTerms') AND name = 'DemandNotes'
)
BEGIN
  ALTER TABLE dbo.BookingPaymentTerms
    ADD DemandNotes NVARCHAR(500) NULL;
  PRINT 'DemandNotes column added.';
END
GO

-- Back-fill: existing paid rows → DemandStatus = 'Paid'
-- This batch runs AFTER the ALTER TABLE batches above, so DemandStatus is visible.
UPDATE dbo.BookingPaymentTerms
SET DemandStatus = 'Paid'
WHERE IsPaid = 1 AND DemandStatus = 'Pending';
GO

-- Index for fast status queries
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.BookingPaymentTerms') AND name = 'IX_BPT_DemandStatus'
)
  CREATE INDEX IX_BPT_DemandStatus ON dbo.BookingPaymentTerms (DemandStatus);
GO

PRINT '094 complete.';
