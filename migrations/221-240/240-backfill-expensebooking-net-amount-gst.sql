-- Backfill dbo.ExpenseBooking.ENetAmount for single-GRN-linked bookings whose
-- stored net amount is stuck at the pre-GST base (a stale value from before
-- ENetAmount was computed correctly at save time). ERemainingAmount is
-- corrected by the same delta so paid/remaining stay internally consistent.
--
-- Scoped to bookings with NO active billing terms and NO combined-GRN
-- linkage (ELinkedGrnIds) — those legitimately differ from the raw GRN
-- total and must not be touched here.

UPDATE eb
SET eb.ENetAmount = grn.TotalAmount,
    eb.ERemainingAmount = CASE WHEN eb.ERemainingAmount IS NOT NULL
      THEN grn.TotalAmount - ISNULL(eb.ETotalPaid, 0) ELSE eb.ERemainingAmount END
FROM dbo.ExpenseBooking eb
JOIN dbo.GoodsReceiptNotes grn ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
WHERE (eb.ELinkedGrnIds IS NULL OR eb.ELinkedGrnIds = '')
  AND (eb.EBillingTermsData IS NULL OR eb.EBillingTermsData IN ('[]', 'null', ''))
  AND ABS(ISNULL(eb.ENetAmount, 0) - grn.TotalAmount) > 0.01;
