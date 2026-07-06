-- Add CreditDays to PaymentTermMaster so booking payment schedules can
-- calculate DueDate/Payment Date as BookingDate + CreditDays.

IF NOT EXISTS (
  SELECT 1
  FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PaymentTermMaster')
    AND name = 'CreditDays'
)
BEGIN
  ALTER TABLE dbo.PaymentTermMaster ADD CreditDays INT NULL;
  PRINT 'Added PaymentTermMaster.CreditDays';
END
GO
