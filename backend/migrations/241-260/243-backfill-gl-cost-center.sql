-- Backfill dbo.GeneralLedgerEntry.CostCenterId for entries posted before
-- migration 242 added the column — resolved from each entry's source
-- document's own parent PO (GRN -> PO, or ExpenseBooking -> GRN -> PO /
-- ExpenseBooking -> PO directly). Covers both the live SourceType values
-- ('GRNPosting'/'InvoicePosting') and the older ones from
-- services/generalLedger.js's postGRNApproval/postExpenseBookingApproval
-- ('GRN'/'ExpenseBooking').

-- GRNPosting (current GRN post-to-gl route)
UPDATE gle
SET gle.CostCenterId = po.CostCenterId
FROM dbo.GeneralLedgerEntry gle
JOIN dbo.GoodsReceiptNotes grn ON grn.GRNID = gle.SourceId
JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
WHERE gle.SourceType = 'GRNPosting' AND gle.CostCenterId IS NULL AND po.CostCenterId IS NOT NULL;

-- Legacy 'GRN' source type
UPDATE gle
SET gle.CostCenterId = po.CostCenterId
FROM dbo.GeneralLedgerEntry gle
JOIN dbo.GoodsReceiptNotes grn ON grn.GRNID = gle.SourceId
JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
WHERE gle.SourceType = 'GRN' AND gle.CostCenterId IS NULL AND po.CostCenterId IS NOT NULL;

-- InvoicePosting (current Invoice post-to-gl route), GRN-linked
UPDATE gle
SET gle.CostCenterId = po.CostCenterId
FROM dbo.GeneralLedgerEntry gle
JOIN dbo.ExpenseBooking eb ON eb.Eid = gle.SourceId
JOIN dbo.GoodsReceiptNotes grn ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
WHERE gle.SourceType = 'InvoicePosting' AND gle.CostCenterId IS NULL AND po.CostCenterId IS NOT NULL;

-- InvoicePosting, PO-linked directly (no GRN)
UPDATE gle
SET gle.CostCenterId = po.CostCenterId
FROM dbo.GeneralLedgerEntry gle
JOIN dbo.ExpenseBooking eb ON eb.Eid = gle.SourceId
JOIN dbo.PurchaseOrders po ON eb.ESourceType = 'PO' AND po.PurchaseOrderID = TRY_CAST(eb.ESourceId AS INT)
WHERE gle.SourceType = 'InvoicePosting' AND gle.CostCenterId IS NULL AND po.CostCenterId IS NOT NULL;

-- Legacy 'ExpenseBooking' source type, GRN-linked
UPDATE gle
SET gle.CostCenterId = po.CostCenterId
FROM dbo.GeneralLedgerEntry gle
JOIN dbo.ExpenseBooking eb ON eb.Eid = gle.SourceId
JOIN dbo.GoodsReceiptNotes grn ON eb.ESourceType = 'GRN' AND grn.GRNID = TRY_CAST(eb.ESourceId AS INT)
JOIN dbo.PurchaseOrders po ON po.PurchaseOrderID = grn.POID
WHERE gle.SourceType = 'ExpenseBooking' AND gle.CostCenterId IS NULL AND po.CostCenterId IS NOT NULL;
