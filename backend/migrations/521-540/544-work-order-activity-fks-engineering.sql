-- Migration 544: Work Order activities point at the Engineering Activity Master.
--
-- Since the Engineering Activity Master was split off the shared Civil one (migration 463) the Work Order page,
-- its API and the BOQ all read activities and groups from dbo.EngineeringActivityMaster, but
-- dbo.WorkOrderActivities.ActivityGroupId / ActivityId still had foreign keys to dbo.ActivityMaster. Saving a
-- work order for an activity created after the split (no matching row in dbo.ActivityMaster) failed with
-- "One or more activities could not be saved".
--
-- The two keys are re-pointed at dbo.EngineeringActivityMaster, which was seeded from ActivityMaster with the same
-- ids, so existing work-order rows stay valid. If any row did not resolve, the key is added WITH NOCHECK (still
-- enforced for every new or changed row) rather than failing the migration.

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WOA_Group' AND parent_object_id = OBJECT_ID('dbo.WorkOrderActivities'))
  ALTER TABLE dbo.WorkOrderActivities DROP CONSTRAINT FK_WOA_Group;
GO

IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_WOA_Activity' AND parent_object_id = OBJECT_ID('dbo.WorkOrderActivities'))
  ALTER TABLE dbo.WorkOrderActivities DROP CONSTRAINT FK_WOA_Activity;
GO

IF OBJECT_ID('dbo.EngineeringActivityMaster', 'U') IS NOT NULL
BEGIN
  DECLARE @groupOrphans INT = (
    SELECT COUNT(*) FROM dbo.WorkOrderActivities w
    WHERE NOT EXISTS (SELECT 1 FROM dbo.EngineeringActivityMaster e WHERE e.id = w.ActivityGroupId));
  DECLARE @actOrphans INT = (
    SELECT COUNT(*) FROM dbo.WorkOrderActivities w
    WHERE NOT EXISTS (SELECT 1 FROM dbo.EngineeringActivityMaster e WHERE e.id = w.ActivityId));

  IF @groupOrphans = 0
    ALTER TABLE dbo.WorkOrderActivities WITH CHECK
      ADD CONSTRAINT FK_WOA_Group FOREIGN KEY (ActivityGroupId) REFERENCES dbo.EngineeringActivityMaster(id);
  ELSE
    ALTER TABLE dbo.WorkOrderActivities WITH NOCHECK
      ADD CONSTRAINT FK_WOA_Group FOREIGN KEY (ActivityGroupId) REFERENCES dbo.EngineeringActivityMaster(id);

  IF @actOrphans = 0
    ALTER TABLE dbo.WorkOrderActivities WITH CHECK
      ADD CONSTRAINT FK_WOA_Activity FOREIGN KEY (ActivityId) REFERENCES dbo.EngineeringActivityMaster(id);
  ELSE
    ALTER TABLE dbo.WorkOrderActivities WITH NOCHECK
      ADD CONSTRAINT FK_WOA_Activity FOREIGN KEY (ActivityId) REFERENCES dbo.EngineeringActivityMaster(id);
END
GO

PRINT '544-work-order-activity-fks-engineering applied successfully.';
GO
