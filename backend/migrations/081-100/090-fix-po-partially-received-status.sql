-- Migration 090: Fix PurchaseOrders stuck in "Partially Received" status
-- "Partially Received" belongs on GRNs, not POs.
-- Revert any PO currently set to "Partially Received" back to "Approved",
-- unless all its items have been fully received (those become "Received").

UPDATE po
SET po.Status = CASE
  WHEN grn_totals.TotalReceived >= po_totals.TotalOrdered THEN 'Received'
  ELSE 'Approved'
END
FROM dbo.PurchaseOrders po
-- Sum of non-rejected GRN amounts for each PO
LEFT JOIN (
  SELECT POID, SUM(TotalAmount) AS TotalReceived
  FROM dbo.GoodsReceiptNotes
  WHERE Status != 'Rejected'
  GROUP BY POID
) grn_totals ON grn_totals.POID = po.PurchaseOrderID
-- Total ordered value from POItems JSON — computed inline
CROSS APPLY (
  SELECT ISNULL(SUM(CAST(JSON_VALUE(item.value, '$.quantity') AS DECIMAL(18,4))
                  * CAST(JSON_VALUE(item.value, '$.rate')     AS DECIMAL(18,4))), 0) AS TotalOrdered
  FROM OPENJSON(ISNULL(po.POItems, '[]')) AS item
) po_totals
WHERE po.Status = 'Partially Received';
