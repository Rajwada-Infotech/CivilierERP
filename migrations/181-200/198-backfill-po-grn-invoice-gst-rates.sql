-- Backfills ECgstRate/ESgstRate on ExpenseBooking rows where GST was already
-- correctly baked into ENetAmount (multi-GRN combined invoices picked up the
-- linked PO's GST rate for the total, per applyMultiGRNDoc in
-- MaterialExpenseBooking.tsx) but the rate itself was never written back to
-- the row, so the invoice list's CGST/SGST columns showed 0% despite the
-- net amount already including tax. Display-only fix — EAmount/ENetAmount
-- are left untouched since they were already correct.
UPDATE eb
SET
  ECgstRate = ROUND(((eb.ENetAmount - eb.EAmount) / eb.EAmount) * 100 / 2, 2),
  ESgstRate = ROUND(((eb.ENetAmount - eb.EAmount) / eb.EAmount) * 100 / 2, 2)
FROM dbo.ExpenseBooking eb
WHERE ISNULL(eb.EStatus, '') <> 'Deleted'
  AND ISNULL(eb.ECgstRate, 0) = 0
  AND ISNULL(eb.ESgstRate, 0) = 0
  AND ISNULL(eb.EIgstRate, 0) = 0
  AND eb.EAmount > 0
  AND ISNULL(eb.ENetAmount, eb.EAmount) <> eb.EAmount
  -- Only rows with no discount/billing terms muddying the back-calculation —
  -- anything more complex is left alone rather than guessed at.
  AND (eb.EDiscountData IS NULL OR eb.EDiscountData LIKE '%"applicable":false%')
  AND (eb.EBillingTermsData IS NULL OR eb.EBillingTermsData = '[]');

PRINT 'Backfilled GST rates on ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' ExpenseBooking row(s).';
