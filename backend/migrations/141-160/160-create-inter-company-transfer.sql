-- Migration 160: Inter-Company Stock Transfer (ICT) header + items
--
-- Records a stock movement between two Projects belonging to DIFFERENT
-- Companies (crossing legal/GST entities), and links every auto-generated
-- commercial document created on both sides so the transfer can be traced
-- end-to-end from a single row:
--   Sender (Supplier role):   SaleOrder -> SaleInvoice -> ReceivedPayment
--   Receiver (Customer role): PurchaseOrder -> GRN -> ExpenseBooking -> NewPayment
-- Same-company project-to-project moves are NOT recorded here — those stay
-- on the existing dbo.StockTransfers (Godown-to-Godown) feature.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'InterCompanyTransfer'
)
BEGIN
  CREATE TABLE dbo.InterCompanyTransfer (
    ICTId               INT IDENTITY(1,1) PRIMARY KEY,
    DocNo               NVARCHAR(100)  NULL,
    TransferDate        DATE           NOT NULL,
    SenderProjectId     INT            NOT NULL,
    SenderCompanyId     INT            NOT NULL,
    ReceiverProjectId   INT            NOT NULL,
    ReceiverCompanyId   INT            NOT NULL,
    Status              NVARCHAR(20)   NOT NULL CONSTRAINT DF_ICT_Status DEFAULT 'Completed',
    TotalAmount         DECIMAL(18,2)  NOT NULL CONSTRAINT DF_ICT_Total DEFAULT 0,
    Remarks             NVARCHAR(500)  NULL,
    -- Linked auto-generated documents, one per leg of the round trip.
    SaleOrderId         INT            NULL,
    SaleInvoiceId       INT            NULL,
    ReceivedPaymentId   INT            NULL,
    PurchaseOrderId     INT            NULL,
    GRNId               INT            NULL,
    ExpenseBookingId    INT            NULL,
    NewPaymentId        INT            NULL,
    DocTypeId           INT            NULL,
    CreatedBy           NVARCHAR(150)  NULL,
    CreatedAt           DATETIME2      NOT NULL CONSTRAINT DF_ICT_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT CK_ICT_DifferentCompanies CHECK (SenderCompanyId <> ReceiverCompanyId)
  );

  CREATE INDEX IX_ICT_SenderProjectId ON dbo.InterCompanyTransfer(SenderProjectId);
  CREATE INDEX IX_ICT_ReceiverProjectId ON dbo.InterCompanyTransfer(ReceiverProjectId);
  CREATE INDEX IX_ICT_TransferDate ON dbo.InterCompanyTransfer(TransferDate);

  PRINT 'Created dbo.InterCompanyTransfer';
END
ELSE
  PRINT 'dbo.InterCompanyTransfer already exists — skipping create';
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'InterCompanyTransferItems'
)
BEGIN
  CREATE TABLE dbo.InterCompanyTransferItems (
    ICTItemId     INT IDENTITY(1,1) PRIMARY KEY,
    ICTId         INT             NOT NULL,
    ItemId        NVARCHAR(50)    NOT NULL,
    ItemName      NVARCHAR(200)   NULL,
    UOMCode       NVARCHAR(20)    NULL,
    Quantity      DECIMAL(18,4)   NOT NULL CONSTRAINT DF_ICTI_Qty DEFAULT 0,
    Rate          DECIMAL(18,4)   NOT NULL CONSTRAINT DF_ICTI_Rate DEFAULT 0,
    Amount        DECIMAL(18,2)   NOT NULL CONSTRAINT DF_ICTI_Amount DEFAULT 0,
    -- Traceability: which GRN/PO the Rate above was sourced from.
    SourceDocNo   NVARCHAR(100)   NULL,
    SortOrder     INT             NOT NULL CONSTRAINT DF_ICTI_SortOrder DEFAULT 0,
    CONSTRAINT FK_ICTI_ICT FOREIGN KEY (ICTId) REFERENCES dbo.InterCompanyTransfer(ICTId) ON DELETE CASCADE
  );

  CREATE INDEX IX_ICTI_ICTId ON dbo.InterCompanyTransferItems(ICTId);

  PRINT 'Created dbo.InterCompanyTransferItems';
END
ELSE
  PRINT 'dbo.InterCompanyTransferItems already exists — skipping create';
GO
