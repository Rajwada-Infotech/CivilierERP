-- Migration 466: link dbo.RoomMaster to dbo.RoomCategoryMaster with a real
-- foreign key, instead of the category only existing as free text baked
-- into RoomName ("Bedroom 1", "Kitchen") by roomMaster.js's generate route.
--
-- Why: the upcoming DPR Activity Chain Template feature needs to reliably
-- know which Room Category a given Room belongs to, to auto-generate its
-- Dependency/Activity chain. String-parsing RoomName back into a category
-- (stripping a trailing " N" index, case-insensitive alias match) would
-- silently break the moment a room is renamed or a category's Alias is
-- edited — a real FK doesn't have that failure mode.
--
-- Nullable and backward-compatible: RoomMaster's manual create/edit form
-- still allows a free-text RoomName that doesn't necessarily match any
-- category (see RoomNameField in RoomMaster.tsx — "a real text input, not a
-- strict dropdown"), so RoomCategoryId stays optional. Existing rows are
-- best-effort backfilled below by matching against RoomCategoryMaster's own
-- current Alias list (dynamic — nothing hardcoded), the same alias-prefix
-- convention the generate route already writes ("{Alias} {index}" /
-- "{Alias}"); anything that doesn't match cleanly is left NULL rather than
-- guessed.

IF COL_LENGTH('dbo.RoomMaster', 'RoomCategoryId') IS NULL
BEGIN
  ALTER TABLE dbo.RoomMaster ADD RoomCategoryId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_RoomMaster_RoomCategory')
BEGIN
  ALTER TABLE dbo.RoomMaster
    ADD CONSTRAINT FK_RoomMaster_RoomCategory FOREIGN KEY (RoomCategoryId) REFERENCES dbo.RoomCategoryMaster(Id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_RoomMaster_RoomCategory' AND object_id = OBJECT_ID('dbo.RoomMaster'))
BEGIN
  CREATE INDEX IX_RoomMaster_RoomCategory ON dbo.RoomMaster(RoomCategoryId);
END
GO

-- Best-effort backfill for existing rows: match RoomName against
-- RoomCategoryMaster.Alias, either exactly or as "{Alias} {digits}" (the
-- exact convention roomMaster.js's generate route writes for a quantity >
-- 1 — e.g. "Bedroom 1", "Bedroom 10"). Uses a LIKE pattern per category
-- rather than arithmetic digit-stripping, which breaks on multi-digit
-- indices. Only fills a row when exactly one active category matches — an
-- ambiguous or absent match is left NULL rather than guessed.
UPDATE r
SET r.RoomCategoryId = m.Id
FROM dbo.RoomMaster r
CROSS APPLY (
  SELECT TOP 1 cat.Id
  FROM dbo.RoomCategoryMaster cat
  WHERE cat.IsActive = 1
    AND (
      cat.Alias = r.RoomName
      OR (r.RoomName LIKE cat.Alias + ' %' AND ISNUMERIC(SUBSTRING(r.RoomName, LEN(cat.Alias) + 2, 50)) = 1)
    )
) m
WHERE r.RoomCategoryId IS NULL
  AND (
    SELECT COUNT(*) FROM dbo.RoomCategoryMaster c2
    WHERE c2.IsActive = 1 AND (
      c2.Alias = r.RoomName OR (r.RoomName LIKE c2.Alias + ' %' AND ISNUMERIC(SUBSTRING(r.RoomName, LEN(c2.Alias) + 2, 50)) = 1)
    )
  ) = 1;
GO
