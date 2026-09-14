-- Migration 282: Booking-stage KYC verification flag
-- The Booking tab's "Save Bank/KYC Details" (CrmBookingDetail.tsx) is meant to
-- be an explicit verify-and-confirm checkpoint on top of what Application
-- step 3 captured, not just another silent save. Until now that checkpoint
-- was pure UI state (locked once the row had data) with nothing persisted,
-- so there was no way to answer "did staff actually review this at the
-- Booking stage, and who" — only "does data exist on the row". These two
-- columns record that explicit action; any subsequent edit to the row
-- (Application step, the Cheque/UTR partial save, or the final standalone
-- Bank & KYC page) clears them, since a changed row is unverified again by
-- definition.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail') AND name = 'BookingStageVerifiedAt')
BEGIN
  ALTER TABLE dbo.CrmCustomerBankDetail ADD BookingStageVerifiedAt DATETIME2 NULL;
  PRINT 'Added CrmCustomerBankDetail.BookingStageVerifiedAt';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmCustomerBankDetail') AND name = 'BookingStageVerifiedBy')
BEGIN
  ALTER TABLE dbo.CrmCustomerBankDetail ADD BookingStageVerifiedBy INT NULL;
  PRINT 'Added CrmCustomerBankDetail.BookingStageVerifiedBy';
END
GO
