-- Migration 361: revert the "cancel the tag on Fixed Asset Record delete"
-- behavior introduced by 360-release-orphaned-fa-item-code-tags.sql (and by
-- the matching code in the DELETE /fixed-assets/:id route at the time).
--
-- That approach was wrong: cancelling a FixedAssetTagging row retires its FA
-- Item Code permanently (unassigned-codes / the create-time re-check both
-- require Status='Tagged' to consider a code selectable), so a deleted
-- Fixed Asset Record's code could never be picked again — a fresh code had
-- to be generated instead. The correct behavior (this migration + the
-- updated DELETE route) is: deleting a Fixed Asset Record only soft-deletes
-- that record; the FixedAssetTagging row is left untouched (still
-- Status='Tagged' — it's still a real physically-tagged unit). Availability
-- is entirely derived from "does a non-Deleted FixedAssetRecord still
-- reference this TagId", so the same code reappears and is reusable without
-- ever needing a new one minted.
--
-- This reverts any tag that migration 360 (or the not-yet-fixed DELETE
-- route) already cancelled, and restores its batch's AssetStatus to Active
-- where the batch is once again fully tagged.

BEGIN TRAN;

DECLARE @RevertedBatches TABLE (AssetId INT);

INSERT INTO @RevertedBatches (AssetId)
SELECT DISTINCT t.AssetId
FROM dbo.FixedAssetTagging t
WHERE t.Status = 'Cancelled'
  AND EXISTS (
    SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId AND fa.Status = 'Deleted'
  )
  AND NOT EXISTS (
    SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId AND fa.Status <> 'Deleted'
  );

UPDATE t
SET t.Status = 'Tagged', t.UpdatedAt = SYSDATETIME()
FROM dbo.FixedAssetTagging t
WHERE t.Status = 'Cancelled'
  AND EXISTS (
    SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId AND fa.Status = 'Deleted'
  )
  AND NOT EXISTS (
    SELECT 1 FROM dbo.FixedAssetRecord fa WHERE fa.SourceTagId = t.TagId AND fa.Status <> 'Deleted'
  );

-- Batches that are now fully tagged again (every unit has a Status='Tagged'
-- row) flip back to Active, same transition full tagging normally causes.
UPDATE fa
SET fa.AssetStatus = 'Active', fa.UpdatedAt = SYSDATETIME()
FROM dbo.FixedAssetRecord fa
WHERE fa.AssetStatus = 'Pending'
  AND fa.AssetId IN (SELECT AssetId FROM @RevertedBatches)
  AND fa.Quantity <= ISNULL((
    SELECT SUM(t.TaggedQty) FROM dbo.FixedAssetTagging t
    WHERE t.AssetId = fa.AssetId AND t.Status = 'Tagged'
  ), 0);

COMMIT TRAN;
GO
