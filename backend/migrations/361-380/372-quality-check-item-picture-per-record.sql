-- Migration 372: per-record Item Picture for Owner & Quality Checking.
--
-- Each Quality Check row now carries its OWN captured Item Picture
-- (dbo.FixedAssetQualityCheck.ItemPicture) instead of the module reading a
-- single dbo.FixedAssetRecord.PictureBase64 for the whole FA Item Code.
-- Every quality check is already one history record with its own DocNo,
-- DocDate, QualityStatus, follow-up fields, CreatedBy and CreatedAt — so the
-- image column on that row is the record-wise / date-wise / update-wise
-- image relationship the requirement calls for. Old records keep their own
-- image forever; a new capture only ever writes the current record's row.

IF COL_LENGTH('dbo.FixedAssetQualityCheck', 'ItemPicture') IS NULL
  ALTER TABLE dbo.FixedAssetQualityCheck ADD ItemPicture NVARCHAR(MAX) NULL;
GO

-- Backfill: seed each asset's FIRST (oldest) quality-check record that has no
-- image yet from the asset-level picture, so history that pre-dates this
-- change still shows something. Newer records stay NULL until re-captured.
;WITH firstQc AS (
  SELECT q.QualityCheckId,
         ROW_NUMBER() OVER (PARTITION BY q.AssetId ORDER BY q.DocDate ASC, q.CreatedAt ASC, q.QualityCheckId ASC) AS rn
  FROM dbo.FixedAssetQualityCheck q
  WHERE q.ItemPicture IS NULL
)
UPDATE q
SET q.ItemPicture = fa.PictureBase64
FROM dbo.FixedAssetQualityCheck q
JOIN firstQc f ON f.QualityCheckId = q.QualityCheckId AND f.rn = 1
JOIN dbo.FixedAssetRecord fa ON fa.AssetId = q.AssetId
WHERE fa.PictureBase64 IS NOT NULL;
GO

PRINT '372-quality-check-item-picture-per-record applied successfully.';
GO
