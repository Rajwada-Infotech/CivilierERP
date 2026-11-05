-- Migration 558: a tag on one reported activity (dbo.DependencyMasterActivity.TagId), set from Activity Reporting.
-- It overrides the activity type's default tag (dbo.ActivityMaster.TagId); NULL = use the default. Reports read
-- the effective tag, COALESCE(DependencyMasterActivity.TagId, ActivityMaster.TagId).

IF COL_LENGTH('dbo.DependencyMasterActivity', 'TagId') IS NULL
BEGIN
  ALTER TABLE dbo.DependencyMasterActivity ADD TagId INT NULL;
  ALTER TABLE dbo.DependencyMasterActivity
    ADD CONSTRAINT FK_DependencyMasterActivity_DprTag FOREIGN KEY (TagId) REFERENCES dbo.DprTagMaster(Id);
  PRINT 'Migration 558: added DependencyMasterActivity.TagId.';
END
GO
