-- Migration 677: payment milestones are no longer linked to DPR work.
--   Construction Progress is a read-only view of the DPR module; payment milestones are demanded by staff on their
--   own schedule. The milestone -> DPR work link added by migration 670 (CrmMilestoneMaster.DprGroupId) and the
--   "ready to demand" flag built on it are removed. Migration 670's index on current DPR steps stays: the progress
--   roll-up reads it.
-- Safe to run again.
IF COL_LENGTH('dbo.CrmMilestoneMaster', 'DprGroupId') IS NOT NULL
  ALTER TABLE dbo.CrmMilestoneMaster DROP COLUMN DprGroupId;
GO
PRINT 'Migration 677 complete: milestone to DPR work link removed';
