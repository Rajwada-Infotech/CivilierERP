-- Adds the SAC-vs-HSN flag to HSN Master. ALTER...ADD...DEFAULT(0) backfills
-- every pre-existing row as HIsSAC=0 (plain HSN) in the same statement, so
-- all codes that existed before this patch stay classified as HSN — the
-- toggle is opt-in per record from here on, nothing is auto-reclassified
-- as SAC.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.HSN') AND name = 'HIsSAC'
)
BEGIN
  ALTER TABLE dbo.HSN ADD HIsSAC BIT NOT NULL CONSTRAINT DF_HSN_HIsSAC DEFAULT (0);
END
