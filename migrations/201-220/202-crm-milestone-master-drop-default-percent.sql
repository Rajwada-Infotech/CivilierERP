-- Default % on the Milestone Master was never required and isn't
-- referenced anywhere else (Payment Plan Master items link to a catalog
-- entry via MilestoneMasterId, not by percent), so drop it.

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.CrmMilestoneMaster') AND name = 'DefaultPercent'
)
  ALTER TABLE dbo.CrmMilestoneMaster DROP COLUMN DefaultPercent;
GOs