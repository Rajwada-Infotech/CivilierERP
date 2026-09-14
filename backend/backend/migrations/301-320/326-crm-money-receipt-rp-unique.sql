-- Defense-in-depth: CrmMoneyReceipt.ReceivedPaymentId has no unique
-- constraint today (verified live: only PK on Id, unique on ReceiptNo, plain
-- index on BookingId). In the normal flow this is safe — receivedPayment.js
-- PUT /:id/approve serialises with UPDLOCK+HOLDLOCK on the RP row and 400s
-- if RPStatus is already 'Approved', so ensureMoneyReceiptForApproved
-- Payment (crmMoneyReceiptWorkflow.js, added 2026-08-14) can only fire once
-- per RP. But there's no schema-level guarantee: any future code path that
-- calls that function twice for the same RP would silently create two Money
-- Receipts for the same money.
--
-- Filtered so unlimited NULLs are still allowed: a Pending MR (not yet
-- linked to any RP) always has ReceivedPaymentId=NULL, and there can be
-- many Pending MRs across bookings simultaneously. Only the linked-to-RP
-- state (ReceivedPaymentId IS NOT NULL) is constrained to be unique.

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.CrmMoneyReceipt') AND name = 'UQ_CrmMoneyReceipt_ReceivedPaymentId')
  CREATE UNIQUE INDEX UQ_CrmMoneyReceipt_ReceivedPaymentId
    ON dbo.CrmMoneyReceipt(ReceivedPaymentId)
    WHERE ReceivedPaymentId IS NOT NULL;
GO
