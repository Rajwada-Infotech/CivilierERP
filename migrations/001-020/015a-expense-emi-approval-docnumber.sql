-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 015-expense-emi-approval-docnumber.sql
-- Adds EMI fields + discount JSON to ExpenseBooking,
-- creates ApprovalAuditLog and DocNumberSequence tables.
-- Safe to run multiple times (uses IF NOT EXISTS / column checks).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add EMI + discount columns to ExpenseBooking ──────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'ENetAmount')
  ALTER TABLE dbo.ExpenseBooking ADD ENetAmount DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'ECgstRate')
  ALTER TABLE dbo.ExpenseBooking ADD ECgstRate DECIMAL(5,2) NULL DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'ESgstRate')
  ALTER TABLE dbo.ExpenseBooking ADD ESgstRate DECIMAL(5,2) NULL DEFAULT 0;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'EDiscountData')
  ALTER TABLE dbo.ExpenseBooking ADD EDiscountData NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'EEmiData')
  ALTER TABLE dbo.ExpenseBooking ADD EEmiData NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'EInstallmentCount')
  ALTER TABLE dbo.ExpenseBooking ADD EInstallmentCount INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'EEmiAmount')
  ALTER TABLE dbo.ExpenseBooking ADD EEmiAmount DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ExpenseBooking') AND name = 'EEmiStartDate')
  ALTER TABLE dbo.ExpenseBooking ADD EEmiStartDate DATE NULL;

-- ── 2. ApprovalAuditLog — multi-level approval trail per record ───────────────

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.ApprovalAuditLog') AND type = 'U')
BEGIN
  CREATE TABLE dbo.ApprovalAuditLog (
    Id            INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
    TableName     NVARCHAR(100)  NOT NULL,   -- e.g. 'ExpenseBooking'
    RecordId      INT            NOT NULL,
    Level         INT            NOT NULL,   -- approval level (1, 2, ...)
    Role          NVARCHAR(100)  NULL,
    ApproverEmail NVARCHAR(200)  NULL,
    ActionStatus  NVARCHAR(50)   NOT NULL,   -- 'Approved' | 'Rejected' | 'Pending'
    Note          NVARCHAR(500)  NULL,
    ActionAt      DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME(),
    CreatedAt     DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME()
  );

  CREATE INDEX IX_ApprovalAuditLog_Record
    ON dbo.ApprovalAuditLog (TableName, RecordId, Level);
END;

-- ── 3. DocNumberSequence — track issued doc numbers to prevent duplicates ─────

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.DocNumberSequence') AND type = 'U')
BEGIN
  CREATE TABLE dbo.DocNumberSequence (
    Id            INT            NOT NULL IDENTITY(1,1) PRIMARY KEY,
    TypeOfDocId   INT            NOT NULL,   -- FK → dbo.TypeOfDoc.TypeOfDocId
    DocNo         NVARCHAR(100)  NOT NULL,
    TableName     NVARCHAR(100)  NULL,       -- which module used this number
    RecordId      INT            NULL,
    IssuedAt      DATETIME2(3)   NOT NULL DEFAULT SYSDATETIME(),
    IssuedBy      NVARCHAR(200)  NULL,
    CONSTRAINT UQ_DocNumberSequence_DocNo UNIQUE (DocNo)
  );

  CREATE INDEX IX_DocNumberSequence_TypePrefix
    ON dbo.DocNumberSequence (TypeOfDocId, DocNo);
END;

-- ── 4. EStatus update — add 'Pending' and 'Rejected' if using CHECK constraint ─
-- (Only needed if a CHECK constraint exists; MSSQL won't error if it doesn't)
-- If your EStatus column has a CHECK constraint, drop & recreate it:
--   ALTER TABLE dbo.ExpenseBooking DROP CONSTRAINT CK_ExpenseBooking_EStatus;
--   ALTER TABLE dbo.ExpenseBooking ADD CONSTRAINT CK_ExpenseBooking_EStatus
--     CHECK (EStatus IN ('Draft','Pending','Approved','Rejected','Booked','Hold'));

PRINT 'Migration 015 complete.';
