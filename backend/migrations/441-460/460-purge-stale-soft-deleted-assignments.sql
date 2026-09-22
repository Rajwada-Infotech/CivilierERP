-- Migration 460: purge FixedAssetAssignment rows still carrying the old
-- Status='Deleted' soft-delete marker.
--
-- DELETE on Assignment/Transfer/Tagging used to set Status='Deleted' (or
-- 'Cancelled' for Tagging) and keep the row forever. A prior commit on this
-- branch switched all four to a real SQL DELETE, so no code writes that
-- status anymore -- any row still carrying it predates that change and is
-- pure leftover.
--
-- These leftovers are actively harmful for FixedAssetAssignment specifically:
-- "New Assignment is one-time per FA Item Code" is enforced by checking
-- whether ANY row exists for that AssetId, with no status filter (by
-- original design -- soft-deleted rows were meant to keep blocking
-- reassignment forever, on purpose, back when deletes were soft). Now that a
-- real delete actually removes the row, a leftover Status='Deleted' row from
-- before this migration permanently and incorrectly blocks that asset from
-- ever being assigned again, even though every UI list already filters
-- Status <> 'Deleted' and never showed these rows to begin with.

DELETE FROM dbo.FixedAssetAssignment WHERE Status = 'Deleted';

PRINT '460-purge-stale-soft-deleted-assignments applied successfully.';
GO
