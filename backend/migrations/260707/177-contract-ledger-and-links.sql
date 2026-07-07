-- ============================================================
-- Migration 177: On-account advance/adjustment ledger for dbo.Contract.
--
-- dbo.Contract (migration 176) is a plain record — no financial linkage.
-- This adds the ledger that makes it a live commercial contract: a token
-- or advance can be received/paid against a contract before any invoice
-- or expense booking exists, and later invoices/expense bookings booked
-- against that same contract automatically net the available advance.
--
-- dbo.ContractLedger is the single source of truth for a contract's
-- running balance — every advance in and every automatic adjustment
-- applied is one signed row here (+ve = advance in, -ve = adjustment
-- applied). Nothing computes or caches this balance a second way
-- anywhere else (see backend/services/contractLedger.js).
--
-- ContractId is added as a NULLABLE column on the four documents that can
-- reference a contract: ReceivedPayment/NewPayment (advances, before any
-- invoice/expense booking exists) and SaleInvoices/ExpenseBooking
-- (auto-allocation target). Nullable everywhere — every existing flow
-- that doesn't reference a contract is completely unaffected.
--
-- Safe to run multiple times.
-- ============================================================

IF OBJECT_ID('dbo.ContractLedger', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ContractLedger (
    LedgerId      INT IDENTITY(1,1) PRIMARY KEY,
    ContractId    INT            NOT NULL REFERENCES dbo.Contract(ContractId),
    TxnType       NVARCHAR(30)   NOT NULL CHECK (TxnType IN ('Advance', 'Adjustment', 'Refund')),
    Amount        DECIMAL(18,2)  NOT NULL,
    SourceType    NVARCHAR(30)   NOT NULL CHECK (SourceType IN ('ReceivedPayment', 'NewPayment', 'SaleInvoice', 'ExpenseBooking')),
    SourceId      INT            NOT NULL,
    SourceDocNo   NVARCHAR(100)  NULL,
    Remarks       NVARCHAR(500)  NULL,
    CreatedBy     NVARCHAR(150)  NULL,
    CreatedAt     DATETIME2      NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_ContractLedger_ContractId ON dbo.ContractLedger(ContractId);
  CREATE INDEX IX_ContractLedger_Source ON dbo.ContractLedger(SourceType, SourceId);
  PRINT 'Created dbo.ContractLedger.';
END
ELSE
  PRINT 'dbo.ContractLedger already exists.';
GO

IF COL_LENGTH('dbo.ReceivedPayment', 'ContractId') IS NULL
  ALTER TABLE dbo.ReceivedPayment ADD ContractId INT NULL REFERENCES dbo.Contract(ContractId);
GO

IF COL_LENGTH('dbo.NewPayment', 'ContractId') IS NULL
  ALTER TABLE dbo.NewPayment ADD ContractId INT NULL REFERENCES dbo.Contract(ContractId);
GO

IF COL_LENGTH('dbo.SaleInvoices', 'ContractId') IS NULL
  ALTER TABLE dbo.SaleInvoices ADD ContractId INT NULL REFERENCES dbo.Contract(ContractId);
GO

IF COL_LENGTH('dbo.ExpenseBooking', 'ContractId') IS NULL
  ALTER TABLE dbo.ExpenseBooking ADD ContractId INT NULL REFERENCES dbo.Contract(ContractId);
GO
