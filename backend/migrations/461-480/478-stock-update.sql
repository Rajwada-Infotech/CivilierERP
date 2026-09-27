-- Migration 478: Stock Update — manual "add these items to this godown"
-- entries (Material > Stock Update). Each save writes one header row, its
-- item rows, and one StockLedger IN row per item (RefType 'STKUPD'), so the
-- update shows up in the Stock page like any GRN/Issue. Also registers the
-- 'stock-update' page for the rights system.

IF OBJECT_ID('dbo.StockUpdate', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.StockUpdate (
    StockUpdateId INT IDENTITY(1,1) PRIMARY KEY,
    DocNo         NVARCHAR(50)  NULL,
    UpdateDate    DATE          NOT NULL,
    CompanyId     INT           NOT NULL,
    ProjectId     INT           NOT NULL,
    GodownId      INT           NOT NULL,
    Remarks       NVARCHAR(500) NULL,
    CreatedBy     NVARCHAR(150) NULL,
    CreatedAt     DATETIME2(3)  NOT NULL CONSTRAINT DF_StockUpdate_CreatedAt DEFAULT SYSUTCDATETIME()
  );
END
GO

IF OBJECT_ID('dbo.StockUpdateItems', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.StockUpdateItems (
    StockUpdateItemId INT IDENTITY(1,1) PRIMARY KEY,
    StockUpdateId     INT            NOT NULL,
    ItemId            NVARCHAR(50)   NOT NULL,
    UOM               NVARCHAR(20)   NULL,
    Qty               DECIMAL(18,3)  NOT NULL,
    CONSTRAINT FK_StockUpdateItems_Header FOREIGN KEY (StockUpdateId) REFERENCES dbo.StockUpdate (StockUpdateId)
  );
  CREATE INDEX IX_StockUpdateItems_Header ON dbo.StockUpdateItems (StockUpdateId);
END
GO

INSERT INTO dbo.PageDefinitions (PageKey, Label, Module, GroupName, Actions, SortOrder, IsActive, CreatedBy, CreatedAt)
SELECT 'stock-update', 'Stock Update', 'Material', 'Material', 'view,create,print,export', 155, 1, 'migration-478', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.PageDefinitions pd WHERE pd.PageKey = 'stock-update' AND pd.IsActive = 1
);
GO

PRINT '478-stock-update applied successfully.';
GO
