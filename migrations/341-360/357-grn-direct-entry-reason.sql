-- Migration 357: GRN Direct Entry Reason.
--
-- GRN.VehicleInOutID is already nullable — "Create GRN for Remaining
-- Items" (GRN.tsx's handleUseRemainingItems) already raises a GRN
-- straight against a PO's remaining quantity with no Vehicle In/Out
-- required, through the exact same StockLedger path as a vehicle-linked
-- GRN. No new EntryMode column is needed: whether a GRN is "Gate" or
-- "Direct" is fully derivable from VehicleInOutID IS NULL, and storing a
-- second, separately-settable flag would just be one more thing that
-- could drift out of sync with the FK it's describing.
--
-- What's actually missing is an audit trail for WHY the vehicle gate was
-- skipped — this column captures that, free text, only meaningful when
-- VehicleInOutID IS NULL.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.GoodsReceiptNotes') AND name = 'DirectEntryReason'
)
BEGIN
  ALTER TABLE dbo.GoodsReceiptNotes ADD DirectEntryReason NVARCHAR(200) NULL;
END
GO
