-- Migration 461: purge leftover soft-deleted rows in the Fixed Asset module
-- now that Quality Check and Maintenance deletes are real SQL DELETEs (a
-- prior commit already did the same cleanup for Assignment, in migration
-- 460). No code writes FixedAssetQualityCheck.Status='Deleted' or
-- FixedAssetMaintenance.Status='Cancelled' anymore -- any row still
-- carrying one predates that change and is pure leftover, already excluded
-- from every list view.

DELETE FROM dbo.FixedAssetFollowUpReminderLog
WHERE QualityCheckId IN (SELECT QualityCheckId FROM dbo.FixedAssetQualityCheck WHERE Status = 'Deleted');

DELETE FROM dbo.FixedAssetQualityCheck WHERE Status = 'Deleted';
DELETE FROM dbo.FixedAssetMaintenance WHERE Status = 'Cancelled';

PRINT '461-purge-stale-fa-maintenance-qc-deletes applied successfully.';
GO
