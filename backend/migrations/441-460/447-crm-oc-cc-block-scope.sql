-- Migration 447: add Block-level scope to CrmOccupancyCertificate.
--
-- Until now, OC/CC (Occupancy/Completion Certificate) was tracked ONLY at
-- the project level — one row per (ProjectId, CertType). For a large,
-- multi-block project, that's structurally wrong: some blocks can be
-- finished and ready-to-move while others are still under construction,
-- and there was no way to say "Block A has its OC, Block B doesn't." This
-- also blocks a separate, legally-required GST exemption (Schedule III
-- Entry 5, CGST Act 2017 — GST does not apply once the entire sale
-- consideration is received after OC/CC is issued) from being computed
-- correctly, since that rule is effectively unit/block-level, not
-- project-blanket.
--
-- BlockId NULL keeps meaning exactly what every existing row already means
-- today: "applies to the whole project." No backfill needed. A block with
-- its own cert is authoritative over the project's blanket one (see
-- resolveOcCcGate in crmWorkflowGuards.js).

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmOccupancyCertificate') AND name = 'BlockId')
BEGIN
  ALTER TABLE dbo.CrmOccupancyCertificate ADD BlockId INT NULL REFERENCES dbo.BlockMaster(Id);
  PRINT 'Added CrmOccupancyCertificate.BlockId';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CrmOccupancyCertificate') AND name = 'BlockName')
BEGIN
  ALTER TABLE dbo.CrmOccupancyCertificate ADD BlockName NVARCHAR(100) NULL;
  PRINT 'Added CrmOccupancyCertificate.BlockName';
END
GO

-- Migration 412's plain UNIQUE CONSTRAINT (ProjectId, CertType) can only
-- ever allow ONE NULL BlockId per project+certtype combination — correct
-- for the project-blanket row — but cannot also allow multiple DISTINCT
-- non-null BlockIds under the same project+certtype (a constraint, unlike
-- a filtered index, can't be scoped with a WHERE clause). Same fix pattern
-- already used this session for CrmCustomer.Mobile: drop the plain
-- constraint, replace with two filtered unique indexes.
IF EXISTS (
  SELECT 1 FROM sys.key_constraints
  WHERE name = 'UQ_CrmOccupancyCertificate_ProjectId_CertType'
    AND parent_object_id = OBJECT_ID('dbo.CrmOccupancyCertificate')
)
BEGIN
  ALTER TABLE dbo.CrmOccupancyCertificate DROP CONSTRAINT UQ_CrmOccupancyCertificate_ProjectId_CertType;
  PRINT 'Dropped UQ_CrmOccupancyCertificate_ProjectId_CertType (replaced by filtered indexes below).';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CrmOcCc_Project' AND object_id = OBJECT_ID('dbo.CrmOccupancyCertificate'))
BEGIN
  CREATE UNIQUE INDEX UQ_CrmOcCc_Project ON dbo.CrmOccupancyCertificate(ProjectId, CertType) WHERE BlockId IS NULL;
  PRINT 'Created UQ_CrmOcCc_Project (exactly one project-wide cert per type).';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_CrmOcCc_Block' AND object_id = OBJECT_ID('dbo.CrmOccupancyCertificate'))
BEGIN
  CREATE UNIQUE INDEX UQ_CrmOcCc_Block ON dbo.CrmOccupancyCertificate(ProjectId, BlockId, CertType) WHERE BlockId IS NOT NULL;
  PRINT 'Created UQ_CrmOcCc_Block (exactly one cert per block per type, unlimited blocks).';
END
GO
