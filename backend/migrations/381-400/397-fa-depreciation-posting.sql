-- Migration 397: Fixed Asset depreciation posting.
--
-- Posts a monthly depreciation journal for a Fixed Asset Record:
--   Dr  Depreciation Expense A/c        (period charge)
--   Cr  Accumulated Depreciation A/c    (period charge)
--
-- Both GL heads are seeded by migration 393-seed-depreciation-gl-heads.sql
-- (looked up by name in services/fixedAssetDepreciationPosting.js, never a
-- hard-coded id). One entry per asset per calendar month.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'FixedAssetDepreciationEntry' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.FixedAssetDepreciationEntry (
    EntryId                 INT IDENTITY(1,1) PRIMARY KEY,
    AssetId                 INT           NOT NULL,
    PeriodYear              SMALLINT      NOT NULL,
    PeriodMonth             TINYINT       NOT NULL,     -- 1..12
    FinYear                 NVARCHAR(20)  NULL,         -- snapshot, for reporting
    Method                  NVARCHAR(10)  NOT NULL,     -- 'SLM' | 'WDV'
    RatePct                 DECIMAL(9,4)  NOT NULL,
    PurchaseCost            DECIMAL(18,2) NOT NULL,
    OpeningBookValue        DECIMAL(18,2) NOT NULL,
    DepreciationAmount      DECIMAL(18,2) NOT NULL,
    ClosingBookValue        DECIMAL(18,2) NOT NULL,
    AccumulatedDepreciation DECIMAL(18,2) NOT NULL,     -- after this entry
    CompanyId               INT           NULL,
    ProjectId               INT           NULL,
    Status                  NVARCHAR(20)  NOT NULL CONSTRAINT DF_FADep_Status DEFAULT 'Posted',
    VoucherNo               NVARCHAR(50)  NULL,
    PostedBy                NVARCHAR(200) NULL,
    PostedAt                DATETIME2     NULL,
    CreatedBy               NVARCHAR(200) NULL,
    CreatedAt               DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    UpdatedBy               NVARCHAR(200) NULL,
    UpdatedAt               DATETIME2     NULL,
    CONSTRAINT FK_FADep_Asset FOREIGN KEY (AssetId) REFERENCES dbo.FixedAssetRecord(AssetId),
    CONSTRAINT CK_FADep_Month  CHECK (PeriodMonth BETWEEN 1 AND 12),
    CONSTRAINT CK_FADep_Method CHECK (Method IN ('SLM','WDV')),
    CONSTRAINT CK_FADep_Status CHECK (Status IN ('Posted','Reversed'))
  );
  PRINT 'Created dbo.FixedAssetDepreciationEntry';
END
ELSE
  PRINT 'dbo.FixedAssetDepreciationEntry already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FADep_Asset' AND object_id = OBJECT_ID('dbo.FixedAssetDepreciationEntry'))
  CREATE INDEX IX_FADep_Asset ON dbo.FixedAssetDepreciationEntry(AssetId, PeriodYear, PeriodMonth);
GO
-- One live (non-reversed) depreciation entry per asset per month.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FADep_Asset_Period' AND object_id = OBJECT_ID('dbo.FixedAssetDepreciationEntry'))
  CREATE UNIQUE INDEX UX_FADep_Asset_Period
    ON dbo.FixedAssetDepreciationEntry(AssetId, PeriodYear, PeriodMonth)
    WHERE Status <> 'Reversed';
GO

-- ── TypeOfDoc — FADEP prefix (voucher e.g. FADEP-2026-000001) ───────────────
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type);
IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'FADEP')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('FADEP', 'FADEP', 'Fixed Asset Depreciation', 1, 6, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc FADEP';
END
ELSE
  PRINT 'TypeOfDoc FADEP already exists';
GO

PRINT '397-fa-depreciation-posting applied successfully.';
GO
