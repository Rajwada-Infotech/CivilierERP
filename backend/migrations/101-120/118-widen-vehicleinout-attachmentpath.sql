-- Migration 118: Widen dbo.VehicleInOut.AttachmentPath to support MULTIPLE
-- attachments (camera captures + file picks) instead of just one.
--
-- Storage format change (frontend-driven, no data migration needed):
--   Before: AttachmentPath held a single path string, e.g.
--           "/uploads/vehicle-in-out/1719234-photo.jpg"
--   After:  AttachmentPath holds a JSON array of path strings, e.g.
--           ["/uploads/vehicle-in-out/1719234-photo.jpg",
--            "/uploads/vehicle-in-out/1719240-capture-1.jpg"]
--
-- NVARCHAR(500) was sized for one path; a handful of paths together can
-- exceed that, so this widens the column to NVARCHAR(MAX). Existing single-
-- path values are left as-is (they are still valid non-JSON text) — the
-- frontend's parseJsonArray() helper already falls back to [] for any value
-- that isn't valid JSON, and the Vehicle In/Out view modal is updated
-- alongside this migration to read the new array format while still
-- displaying any legacy single-path rows as a one-item list (handled in
-- application code, not by this migration, since converting a bare path
-- into ["<path>"] is a one-line app-side fallback and doesn't need a
-- backfill UPDATE here).
--
-- Safe to re-run: ALTER COLUMN to the same/wider type is a no-op if already
-- NVARCHAR(MAX); guarded by checking the current type first.

IF EXISTS (
  SELECT 1
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo'
    AND TABLE_NAME   = 'VehicleInOut'
    AND COLUMN_NAME  = 'AttachmentPath'
    AND DATA_TYPE    = 'nvarchar'
    AND CHARACTER_MAXIMUM_LENGTH <> -1   -- -1 means already NVARCHAR(MAX)
)
BEGIN
  ALTER TABLE dbo.VehicleInOut
    ALTER COLUMN AttachmentPath NVARCHAR(MAX) NULL;

  PRINT 'Widened dbo.VehicleInOut.AttachmentPath to NVARCHAR(MAX)';
END
ELSE
  PRINT 'dbo.VehicleInOut.AttachmentPath is already NVARCHAR(MAX) — skipped';
GO

-- Verify
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VehicleInOut' AND COLUMN_NAME = 'AttachmentPath';
