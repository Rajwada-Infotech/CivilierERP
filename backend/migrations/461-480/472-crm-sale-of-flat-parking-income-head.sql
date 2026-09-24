-- Migration 472: GL head for recognising CRM booking income once a
-- booking's invoice is generated.
--
-- Business rule (explicit instruction, not inferred): money received from
-- a customer is held purely as a liability (Advance from Customer) until
-- the ENTIRE flat/parking value is collected. Only once fully collected
-- can an invoice be generated, and generating it is what recognises the
-- income — Dr Advance from Customer / Cr Sale of Flat/Parking. See
-- crmBookings.js's full-payment gate on invoice generation and
-- crmLedger.js's postCrmInvoiceToGL.
--
-- Classified under REVENUE FROM OPERATIONS (Code 'RO') — this is the
-- company's core operating revenue (selling flats/parking), not
-- OTHER INCOME (which is reserved for genuinely incidental income like
-- Booking Cancellation Forfeiture, migration 416).

IF NOT EXISTS (
  SELECT 1 FROM dbo.AccountHeadMaster
  WHERE LHeadName = 'Sale of Flat/Parking' AND LHeadType = 'GL'
)
BEGIN
  INSERT INTO dbo.AccountHeadMaster
    (LHeadName, LHeadCode, LHeadType, LHeadStatus,
     LHeadAddress, LHeadContactPerson, LHeadPaymentTerms,
     LBranchName, LCountry, IsSystemGenerated, LBelongsTo)
  VALUES
    ('Sale of Flat/Parking', 'CRM-SALE-INCOME', 'GL', 1,
     'N/A', 'N/A', 'N/A',
     'Main', 'India', 1,
     (SELECT AGId FROM dbo.AccountGroup WHERE Code = 'RO'));
  PRINT 'Seeded GL head: Sale of Flat/Parking';
END
ELSE PRINT 'GL head "Sale of Flat/Parking" already exists — skipping';
GO
