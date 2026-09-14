-- New system-generated GL account "GST Credit Available" — the confirmed
-- input tax credit recognized when an invoice is matched against a GRN,
-- distinct from "Provisional Credit Available" (PCRAVL) which is the
-- estimated ITC recognized at GRN-receipt time before an actual supplier
-- invoice exists. See backend/routes/expenseBooking.js's post-to-gl for
-- how this is used in the invoice-posting journal entry.

IF NOT EXISTS (SELECT 1 FROM dbo.AccountHeadMaster WHERE LHeadCode = 'GSTCA')
BEGIN
  INSERT INTO dbo.AccountHeadMaster (
    LHeadName, LHeadAddress, LHeadType, LHeadContactPerson, LHeadStatus,
    LHeadPaymentTerms, LHeadCreditLimit, LBranchName, LBelongsTo,
    LGstType, LTDSDeduction, LCountry, LHeadCode, Status,
    IsSystemGenerated, IsTdsApplicable, OnAccountBalance
  )
  SELECT
    'GST Credit Available', 'N/A', 'GL', 'N/A', 1,
    'N/A', 0, 'Main', LBelongsTo,
    'Unregistered', 0, 'India', 'GSTCA', 'Draft',
    1, 0, 0
  FROM dbo.AccountHeadMaster WHERE LHeadCode = 'PCRAVL';
END
