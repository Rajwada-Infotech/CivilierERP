-- Migration 352: Asset Transfer module
--
-- Adds a real user-linked "who currently has this asset" column to
-- FixedAssetRecord (CustodianUserId, FK -> dbo.users) alongside the existing
-- free-text Custodian display column, plus AssetTransferHistory — the
-- audit trail for moving an asset's custody from one user to another,
-- project-wise. Modeled on dbo.TaskTransferHistory (migration 309).

-- ── 1. FixedAssetRecord.CustodianUserId ──────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.FixedAssetRecord') AND name = 'CustodianUserId')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord ADD CustodianUserId INT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_FAR_CustodianUser')
BEGIN
  ALTER TABLE dbo.FixedAssetRecord
    ADD CONSTRAINT FK_FAR_CustodianUser FOREIGN KEY (CustodianUserId) REFERENCES dbo.users(id);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FixedAssetRecord_CustodianUserId' AND object_id = OBJECT_ID('dbo.FixedAssetRecord'))
BEGIN
  CREATE INDEX IX_FixedAssetRecord_CustodianUserId ON dbo.FixedAssetRecord(CustodianUserId);
END
GO

-- ── 2. AssetTransferHistory ──────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.tables
  WHERE SCHEMA_NAME(schema_id) = 'dbo' AND name = 'AssetTransferHistory'
)
BEGIN
  CREATE TABLE dbo.AssetTransferHistory (
    Id             INT IDENTITY(1,1) PRIMARY KEY,
    DocNo          NVARCHAR(100) NULL,
    DocDate        DATE          NULL,
    TransferDate   DATE          NULL,
    CompanyId      INT           NULL,
    ProjectId      INT           NULL,
    FinYear        NVARCHAR(20)  NULL,
    AssetId        INT           NOT NULL,
    FromUserId     INT           NOT NULL,
    ToUserId       INT           NOT NULL,
    TransferredBy  INT           NULL,
    Remarks        NVARCHAR(MAX) NULL,
    CreatedAt      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    CONSTRAINT CK_ATH_DiffUsers CHECK (FromUserId <> ToUserId),
    CONSTRAINT FK_ATH_Asset FOREIGN KEY (AssetId) REFERENCES dbo.FixedAssetRecord(AssetId),
    CONSTRAINT FK_ATH_FromUser FOREIGN KEY (FromUserId) REFERENCES dbo.users(id),
    CONSTRAINT FK_ATH_ToUser FOREIGN KEY (ToUserId) REFERENCES dbo.users(id),
    CONSTRAINT FK_ATH_TransferredBy FOREIGN KEY (TransferredBy) REFERENCES dbo.users(id)
  );
  PRINT 'Created dbo.AssetTransferHistory';
END
ELSE
  PRINT 'dbo.AssetTransferHistory already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ATH_AssetId' AND object_id = OBJECT_ID('dbo.AssetTransferHistory'))
  CREATE INDEX IX_ATH_AssetId ON dbo.AssetTransferHistory(AssetId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ATH_FromUserId' AND object_id = OBJECT_ID('dbo.AssetTransferHistory'))
  CREATE INDEX IX_ATH_FromUserId ON dbo.AssetTransferHistory(FromUserId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ATH_ToUserId' AND object_id = OBJECT_ID('dbo.AssetTransferHistory'))
  CREATE INDEX IX_ATH_ToUserId ON dbo.AssetTransferHistory(ToUserId);
GO

-- ── 3. TypeOfDoc — AST prefix ────────────────────────────────────────────────
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type);

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'AST')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('AST', 'AST', 'Asset Transfer', 1, 5, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc AST';
END
ELSE
  PRINT 'TypeOfDoc AST already exists';
GO

-- ── 4. PageDefinitions ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'asset-transfer' AND IsActive = 1)
BEGIN
  INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES ('asset-transfer', 'Asset Transfer', 'Fixed Asset', 'Fixed Asset', 'view,create,edit', 233, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions asset-transfer';
END
ELSE
  PRINT 'PageDefinitions asset-transfer already exists';
GO

PRINT '352-asset-transfer applied successfully.';
GO
