-- The Application wizard's Payment Details step (CrmApplication.tsx) captures
-- a Payment Mode for the token amount, but had nowhere to record the actual
-- instrument reference (cheque number/date, or a transaction/UTR id for
-- NEFT/RTGS/UPI/Card) — so a salesperson recording "customer paid via
-- cheque" had no way to note which cheque. Keyed the same way the rest of
-- the Application-stage capture already is (ApplicationId, backfilled onto
-- BookingId once a Booking exists — see crmEntityCreation.js).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail') AND name = 'ChequeNo')
  ALTER TABLE dbo.CrmCustomerBankDetail ADD ChequeNo NVARCHAR(50) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail') AND name = 'ChequeDate')
  ALTER TABLE dbo.CrmCustomerBankDetail ADD ChequeDate DATE NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail') AND name = 'TransactionRef')
  ALTER TABLE dbo.CrmCustomerBankDetail ADD TransactionRef NVARCHAR(200) NULL;
GO

-- CrmPaymentReceipt already has TransactionRef (used generically as
-- cheque no / UTR / card ref depending on PaymentMode) but no separate
-- ChequeDate — needed once the Application-stage token capture starts
-- auto-creating a real receipt (see crmEntityCreation.js's
-- createCrmBookingRecord) so a cheque's actual instrument date isn't lost
-- behind ReceivedDate (which is when it was recorded/deposited, not the
-- date printed on the cheque).
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmPaymentReceipt') AND name = 'ChequeDate')
  ALTER TABLE dbo.CrmPaymentReceipt ADD ChequeDate DATE NULL;
GO
