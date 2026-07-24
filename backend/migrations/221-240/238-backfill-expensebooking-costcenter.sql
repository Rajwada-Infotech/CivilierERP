-- Backfill dbo.ExpenseBooking.ECostCenter for existing PO/GRN-linked invoices
-- that were created before the Invoice form started auto-filling it from the
-- parent PO's Cost Center. TOD (Other Expense) bookings are left untouched —
-- they use the GL Account field instead, not a Cost Center.

-- PO-sourced invoices: PO's own CostCenterId.
UPDATE eb
SET eb.ECostCenter = CONCAT(cc.Code, ' - ', cc.Name)
FROM dbo.ExpenseBooking eb
JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = eb.ESourceId
JOIN dbo.CostCenter cc ON cc.CostCenterId = po.CostCenterId
WHERE eb.ESourceType = 'PO'
  AND (eb.ECostCenter IS NULL OR eb.ECostCenter = '')
  AND po.CostCenterId IS NOT NULL;

-- GRN-sourced invoices: the GRN's own parent PO's CostCenterId.
UPDATE eb
SET eb.ECostCenter = CONCAT(cc.Code, ' - ', cc.Name)
FROM dbo.ExpenseBooking eb
JOIN dbo.GoodsReceiptNotes grn ON grn.GRNID = eb.ESourceId
JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
JOIN dbo.CostCenter cc ON cc.CostCenterId = po.CostCenterId
WHERE eb.ESourceType = 'GRN'
  AND (eb.ECostCenter IS NULL OR eb.ECostCenter = '')
  AND po.CostCenterId IS NOT NULL;
