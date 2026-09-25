-- Migration 463: give existing GRN / Inventory-Import Fixed Asset batches their
-- Financial Year. They were created without one, and FA Inventory's
-- "eligible items" picker filters batches by Financial Year, so an untagged
-- batch (e.g. a GRN'd pump whose project had no ID template yet) never showed
-- up for manual tagging.

UPDATE fa SET fa.FinYear = fy.FName
FROM dbo.FixedAssetRecord fa
JOIN dbo.GoodsReceiptNotes g ON fa.SourceType = 'GRN' AND g.GRNID = fa.SourceId
JOIN dbo.FinYear fy ON g.GRNDate BETWEEN fy.FStartDate AND fy.FEndDate
WHERE fa.FinYear IS NULL AND fa.AssetCode IS NULL;

UPDATE fa SET fa.FinYear = fy.FName
FROM dbo.FixedAssetRecord fa
JOIN dbo.FinYear fy ON fa.DocDate BETWEEN fy.FStartDate AND fy.FEndDate
WHERE fa.SourceType = 'IMPORT' AND fa.FinYear IS NULL AND fa.AssetCode IS NULL;

PRINT '463-backfill-fa-batch-finyear applied successfully.';
GO
