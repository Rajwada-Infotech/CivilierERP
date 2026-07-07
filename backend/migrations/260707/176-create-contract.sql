-- Migration 176 — Create dbo.Contract + TypeOfDoc seed + PageDefinition
-- Civilier ERP  2026-07-07
-- ============================================================================

-- ── 1. Contract table ────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Contract'
)
BEGIN
  CREATE TABLE dbo.Contract (
    ContractId        INT           IDENTITY(1,1) PRIMARY KEY,
    DocNo             NVARCHAR(100) NULL,
    DocTypeId         INT           NULL REFERENCES dbo.TypeOfDoc(TypeOfDocId),
    DocDate           DATE          NULL,
    ContractDate      DATE          NULL,          -- effective / start of contract
    CompanyId         INT           NULL,          -- FK enterprise (Company)
    ProjectId         INT           NULL,          -- FK enterprise (Project)
    FinYear           NVARCHAR(20)  NULL,
    ContactPerson     NVARCHAR(200) NULL,
    Reason            NVARCHAR(MAX) NULL,
    NatureOfContract  NVARCHAR(500) NULL,
    ContractAmount    DECIMAL(18,2) NULL,
    ContractStartDate DATE          NULL,
    ContractEndDate   DATE          NULL,
    Attachments       NVARCHAR(MAX) NULL,          -- JSON array of {name, url, type}
    TermsAndConditions NVARCHAR(MAX) NULL,
    Remarks           NVARCHAR(MAX) NULL,
    Status            NVARCHAR(30)  NOT NULL DEFAULT 'Draft',
    DocYear           SMALLINT      NULL,
    DocSerial         INT           NULL,
    CreatedBy         NVARCHAR(200) NULL,
    CreatedAt         DATETIME2     NOT NULL DEFAULT GETDATE(),
    UpdatedBy         NVARCHAR(200) NULL,
    UpdatedAt         DATETIME2     NULL
  );
  PRINT 'Created dbo.Contract';
END
ELSE
  PRINT 'dbo.Contract already exists — skipping';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Contract') AND name = 'IX_Contract_DocNo'
)
  CREATE INDEX IX_Contract_DocNo ON dbo.Contract (DocNo) WHERE DocNo IS NOT NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.Contract') AND name = 'IX_Contract_CompanyProject'
)
  CREATE INDEX IX_Contract_CompanyProject ON dbo.Contract (CompanyId, ProjectId);
GO

-- ── 2. TypeOfDoc seed — prefix "CON" ────────────────────────────────────────
DECLARE @EId_ANY UNIQUEIDENTIFIER = (SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt);
IF @EId_ANY IS NULL
BEGIN
  RAISERROR('No rows in dbo.Entry_Type. Populate it first.', 16, 1);
  RETURN;
END

IF NOT EXISTS (SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'CON')
BEGIN
  INSERT INTO dbo.TypeOfDoc
    (DocNoPrefix, Prefix, Description, StartingDocNo, DocNoPadding, IsActive, EntryTypeId, CreatedBy, CreatedAt)
  VALUES
    ('CON', 'CON', 'Contract', 1, 5, 1, @EId_ANY, 'migration', GETDATE());
  PRINT 'Seeded TypeOfDoc CON';
END
ELSE
  PRINT 'TypeOfDoc CON already exists';
GO

-- ── 3. PageDefinitions seed ──────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions WHERE PageKey = 'finance-contracts' AND IsActive = 1
)
BEGIN
  INSERT INTO dbo.PageDefinitions
    (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
  VALUES
    ('finance-contracts', 'Contracts', 'Finance', 'Transaction',
     '["view","create","edit","delete"]', 50, 1, 'migration', GETDATE());
  PRINT 'Seeded PageDefinitions finance-contracts';
END
ELSE
  PRINT 'PageDefinitions finance-contracts already exists';
GO

PRINT 'Migration 176 complete.';
