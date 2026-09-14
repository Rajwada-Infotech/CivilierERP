-- Migration 366: Fixed Asset Assignment module.
--
-- Splits "who currently has this asset" out of the Fixed Asset Record entry
-- form into its own explicit, after-the-fact step — a new Assignment
-- transaction, distinct from both asset creation (no more Location/
-- Custodian/Department fields collected there) and from User-Wise Asset
-- Transfer (which moves an asset between two ALREADY-known holders;
-- Assignment is the first — or a fresh, no-history-required — hand-out).
--
-- dbo.FixedAssetAssignment is a full audit trail (one row per assignment,
-- never overwritten) the same way dbo.AssetTransferHistory is; the "current"
-- assignment is always just the latest row for a given asset, and — like
-- Transfer — every successful assignment also writes straight through to
-- dbo.FixedAssetRecord.CustodianUserId/Custodian/CompanyId/ProjectId so the
-- asset's "current holder" stays visible everywhere that already reads
-- those columns (Asset Register, Detail view, Transfer's own eligibility
-- query) without any of them needing to change.
--
-- Also renames the fixed-asset-record PageDefinitions label (menu/page name
-- only — the page key, and every RoleRights/UserPageRightsJson grant keyed
-- on it, is unchanged) to "Fixed Asset Depreciation Tag".

IF NOT EXISTS (
  SELECT 1 FROM sys.tables WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'FixedAssetAssignment'
)
BEGIN
  CREATE TABLE dbo.FixedAssetAssignment (
    AssignmentId INT IDENTITY(1,1) PRIMARY KEY,
    DocNo        NVARCHAR(100)  NULL,
    DocDate      DATE           NULL,
    FinYear      NVARCHAR(20)   NULL,
    CompanyId    INT            NULL,
    ProjectId    INT            NULL,
    AssetId      INT            NOT NULL,
    UserId       INT            NOT NULL,
    UserImage    NVARCHAR(MAX)  NULL,
    Remarks      NVARCHAR(MAX)  NULL,
    Status       NVARCHAR(20)   NOT NULL CONSTRAINT DF_FAAsn_Status DEFAULT 'Active',
    CreatedBy    NVARCHAR(200)  NULL,
    CreatedAt    DATETIME2      NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT FK_FAAsn_Asset FOREIGN KEY (AssetId) REFERENCES dbo.FixedAssetRecord(AssetId),
    CONSTRAINT FK_FAAsn_User FOREIGN KEY (UserId) REFERENCES dbo.users(id)
  );
  PRINT 'Created dbo.FixedAssetAssignment';
END
ELSE
  PRINT 'dbo.FixedAssetAssignment already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAAsn_AssetId' AND object_id = OBJECT_ID('dbo.FixedAssetAssignment'))
  CREATE INDEX IX_FAAsn_AssetId ON dbo.FixedAssetAssignment(AssetId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAAsn_UserId' AND object_id = OBJECT_ID('dbo.FixedAssetAssignment'))
  CREATE INDEX IX_FAAsn_UserId ON dbo.FixedAssetAssignment(UserId);
GO

-- ── TypeOfDoc — FAA prefix ───────────────────────────────────────────────────
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FAA')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('FAA', 'FAA', 'Fixed Asset Assignment', 1, 5, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc FAA';
END
ELSE
  PRINT 'TypeOfDoc FAA already exists';
GO

-- ── PageDefinitions — fixed-asset-assignment ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'fixed-asset-assignment' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('fixed-asset-assignment', 'Assignment', 'Fixed Asset', 'Fixed Asset', 'view,create', 236, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions fixed-asset-assignment';
END
ELSE
  PRINT 'PageDefinitions fixed-asset-assignment already exists';
GO

-- ── Rename the Fixed Asset Record menu label ─────────────────────────────────
UPDATE dbo.PageDefinitions
SET Label = 'Fixed Asset Depreciation Tag'
WHERE PageKey = 'fixed-asset-record';
GO

PRINT '366-fixed-asset-assignment applied successfully.';
GO
