-- Migration 132: Remove DprActivityMaster, consolidate onto the existing
-- Engineering Activity Master; add Activity↔Item linking.
--
-- DprActivityMaster (added in migration 131) duplicated the pre-existing
-- Engineering dbo.ActivityMaster (id, activity_name, activity_type, etc. —
-- backend/routes/activityMaster.js). Consolidating: ActivityDependency and
-- ContractorAllocation now reference dbo.ActivityMaster(id) directly instead.
-- All three tables had zero rows at the time of this migration, so no data
-- migration is needed — just repointing the FKs.

-- ── 1. Drop old FKs pointing at DprActivityMaster ────────────────────────────
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActDep_Activity')
  ALTER TABLE dbo.ActivityDependency DROP CONSTRAINT FK_ActDep_Activity;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActDep_Parent')
  ALTER TABLE dbo.ActivityDependency DROP CONSTRAINT FK_ActDep_Parent;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ActDep_Dependent')
  ALTER TABLE dbo.ActivityDependency DROP CONSTRAINT FK_ActDep_Dependent;
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_ContractorAlloc_Activity')
  ALTER TABLE dbo.ContractorAllocation DROP CONSTRAINT FK_ContractorAlloc_Activity;
GO

-- ── 2. Drop DprActivityMaster ─────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sysobjects WHERE name = 'DprActivityMaster' AND xtype = 'U')
  DROP TABLE dbo.DprActivityMaster;
GO

-- ── 3. Re-add FKs pointing at the real (Engineering) dbo.ActivityMaster ─────
-- Both ActivityId columns and ActivityMaster.id are INT, so the re-point is
-- a straight retarget — no column type changes needed.
ALTER TABLE dbo.ActivityDependency
  ADD CONSTRAINT FK_ActDep_Activity FOREIGN KEY (ActivityId) REFERENCES dbo.ActivityMaster(id);
ALTER TABLE dbo.ActivityDependency
  ADD CONSTRAINT FK_ActDep_Parent FOREIGN KEY (ParentActivityId) REFERENCES dbo.ActivityMaster(id);
ALTER TABLE dbo.ActivityDependency
  ADD CONSTRAINT FK_ActDep_Dependent FOREIGN KEY (DependentActivityId) REFERENCES dbo.ActivityMaster(id);
ALTER TABLE dbo.ContractorAllocation
  ADD CONSTRAINT FK_ContractorAlloc_Activity FOREIGN KEY (ActivityId) REFERENCES dbo.ActivityMaster(id);
GO

-- ── 4. Remove the dpr-activity-master page definition ───────────────────────
-- Hard-deleted (not just retired) — it was added and undone within the same
-- work session, with zero RoleRights/UserPageRightsJson grants against it.
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
  DELETE FROM dbo.PageDefinitions WHERE PageKey = 'dpr-activity-master';
GO

-- ── 5. Activity ↔ Item linking ───────────────────────────────────────────────
-- Lets a civil-work Activity carry a fixed list of Items (name + UOM pulled
-- live from Item Master) — the BOQ page auto-fetches these when an Activity
-- line is added.
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ActivityItems' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.ActivityItems (
    ActivityItemId INT IDENTITY(1,1) PRIMARY KEY,
    ActivityId      INT NOT NULL,
    ItemId          UNIQUEIDENTIFIER NOT NULL,
    CreatedBy       NVARCHAR(100) NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_ActivityItems_Activity FOREIGN KEY (ActivityId) REFERENCES dbo.ActivityMaster(id),
    CONSTRAINT FK_ActivityItems_Item FOREIGN KEY (ItemId) REFERENCES dbo.Item_Master_Group(M_Id),
    CONSTRAINT UQ_ActivityItems_Activity_Item UNIQUE (ActivityId, ItemId)
  );
  CREATE INDEX IX_ActivityItems_ActivityId ON dbo.ActivityItems(ActivityId);
  PRINT 'Created dbo.ActivityItems';
END
ELSE PRINT 'dbo.ActivityItems already exists — skipping create';
GO
