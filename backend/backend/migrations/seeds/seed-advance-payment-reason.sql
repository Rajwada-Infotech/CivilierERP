-- Adds "Advance Payment" to Payment Reason Master (used to trigger the
-- standalone advance -> On Account credit hook in newPayment.js approve route).
IF NOT EXISTS (SELECT 1 FROM dbo.PaymentReasonMaster WHERE ReasonName = 'Advance Payment')
BEGIN
  INSERT INTO dbo.PaymentReasonMaster (ReasonName, ReasonDesc, IsActive, CreatedBy)
  VALUES ('Advance Payment', NULL, 1, 'system');
END
