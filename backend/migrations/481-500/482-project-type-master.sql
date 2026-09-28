-- Migration 482: Project Type, as a master carrying BEHAVIOUR FLAGS.
--
-- CRM has so far assumed one shape of product: a vertical building whose units
-- stack on floors, are sold one-per-booking, and are always a taxable supply.
-- Plotted (land) development breaks all three assumptions at once — plots have
-- no floors, buyers routinely take 2-3 together on a single agreement, and the
-- sale of land is outside GST entirely (Schedule III, CGST Act).
--
-- Deliberately a MASTER WITH FLAGS rather than a project_type string column.
-- Code must branch on the flags (HasFloors, SellsLand, ...), never on Code or
-- Name — that way adding "Row Housing" later is a row in this table, not a hunt
-- through 40 files for string literals. Same reasoning the rest of CRM uses for
-- its other masters.
--
-- Type lives in TWO places because a township can mix tower blocks and plotted
-- blocks in one project: enterprise.project_type_id is the project default, and
-- BlockMaster.ProjectTypeId overrides it per block. Callers resolve the
-- effective type as COALESCE(block, project).
--
-- IMPORTANT, and the reason nothing is backfilled below: an unset type must keep
-- behaving exactly as CRM does today (floors, single-unit, taxable). Existing
-- projects are therefore left NULL rather than guessed at, and the resolver in
-- backend/services/projectType.js treats NULL as those legacy semantics. Setting
-- a type is then an explicit, opt-in act per project.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProjectTypeMaster' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.ProjectTypeMaster (
    Id                  INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ProjectTypeMaster PRIMARY KEY,
    Code                NVARCHAR(30)  NOT NULL,
    Name                NVARCHAR(100) NOT NULL,
    Description         NVARCHAR(300) NULL,

    -- ── Behaviour flags. Branch on THESE, never on Code/Name. ──────────────
    -- Units stack on floors (tower) vs laid out on a site map (plotted).
    -- Drives the auto-setup path and which unit-matrix view is rendered.
    HasFloors           BIT NOT NULL CONSTRAINT DF_ProjectTypeMaster_HasFloors           DEFAULT (1),
    -- Sells land. Land is NOT a supply under GST, so this drives the
    -- zero-GST path and the Sale of Land income head.
    SellsLand           BIT NOT NULL CONSTRAINT DF_ProjectTypeMaster_SellsLand           DEFAULT (0),
    -- Sells built area (flat / villa). Taxable supply, existing GST path.
    SellsConstruction   BIT NOT NULL CONSTRAINT DF_ProjectTypeMaster_SellsConstruction   DEFAULT (1),
    -- Several units may sit on one booking (a buyer taking 2-3 plots).
    AllowsMultiUnitSale BIT NOT NULL CONSTRAINT DF_ProjectTypeMaster_AllowsMultiUnitSale DEFAULT (0),

    SortOrder           INT NOT NULL CONSTRAINT DF_ProjectTypeMaster_SortOrder DEFAULT (100),
    IsActive            BIT NOT NULL CONSTRAINT DF_ProjectTypeMaster_IsActive  DEFAULT (1),
    CreatedBy           INT NULL,
    CreatedAt           DATETIME2(0) NOT NULL CONSTRAINT DF_ProjectTypeMaster_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedBy           INT NULL,
    UpdatedAt           DATETIME2(0) NULL
  );
  CREATE UNIQUE INDEX UX_ProjectTypeMaster_Code ON dbo.ProjectTypeMaster(Code) WHERE IsActive = 1;
  PRINT 'Migration 482: created dbo.ProjectTypeMaster.';
END
ELSE
  PRINT 'Migration 482: dbo.ProjectTypeMaster already exists — skipped.';
GO

-- Seed rows. MERGE-free and idempotent: each is inserted only if its Code is
-- absent, so re-running never duplicates and never overwrites a flag someone
-- has since tuned from the UI.
INSERT INTO dbo.ProjectTypeMaster (Code, Name, Description, HasFloors, SellsLand, SellsConstruction, AllowsMultiUnitSale, SortOrder)
SELECT v.Code, v.Name, v.Description, v.HasFloors, v.SellsLand, v.SellsConstruction, v.AllowsMultiUnitSale, v.SortOrder
FROM (VALUES
  ('HIGHRISE',     N'High Rise Apartments',   N'Vertical towers; units stack on floors and are sold one per booking.',            1, 0, 1, 0, 10),
  ('STANDALONE',   N'Standalone Building',    N'A single low-rise building; behaves like a tower with fewer floors.',             1, 0, 1, 0, 20),
  ('PLOTTED',      N'Plotted Development',    N'Sale of demarcated land plots only. Outside GST; no construction component.',     0, 1, 0, 1, 30),
  ('PLOTTED_VILLA',N'Plotted + Villa',        N'Land sold first, villa built later under a separate construction agreement.',     0, 1, 1, 1, 40),
  ('MIXED',        N'Mixed Township',         N'Tower and plotted blocks in one project; each block overrides the type.',         1, 1, 1, 1, 50)
) AS v(Code, Name, Description, HasFloors, SellsLand, SellsConstruction, AllowsMultiUnitSale, SortOrder)
WHERE NOT EXISTS (SELECT 1 FROM dbo.ProjectTypeMaster p WHERE p.Code = v.Code);
GO

-- Project-level default.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.enterprise') AND name = 'project_type_id')
BEGIN
  ALTER TABLE dbo.enterprise ADD project_type_id INT NULL;
  PRINT 'Migration 482: added enterprise.project_type_id.';
END
ELSE
  PRINT 'Migration 482: enterprise.project_type_id already exists — skipped.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_enterprise_ProjectType')
  ALTER TABLE dbo.enterprise WITH NOCHECK
    ADD CONSTRAINT FK_enterprise_ProjectType FOREIGN KEY (project_type_id) REFERENCES dbo.ProjectTypeMaster(Id);
GO

-- Block-level override, so one township can hold both tower and plotted blocks.
-- NULL means "inherit the project's type", which is what every existing block is.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BlockMaster') AND name = 'ProjectTypeId')
BEGIN
  ALTER TABLE dbo.BlockMaster ADD ProjectTypeId INT NULL;
  PRINT 'Migration 482: added BlockMaster.ProjectTypeId (NULL = inherit project).';
END
ELSE
  PRINT 'Migration 482: BlockMaster.ProjectTypeId already exists — skipped.';
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_BlockMaster_ProjectType')
  ALTER TABLE dbo.BlockMaster WITH NOCHECK
    ADD CONSTRAINT FK_BlockMaster_ProjectType FOREIGN KEY (ProjectTypeId) REFERENCES dbo.ProjectTypeMaster(Id);
GO

DECLARE @Untyped INT = (
  SELECT COUNT(*) FROM dbo.enterprise
  WHERE business_type = 'P' AND ISNULL(discontinue, 0) = 0 AND project_type_id IS NULL
);
PRINT CONCAT('Migration 482 done. ', @Untyped, ' existing project(s) have no type set — they keep todays behaviour (floors, single-unit, taxable) until one is chosen.');
GO
