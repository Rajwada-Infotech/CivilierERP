-- Migration 310: revert migration 309 — that seeded dbo.PaymentTermMaster
-- ("Payment Plan Master" in Admin), but the user actually meant the
-- separate "Payment Terms" page (dbo.VendorPaymentTerm, Description/Days/
-- IsActive — used by Contractor Master's payment-term dropdown and the
-- invoice due-date calc). Delete exactly the rows 309 inserted, matched by
-- TermName, so nothing else in the table is touched.

DELETE FROM dbo.PaymentTermMaster
WHERE TermName IN (
  'Retention Money',
  'Mobilization Advance',
  'Security Deposit',
  'Early Payment Discount',
  'Late Payment Surcharge',
  'Loading / Unloading Charges',
  'Freight & Transportation',
  'Net 15',
  'Net 30',
  'Net 45',
  'Net 60',
  'Cash Against Delivery (deprecated)'
);

PRINT '310-revert-payment-plan-master-seed applied successfully.';
GO
