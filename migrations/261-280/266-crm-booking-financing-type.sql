-- Migration 266: Booking Financing Type
-- Every booking must declare whether it's Self-funded or Loan-financed before
-- Agreement preparation can proceed (see validateAgreementPreparationPrerequisites
-- in crmWorkflowGuards.js). Without this, an empty CrmLoanDetail row is
-- permanently ambiguous — no way to tell "customer paying cash" apart from
-- "nobody's filled the loan record in yet".

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmBooking') AND name = 'FinancingType')
BEGIN
  ALTER TABLE dbo.CrmBooking ADD FinancingType NVARCHAR(20) NULL;
  PRINT 'Added CrmBooking.FinancingType';
END
GO
