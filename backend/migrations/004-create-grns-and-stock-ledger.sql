-- Migration 004: Create GoodsReceiptNotes and StockLedger tables
-- Run through backend/migrate.js against the configured database.

-- Create GoodsReceiptNotes table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GoodsReceiptNotes')
BEGIN
  CREATE TABLE GoodsReceiptNotes (
    GRNID int IDENTITY(1,1) PRIMARY KEY,
    GRNNo NVARCHAR(50) NOT NULL,
    GRNDate DATE NOT NULL,
    SupplierID int NULL, -- FK to AccountHeadMaster.LHeadId
    POID int NULL, -- FK to PurchaseOrders.PurchaseOrderID
    GRNItems NVARCHAR(MAX), -- JSON array
    Status NVARCHAR(50) DEFAULT 'Draft',
    Remarks NVARCHAR(MAX),
    CreatedDate DATETIME2 DEFAULT GETDATE(),
    UpdatedDate DATETIME2 NULL
  );

  PRINT 'GoodsReceiptNotes table created';
END
ELSE
  PRINT 'GoodsReceiptNotes table already exists';

-- Create/Fix StockLedger table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'StockLedger')
BEGIN
  CREATE TABLE StockLedger (
    StockID int IDENTITY(1,1) PRIMARY KEY,
    ItemID int NOT NULL,
    Qty DECIMAL(18,2) NOT NULL,
    Type NVARCHAR(10) NOT NULL CHECK (Type IN ('IN', 'OUT')),
    RefType NVARCHAR(20) NOT NULL,
    RefID int NOT NULL,
    EntryDate DATETIME2 DEFAULT GETDATE()
  );

  PRINT 'StockLedger table created';
END
ELSE
  PRINT 'StockLedger table already exists';

PRINT 'Migration complete. Run backend/routes/dba.js to verify: GET /api/dba/tables';
