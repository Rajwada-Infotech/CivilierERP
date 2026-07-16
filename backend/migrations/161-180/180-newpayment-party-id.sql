-- Migration 180: Add PPartyId to NewPayment
-- Stores the AccountHeadMaster LHeadId for the payee on direct-invoice payments
-- (INV/PAY/... entries that have no linked GRN/PO/WorkDone to derive the party from).
-- resolvePartyFromRef reads this as its final fallback when the ExpenseBooking
-- source chain yields no party.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'NewPayment'
    AND COLUMN_NAME  = 'PPartyId'
)
BEGIN
  ALTER TABLE dbo.NewPayment
    ADD PPartyId INT NULL
      REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Column PPartyId added to NewPayment.';
END
ELSE
  PRINT 'Column PPartyId already exists on NewPayment — skipped.';
GO
