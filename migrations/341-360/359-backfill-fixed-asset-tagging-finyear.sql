-- Migration 359: backfill dbo.FixedAssetTagging.FinYear from DocDate.
-- FinYear used to be picked manually in the tagging form, independent of
-- DocDate, so a row's stored FinYear could silently drift from what its
-- date actually falls in — the Tagging Transaction History "Financial Year"
-- filter would then miss rows whose date clearly belongs to that year.
-- The API now derives FinYear from DocDate server-side on every save; this
-- one-time backfill corrects rows created before that fix.

UPDATE t
SET t.FinYear = fy.FName
FROM dbo.FixedAssetTagging t
CROSS APPLY (
  SELECT TOP 1 FName FROM dbo.FinYear
  WHERE t.DocDate BETWEEN FStartDate AND FEndDate
  ORDER BY FStartDate DESC
) fy
WHERE t.DocDate IS NOT NULL AND ISNULL(t.FinYear, '') <> fy.FName;
GO
