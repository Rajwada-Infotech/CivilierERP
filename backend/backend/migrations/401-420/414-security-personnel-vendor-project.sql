-- ============================================================
-- Migration 414: Security Personnel — Vendor + Project.
--
-- Security guards are usually supplied by a third-party agency (a
-- Supplier/Contractor/Broker head in AccountHeadMaster) and posted at a
-- specific project. Both are optional, informational links — nothing
-- posts GL against them; VendorId just narrows AccountHeadMaster to the
-- LHeadType values that actually represent a real-world vendor/party
-- (S=Supplier, C=Contractor, BR=Broker, A=Customer), same set the
-- Vendor Ledger Report searches.
--
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.SecurityPersonnel') AND name = 'VendorId'
)
BEGIN
  ALTER TABLE dbo.SecurityPersonnel ADD VendorId INT NULL REFERENCES dbo.AccountHeadMaster(LHeadId);
  PRINT 'Added dbo.SecurityPersonnel.VendorId';
END
ELSE
  PRINT 'dbo.SecurityPersonnel.VendorId already exists';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.SecurityPersonnel') AND name = 'ProjectId'
)
BEGIN
  ALTER TABLE dbo.SecurityPersonnel ADD ProjectId INT NULL REFERENCES dbo.enterprise(id);
  PRINT 'Added dbo.SecurityPersonnel.ProjectId';
END
ELSE
  PRINT 'dbo.SecurityPersonnel.ProjectId already exists';
GO

PRINT '414-security-personnel-vendor-project applied successfully.';
GO
