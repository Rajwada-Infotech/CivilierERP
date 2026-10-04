-- Migration 463: split the shared dbo.ActivityMaster into two independent
-- masters. dbo.ActivityMaster stays exactly as-is and becomes Civil Work
-- DPR's own master (all of contractorAllocation.js, dailyLabour.js,
-- dependencyActivityAssignment.js, dependencyMaster.js, dpr.js,
-- workerAttendance.js, workProgress.js and civilworkdprDashboard.js keep
-- reading it, untouched). This creates a brand-new dbo.EngineeringActivityMaster
-- as a starting clone for the Engineering module (BOQ, Work Order) to use
-- from now on — same schema, seeded with a snapshot of today's rows (same
-- ids preserved, so existing Work Order / BOQ rows that already reference
-- an ActivityMaster id keep resolving correctly), but a fully separate table
-- going forward: edits to one never touch the other again.
--
-- (A near-identical split — DprActivityMaster — was tried once before and
-- reverted in migration 132, consolidating everything back onto the one
-- shared table. This migration is the deliberate inverse of that, done this
-- time because Engineering and Civil Work DPR's activity lists have since
-- diverged enough to need to move independently.)

-- ── 1. dbo.EngineeringActivityMaster — same shape as dbo.ActivityMaster ─────
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'EngineeringActivityMaster' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.EngineeringActivityMaster (
    id                 INT IDENTITY(1,1) PRIMARY KEY,
    activity_name      NVARCHAR(255)  NOT NULL,
    short_description  NVARCHAR(255)  NULL,
    activity_type      TINYINT        NULL,  -- 0 = Group, 1 = Activity
    group_id           INT            NULL,  -- set only when activity_type = 1
    is_active          BIT            NULL,
    created_by         NVARCHAR(300)  NULL,  -- stores user email
    created_datetime   DATETIME2      NULL,
    approved_by        NVARCHAR(300)  NULL,
    approved_at        DATETIME2      NULL,
    updated_by         NVARCHAR(300)  NULL,
    updated_at         DATETIME2      NULL,
    belongsTo          NVARCHAR(200)  NULL,  -- String(group_id), NULL for Groups
    hsn_code           NVARCHAR(50)   NULL,  -- SAC code, Activities only
    gl_head_id         INT            NULL   -- FK -> AccountHeadMaster.LHeadId, Activities only
  );
  ALTER TABLE dbo.EngineeringActivityMaster
    ADD CONSTRAINT FK_EngineeringActivityMaster_GLHead FOREIGN KEY (gl_head_id)
    REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Created dbo.EngineeringActivityMaster';
END
ELSE PRINT 'dbo.EngineeringActivityMaster already exists - skipping create';
GO

-- Seed it with a snapshot of today's ActivityMaster rows, ids preserved, so
-- Engineering's existing WorkOrder/BOQ rows that already reference an
-- ActivityMaster id keep resolving after this split. Only runs once (guarded
-- on the new table still being empty) — re-running this migration later
-- never re-copies or overwrites anything.
IF NOT EXISTS (SELECT 1 FROM dbo.EngineeringActivityMaster)
BEGIN
  SET IDENTITY_INSERT dbo.EngineeringActivityMaster ON;

  INSERT INTO dbo.EngineeringActivityMaster
    (id, activity_name, short_description, activity_type, group_id, is_active,
     created_by, created_datetime, approved_by, approved_at, updated_by,
     updated_at, belongsTo, hsn_code, gl_head_id)
  SELECT
    id, activity_name, short_description, activity_type, group_id, is_active,
    created_by, created_datetime, approved_by, approved_at, updated_by,
    updated_at, belongsTo, hsn_code, gl_head_id
  FROM dbo.ActivityMaster;

  SET IDENTITY_INSERT dbo.EngineeringActivityMaster OFF;

  -- Re-seed the identity counter past the highest copied id so the next
  -- INSERT through the new route doesn't collide with a copied row.
  DECLARE @maxId INT = (SELECT ISNULL(MAX(id), 0) FROM dbo.EngineeringActivityMaster);
  IF @maxId > 0
    DBCC CHECKIDENT ('dbo.EngineeringActivityMaster', RESEED, @maxId);

  PRINT 'Seeded dbo.EngineeringActivityMaster from dbo.ActivityMaster';
END
GO

-- ── 2. dbo.EngineeringActivityItems — same shape as dbo.ActivityItems ──────
-- Activity <-> Item linking (see migration 132), cloned the same way so the
-- new Engineering Activity Master page's "Add Item" feature works exactly
-- like the original, against its own table.
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'EngineeringActivityItems' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.EngineeringActivityItems (
    ActivityItemId INT IDENTITY(1,1) PRIMARY KEY,
    ActivityId      INT NOT NULL,
    ItemId          UNIQUEIDENTIFIER NOT NULL,
    CreatedBy       NVARCHAR(100) NULL,
    CreatedAt       DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_EngineeringActivityItems_Activity FOREIGN KEY (ActivityId) REFERENCES dbo.EngineeringActivityMaster(id),
    CONSTRAINT FK_EngineeringActivityItems_Item FOREIGN KEY (ItemId) REFERENCES dbo.Item_Master_Group(M_Id),
    CONSTRAINT UQ_EngineeringActivityItems_Activity_Item UNIQUE (ActivityId, ItemId)
  );
  CREATE INDEX IX_EngineeringActivityItems_ActivityId ON dbo.EngineeringActivityItems(ActivityId);
  PRINT 'Created dbo.EngineeringActivityItems';
END
ELSE PRINT 'dbo.EngineeringActivityItems already exists - skipping create';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.EngineeringActivityItems)
   AND EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ActivityItems' AND xtype = 'U')
BEGIN
  SET IDENTITY_INSERT dbo.EngineeringActivityItems ON;

  INSERT INTO dbo.EngineeringActivityItems (ActivityItemId, ActivityId, ItemId, CreatedBy, CreatedAt)
  SELECT ActivityItemId, ActivityId, ItemId, CreatedBy, CreatedAt
  FROM dbo.ActivityItems;

  SET IDENTITY_INSERT dbo.EngineeringActivityItems OFF;

  DECLARE @maxItemId INT = (SELECT ISNULL(MAX(ActivityItemId), 0) FROM dbo.EngineeringActivityItems);
  IF @maxItemId > 0
    DBCC CHECKIDENT ('dbo.EngineeringActivityItems', RESEED, @maxItemId);

  PRINT 'Seeded dbo.EngineeringActivityItems from dbo.ActivityItems';
END
GO

-- ── 3. PageDefinitions — new pageKey for the Engineering-only page ─────────
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'engineering-activity-master' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('engineering-activity-master', 'Engineering Activity Master', 'Engineering', 'Engineering Masters', 'view,create,edit,delete,print,export', 161, 1, 'migration', GETDATE());
END
GO
