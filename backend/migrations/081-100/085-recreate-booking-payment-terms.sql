-- 085-recreate-booking-payment-terms.sql
-- Recreates BookingPaymentTerms (dropped in 083) with extra columns:
--   ComputedAmount  – resolved ₹ value at the time of booking
--   DocRef          – e.g. PMT-BKG000042-001
--   SortOrder       – preserves the user-selected sequence

IF OBJECT_ID('dbo.BookingPaymentTerms', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.BookingPaymentTerms (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    BookingID      INT           NOT NULL
                     REFERENCES dbo.FollowupBookings(Id) ON DELETE CASCADE,
    TermID         INT           NOT NULL
                     REFERENCES dbo.PaymentTermMaster(TermID),
    ComputedAmount DECIMAL(18,2) NOT NULL DEFAULT 0,
    DocRef         NVARCHAR(50)  NULL,        -- e.g. PMT-BKG000042-001
    SortOrder      INT           NOT NULL DEFAULT 0,
    DueDate        DATE          NULL,
    IsPaid         BIT           NOT NULL DEFAULT 0,
    PaidOn         DATETIME2(3)  NULL,
    CreatedAt      DATETIME2(3)  NOT NULL DEFAULT SYSUTCDATETIME()
  );

  CREATE INDEX IX_BookingPaymentTerms_BookingID ON dbo.BookingPaymentTerms (BookingID);
  CREATE INDEX IX_BookingPaymentTerms_TermID    ON dbo.BookingPaymentTerms (TermID);

  PRINT 'BookingPaymentTerms created.';
END
ELSE
BEGIN
  -- Add missing columns if table already existed from a partial migration
  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BookingPaymentTerms') AND name = 'ComputedAmount')
    ALTER TABLE dbo.BookingPaymentTerms ADD ComputedAmount DECIMAL(18,2) NOT NULL DEFAULT 0;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BookingPaymentTerms') AND name = 'DocRef')
    ALTER TABLE dbo.BookingPaymentTerms ADD DocRef NVARCHAR(50) NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BookingPaymentTerms') AND name = 'SortOrder')
    ALTER TABLE dbo.BookingPaymentTerms ADD SortOrder INT NOT NULL DEFAULT 0;

  PRINT 'BookingPaymentTerms columns patched.';
END
