-- 086-add-paymentplansummary-to-bookings.sql

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.FollowupBookings') AND name = 'PaymentPlanSummary'
)
BEGIN
  ALTER TABLE dbo.FollowupBookings
    ADD PaymentPlanSummary NVARCHAR(500) NULL;
  PRINT 'PaymentPlanSummary column added.';
END
ELSE
BEGIN
  PRINT 'PaymentPlanSummary already exists — skipped.';
END
GO

-- Back-fill existing rows (runs after the ALTER TABLE batch above)
UPDATE fb
SET fb.PaymentPlanSummary = (
  SELECT STRING_AGG(ptm.TermName, ', ') WITHIN GROUP (ORDER BY bpt.SortOrder)
  FROM dbo.BookingPaymentTerms bpt
  JOIN dbo.PaymentTermMaster ptm ON ptm.TermID = bpt.TermID
  WHERE bpt.BookingID = fb.Id
)
FROM dbo.FollowupBookings fb
WHERE fb.IsDeleted = 0;

PRINT 'Back-filled PaymentPlanSummary for existing bookings.';
