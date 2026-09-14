-- Migration 077: Create dbo.FollowupApplications and migrate from dbo.FollowupApplicants
--
-- Strategy:
--   1. Create dbo.FollowupApplications with the full current schema
--      (031a columns + 076 additions).
--   2. Copy all existing rows (preserving Id via IDENTITY_INSERT).
--   3. Drop FK constraints on child tables that point to FollowupApplicants.
--   4. Re-create those FK constraints pointing to FollowupApplications.
--   5. Rename FollowupApplicants → FollowupApplicants_DEPRECATED (safe fallback).
--
-- Child tables with FK → FollowupApplicants.Id:
--   dbo.FollowupUnitSelections  (FK_FollowupUnitSelections_Applicant)
--   dbo.FollowupAgreements      (FK_FollowupAgreements_Applicant)
--   dbo.FollowupNOCs            (FK_FNOC_Applicant)
--
-- Note: FollowupSalesDeeds, FollowupHandovers, FollowupConstructionUpdates
--       carry an ApplicantId column but were wired to AccountHeadMaster /
--       enterprise (not FollowupApplicants), so no FK remapping needed there.
-- ─────────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 1 – Create dbo.FollowupApplications
-- ══════════════════════════════════════════════════════════════════════════════
IF OBJECT_ID('dbo.FollowupApplications', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.FollowupApplications (
    -- Core identity
    Id                    INT           IDENTITY(1,1) PRIMARY KEY,
    ApplicantNo           NVARCHAR(50)  NULL,

    -- Applicant details (031a)
    ApplicantName         NVARCHAR(255) NOT NULL,
    PrimaryMobile         NVARCHAR(20)  NULL,
    Email                 NVARCHAR(255) NULL,
    City                  NVARCHAR(100) NULL,
    Source                NVARCHAR(100) NULL,

    -- Links (031a)
    ProjectId             INT           NULL,
    CompanyId             INT           NULL,
    AssignedTo            INT           NULL,

    -- Preferences (031a)
    PreferredUnitType     NVARCHAR(100) NULL,
    BudgetAmount          DECIMAL(18,2) NULL,

    -- Workflow (031a)
    Status                NVARCHAR(30)  NOT NULL
      CONSTRAINT DF_FollowupApplications_Status DEFAULT 'New',

    Notes                 NVARCHAR(MAX) NULL,

    -- Audit (031a)
    CreatedBy             NVARCHAR(100) NULL,
    CreatedAt             DATETIME2     NOT NULL
      CONSTRAINT DF_FollowupApplications_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy             NVARCHAR(100) NULL,
    UpdatedAt             DATETIME2     NULL,
    IsDeleted             BIT           NOT NULL
      CONSTRAINT DF_FollowupApplications_IsDeleted DEFAULT 0,

    -- Extended fields (076)
    CustomerId            INT           NULL,
    PanNumber             NVARCHAR(20)  NULL,
    ApplicantAddress      NVARCHAR(500) NULL,
    CoApplicantName       NVARCHAR(255) NULL,
    CoApplicantPhone      NVARCHAR(20)  NULL,
    CorrespondenceAddress NVARCHAR(500) NULL,
    ApplicationDate       DATE          NULL,
    UnitId                INT           NULL
  );

  -- Foreign keys
  -- Note: ProjectId resolves via dbo.enterprise (not ProjectMaster)
  --       CompanyId is unbound (CompanyMaster is being retired)
  --       Both columns are kept as plain INT NULL with no FK constraint.
  ALTER TABLE dbo.FollowupApplications
    ADD CONSTRAINT FK_FollowupApplications_AssignedToUsers
      FOREIGN KEY (AssignedTo) REFERENCES dbo.users(id);

  EXEC('ALTER TABLE dbo.FollowupApplications
    ADD CONSTRAINT FK_FollowupApplications_UnitMaster
      FOREIGN KEY (UnitId) REFERENCES dbo.UnitMaster(Id)');

  -- Unique index on ApplicantNo (mirrors 031a + 070)
  CREATE UNIQUE INDEX UX_FollowupApplications_ApplicantNo
    ON dbo.FollowupApplications(ApplicantNo)
    WHERE ApplicantNo IS NOT NULL;

  -- Performance indexes
  CREATE INDEX IX_FollowupApplications_Status
    ON dbo.FollowupApplications(Status);

  CREATE INDEX IX_FollowupApplications_ProjectId
    ON dbo.FollowupApplications(ProjectId);

  CREATE INDEX IX_FollowupApplications_CompanyId
    ON dbo.FollowupApplications(CompanyId);

  CREATE INDEX IX_FollowupApplications_AssignedTo
    ON dbo.FollowupApplications(AssignedTo);

  EXEC('CREATE INDEX IX_FollowupApplications_UnitId
    ON dbo.FollowupApplications(UnitId)
    WHERE UnitId IS NOT NULL');
END;
GO

-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 2 – Copy existing rows (preserve Id values)
-- ══════════════════════════════════════════════════════════════════════════════
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupApplicants' AND schema_id = SCHEMA_ID('dbo'))
   AND EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupApplications' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  SET IDENTITY_INSERT dbo.FollowupApplications ON;

  INSERT INTO dbo.FollowupApplications (
    Id, ApplicantNo,
    ApplicantName, PrimaryMobile, Email, City, Source,
    ProjectId, CompanyId, AssignedTo,
    PreferredUnitType, BudgetAmount,
    Status, Notes,
    CreatedBy, CreatedAt, UpdatedBy, UpdatedAt, IsDeleted,
    CustomerId, PanNumber, ApplicantAddress,
    CoApplicantName, CoApplicantPhone, CorrespondenceAddress,
    ApplicationDate, UnitId
  )
  SELECT
    Id, ApplicantNo,
    ApplicantName, PrimaryMobile, Email, City, Source,
    ProjectId, CompanyId, AssignedTo,
    PreferredUnitType, BudgetAmount,
    Status, Notes,
    CreatedBy, CreatedAt, UpdatedBy, UpdatedAt, IsDeleted,
    CustomerId, PanNumber, ApplicantAddress,
    CoApplicantName, CoApplicantPhone, CorrespondenceAddress,
    ApplicationDate, UnitId
  FROM dbo.FollowupApplicants
  WHERE Id NOT IN (SELECT Id FROM dbo.FollowupApplications); -- idempotent re-run guard

  SET IDENTITY_INSERT dbo.FollowupApplications OFF;
END;
GO

-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 3 – Drop child-table FK constraints that point to FollowupApplicants
-- ══════════════════════════════════════════════════════════════════════════════

-- FollowupUnitSelections
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FollowupUnitSelections_Applicant')
  ALTER TABLE dbo.FollowupUnitSelections DROP CONSTRAINT FK_FollowupUnitSelections_Applicant;

-- FollowupAgreements
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FollowupAgreements_Applicant')
  ALTER TABLE dbo.FollowupAgreements DROP CONSTRAINT FK_FollowupAgreements_Applicant;

-- FollowupNOCs
IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FNOC_Applicant')
  ALTER TABLE dbo.FollowupNOCs DROP CONSTRAINT FK_FNOC_Applicant;
GO

-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 4 – Re-create FK constraints pointing to FollowupApplications
-- ══════════════════════════════════════════════════════════════════════════════

-- FollowupUnitSelections → FollowupApplications
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FollowupUnitSelections_Application')
  ALTER TABLE dbo.FollowupUnitSelections
    ADD CONSTRAINT FK_FollowupUnitSelections_Application
      FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplications(Id);

-- FollowupAgreements → FollowupApplications
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FollowupAgreements_Application')
  ALTER TABLE dbo.FollowupAgreements
    ADD CONSTRAINT FK_FollowupAgreements_Application
      FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplications(Id);

-- FollowupNOCs → FollowupApplications
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FNOC_Application')
  ALTER TABLE dbo.FollowupNOCs
    ADD CONSTRAINT FK_FNOC_Application
      FOREIGN KEY (ApplicantId) REFERENCES dbo.FollowupApplications(Id);
GO

-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 5 – Retire FollowupApplicants (safe rename, not drop)
-- ══════════════════════════════════════════════════════════════════════════════
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupApplicants' AND schema_id = SCHEMA_ID('dbo'))
   AND NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FollowupApplicants_DEPRECATED' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  -- Drop remaining FKs on the old table before renaming
  -- (users, UnitMaster FKs on FollowupApplicants)
  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FollowupApplicants_AssignedToUsers')
    ALTER TABLE dbo.FollowupApplicants DROP CONSTRAINT FK_FollowupApplicants_AssignedToUsers;

  IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FollowupApplicants_UnitMaster')
    ALTER TABLE dbo.FollowupApplicants DROP CONSTRAINT FK_FollowupApplicants_UnitMaster;

  EXEC sp_rename 'dbo.FollowupApplicants', 'FollowupApplicants_DEPRECATED';
END;
GO
