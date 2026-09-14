-- Migration 360: release FA Item Code tags whose only linking Fixed Asset
-- Record was soft-deleted before that delete flow cancelled the tag.
--
-- dbo.FixedAssets DELETE /:id used to just flip Status='Deleted' on the
-- asset without touching dbo.FixedAssetTagging — so a tag consumed by a
-- since-deleted record stayed Status='Tagged' forever, permanently
-- excluded from Godown-wise Stock's untagged-quantity calculation and from
-- Fixed Asset Record's "unassigned FA Item Codes" picker (NOT EXISTS check
-- didn't look at the linking record's Status). Both queries now filter on
-- fa.Status <> 'Deleted', but that alone doesn't un-stick already-orphaned
-- tags whose Status is still 'Tagged' — this backfill releases them the
-- same way the fixed delete flow now does going forward.

BEGIN TRAN;

-- Snapshot which batches (t.AssetId) are about to have a tag released, so
-- the AssetStatus revert below only touches batches actually affected here.
DECLARE @ReleasedBatches TABLE (AssetId INT);

INSERT INTO @ReleasedBatches (AssetId)
SELECT DISTINCT t.AssetId
FROM dbo.FixedAssetTagging t
WHERE t.Status = 'Tagged'
  AND EXISTS (
    SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId
  )
  AND NOT EXISTS (
    SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId AND fa.Status <> 'Deleted'
  );

-- Cancel tags whose every linking FixedAssetRecord row is Deleted.
UPDATE t
SET t.Status = 'Cancelled', t.UpdatedAt = SYSDATETIME()
FROM dbo.FixedAssetTagging t
WHERE t.Status = 'Tagged'
  AND EXISTS (
    SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId
  )
  AND NOT EXISTS (
    SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId AND fa.Status <> 'Deleted'
  );

-- Freeing those units means their batches can no longer be fully tagged —
-- revert to Pending if auto-flipped to Active, same as the delete endpoint.
UPDATE fa
SET fa.AssetStatus = 'Pending', fa.UpdatedAt = SYSDATETIME()
FROM dbo.FixedAssetRecord fa
WHERE fa.AssetStatus = 'Active'
  AND fa.AssetId IN (SELECT AssetId FROM @ReleasedBatches);

COMMIT TRAN;
GO
