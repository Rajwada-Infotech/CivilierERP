-- Migration 131: Civil Work DPR module restructure
--
-- Replaces the old placeholder "Activity" (generic session-analytics page)
-- and "Dependency" (simple DependencyType code/name lookup) with four real
-- tables: DprActivityMaster, ActivityDependency (the tabbed progress
-- tracker), ContractorAllocation (register + engineer approval), and
-- DailyLabourEntry.
--
-- NOTE: the table is named DprActivityMaster, NOT ActivityMaster — a
-- completely unrelated dbo.ActivityMaster (and backend/routes/activityMaster.js,
-- pageKey "activity-master") already exists for the Engineering module's BOQ
-- activity master. Picking a colliding name here would have silently skipped
-- table creation (IF NOT EXISTS matched the wrong table) and then failed on
-- the FK constraints expecting different columns — caught during migration
-- testing, hence the Dpr-prefixed names throughout this module's new tables.
--
-- dbo.DependencyType is left in place untouched (not dropped) — just no
-- longer referenced by the app going forward.

-- ── 1. DprActivityMaster ──────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'DprActivityMaster' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.DprActivityMaster (
    ActivityId        INT IDENTITY(1,1) PRIMARY KEY,
    ActivityCode      NVARCHAR(50)  NOT NULL,
    ActivityName      NVARCHAR(255) NOT NULL,
    WorkCategory      NVARCHAR(100) NULL,
    WorkType          NVARCHAR(100) NULL,
    UOM               NVARCHAR(50)  NULL,
    EstimatedQuantity DECIMAL(18,2) NULL,
    EstimatedDuration INT           NULL,  -- days
    Department        NVARCHAR(100) NULL,
    Priority          NVARCHAR(20)  NULL,  -- Low/Medium/High
    Description       NVARCHAR(1000) NULL,
    IsActive          BIT NOT NULL DEFAULT 1,
    CreatedBy         NVARCHAR(100) NULL,
    CreatedAt         DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy         NVARCHAR(100) NULL,
    UpdatedAt         DATETIME2 NULL,
    CONSTRAINT UQ_DprActivityMaster_Code UNIQUE (ActivityCode)
  );
  PRINT 'Created dbo.DprActivityMaster';
END
ELSE PRINT 'dbo.DprActivityMaster already exists — skipping create';
GO

-- ── 2. ActivityDependency (per-activity tab tracker) ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ActivityDependency' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.ActivityDependency (
    DependencyId        INT IDENTITY(1,1) PRIMARY KEY,
    ActivityId           INT NOT NULL,   -- which Activity tab this row lives under
    ParentActivityId     INT NULL,
    DependentActivityId  INT NULL,
    WorkDescription      NVARCHAR(500) NULL,
    QuantityPlanned      DECIMAL(18,2) NULL,
    QuantityCompleted    DECIMAL(18,2) NULL,
    Unit                 NVARCHAR(50) NULL,
    PlannedStartDate     DATE NULL,
    PlannedEndDate       DATE NULL,
    ActualStartDate      DATE NULL,
    ActualEndDate        DATE NULL,
    CurrentStatus        NVARCHAR(50) NULL,  -- Not Started/In Progress/Completed/On Hold
    Remarks              NVARCHAR(500) NULL,
    ProjectId            INT NULL,
    CreatedBy            NVARCHAR(100) NULL,
    CreatedAt            DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy            NVARCHAR(100) NULL,
    UpdatedAt            DATETIME2 NULL,
    CONSTRAINT FK_ActDep_Activity FOREIGN KEY (ActivityId) REFERENCES dbo.DprActivityMaster(ActivityId),
    CONSTRAINT FK_ActDep_Parent FOREIGN KEY (ParentActivityId) REFERENCES dbo.DprActivityMaster(ActivityId),
    CONSTRAINT FK_ActDep_Dependent FOREIGN KEY (DependentActivityId) REFERENCES dbo.DprActivityMaster(ActivityId)
  );
  CREATE INDEX IX_ActivityDependency_ActivityId ON dbo.ActivityDependency(ActivityId);
  PRINT 'Created dbo.ActivityDependency';
END
ELSE PRINT 'dbo.ActivityDependency already exists — skipping create';
GO

-- ── 3. ContractorAllocation (register + engineer approval) ──────────────────
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'ContractorAllocation' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.ContractorAllocation (
    AllocationId           INT IDENTITY(1,1) PRIMARY KEY,
    ContractorLHeadId       INT NOT NULL,   -- FK to AccountHeadMaster, LHeadType='C'
    ProjectId               INT NULL,
    ActivityId              INT NOT NULL,
    WorkDescription         NVARCHAR(500) NULL,
    AllocationDate          DATE NULL,
    StartDate               DATE NULL,
    ExpectedCompletionDate  DATE NULL,
    CurrentStatus           NVARCHAR(50) NULL,  -- Allocated/In Progress/Completed/On Hold
    AllocatedBy             NVARCHAR(150) NULL,
    SiteLocation            NVARCHAR(255) NULL,
    Remarks                 NVARCHAR(500) NULL,
    IsAcknowledged          BIT NOT NULL DEFAULT 0,
    EngineerName            NVARCHAR(150) NULL,
    ApprovalDate            DATE NULL,
    ApprovalStatus          NVARCHAR(20) NOT NULL DEFAULT 'Pending',  -- Pending/Approved/Rejected
    ApprovalRemarks         NVARCHAR(500) NULL,
    CreatedBy               NVARCHAR(100) NULL,
    CreatedAt               DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy               NVARCHAR(100) NULL,
    UpdatedAt               DATETIME2 NULL,
    CONSTRAINT FK_ContractorAlloc_Head FOREIGN KEY (ContractorLHeadId) REFERENCES dbo.AccountHeadMaster(LHeadId),
    CONSTRAINT FK_ContractorAlloc_Activity FOREIGN KEY (ActivityId) REFERENCES dbo.DprActivityMaster(ActivityId)
  );
  CREATE INDEX IX_ContractorAllocation_Contractor ON dbo.ContractorAllocation(ContractorLHeadId);
  CREATE INDEX IX_ContractorAllocation_Activity ON dbo.ContractorAllocation(ActivityId);
  PRINT 'Created dbo.ContractorAllocation';
END
ELSE PRINT 'dbo.ContractorAllocation already exists — skipping create';
GO

-- ── 4. DailyLabourEntry ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sysobjects WHERE name = 'DailyLabourEntry' AND xtype = 'U')
BEGIN
  CREATE TABLE dbo.DailyLabourEntry (
    EntryId               INT IDENTITY(1,1) PRIMARY KEY,
    AllocationId          INT NOT NULL,
    EntryDate             DATE NOT NULL,
    SkilledLabourCount    INT NOT NULL DEFAULT 0,
    UnskilledLabourCount  INT NOT NULL DEFAULT 0,
    Shift                 NVARCHAR(20) NULL,  -- Day/Night/General
    AttendanceStatus      NVARCHAR(20) NULL,  -- Present/Absent/Partial
    Remarks               NVARCHAR(500) NULL,
    CreatedBy             NVARCHAR(100) NULL,
    CreatedAt             DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy             NVARCHAR(100) NULL,
    UpdatedAt             DATETIME2 NULL,
    CONSTRAINT FK_DailyLabour_Allocation FOREIGN KEY (AllocationId) REFERENCES dbo.ContractorAllocation(AllocationId)
  );
  CREATE INDEX IX_DailyLabourEntry_Allocation ON dbo.DailyLabourEntry(AllocationId);
  CREATE INDEX IX_DailyLabourEntry_Date ON dbo.DailyLabourEntry(EntryDate);
  PRINT 'Created dbo.DailyLabourEntry';
END
ELSE PRINT 'dbo.DailyLabourEntry already exists — skipping create';
GO

-- ── 5. PageDefinitions — retire old, seed new ────────────────────────────────
IF EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'PageDefinitions'
)
BEGIN
  UPDATE dbo.PageDefinitions SET IsActive = 0 WHERE PageKey = 'dependency-master';
  UPDATE dbo.PageDefinitions SET IsActive = 0 WHERE PageKey = 'civilworkdpr-activity';

  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'dpr-activity-master' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('dpr-activity-master', 'Activity', 'Civil Work DPR', 'Setup Masters', 'view,create,edit,delete', 20, 1, 'migration', GETDATE());

  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'civilworkdpr-dependency' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('civilworkdpr-dependency', 'Dependency', 'Civil Work DPR', 'Civil Work DPR', 'view,create,edit,delete', 12, 1, 'migration', GETDATE());

  IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'civilworkdpr-contractor-register' AND IsActive = 1)
    INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
    VALUES ('civilworkdpr-contractor-register', 'Contractor Register', 'Civil Work DPR', 'Civil Work DPR', 'view,create,edit,delete', 13, 1, 'migration', GETDATE());

  PRINT 'Retired dependency-master, seeded dpr-activity-master / civilworkdpr-dependency / civilworkdpr-contractor-register';
END
GO

-- Verify
SELECT PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive
FROM dbo.PageDefinitions
WHERE Module = 'Civil Work DPR'
ORDER BY SortOrder;
