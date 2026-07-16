-- Migration 163: Re-issue reference on NewPayment
-- When a cheque bounces the operator creates a replacement payment.
-- ReplacesPaymentId links the new payment back to the bounced original so
-- BRS can display the full chain: Bounced → Replaced by PAY-XXXX.

ALTER TABLE dbo.NewPayment
  ADD ReplacesPaymentId INT NULL
    CONSTRAINT FK_NewPayment_Replaces FOREIGN KEY REFERENCES dbo.NewPayment(PPaymentID);
