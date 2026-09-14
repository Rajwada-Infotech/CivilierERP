-- Migration 158: Journal Voucher (JV) header + lines
--
-- Used to forcefully correct an account-head-to-account-head mismatch via a
-- manual multi-line debit/credit entry. Goes through the same Draft ->
-- Pending -> Approved workflow as GRN/Expense Booking (approvalService.js)
-- before posting to dbo.GeneralLedgerEntry (SourceType='JournalVoucher').
-- Lines map 1:1 onto postVoucher()'s legs array shape.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'JournalVoucher'
)
BEGIN
  CREATE TABLE dbo.JournalVoucher (
    JVID        INT IDENTITY(1,1) PRIMARY KEY,
    JVNo        NVARCHAR(100)   NULL,
    JVDate      DATE            NOT NULL,
    Narration   NVARCHAR(500)   NULL,
    CompanyId   INT             NULL,
    ProjectId   INT             NULL,
    Status      NVARCHAR(20)    NOT NULL CONSTRAINT DF_JV_Status DEFAULT 'Draft',
    DocTypeId   INT             NULL,
    CreatedBy   NVARCHAR(150)   NULL,
    CreatedAt   DATETIME2       NOT NULL CONSTRAINT DF_JV_CreatedAt DEFAULT SYSDATETIME(),
    UpdatedBy   NVARCHAR(150)   NULL,
    UpdatedAt   DATETIME2       NULL
  );

  CREATE INDEX IX_JV_Status ON dbo.JournalVoucher(Status);
  CREATE INDEX IX_JV_JVDate ON dbo.JournalVoucher(JVDate);

  PRINT 'Created dbo.JournalVoucher';
END
ELSE
  PRINT 'dbo.JournalVoucher already exists — skipping create';
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'JournalVoucherLines'
)
BEGIN
  CREATE TABLE dbo.JournalVoucherLines (
    LineID       INT IDENTITY(1,1) PRIMARY KEY,
    JVID         INT             NOT NULL,
    LHeadId      INT             NOT NULL,
    DebitAmount  DECIMAL(18,2)   NOT NULL CONSTRAINT DF_JVL_Debit  DEFAULT 0,
    CreditAmount DECIMAL(18,2)   NOT NULL CONSTRAINT DF_JVL_Credit DEFAULT 0,
    Narration    NVARCHAR(255)   NULL,
    SortOrder    INT             NOT NULL CONSTRAINT DF_JVL_SortOrder DEFAULT 0,
    CONSTRAINT FK_JVL_JV FOREIGN KEY (JVID) REFERENCES dbo.JournalVoucher(JVID) ON DELETE CASCADE,
    CONSTRAINT FK_JVL_LHead FOREIGN KEY (LHeadId) REFERENCES dbo.AccountHeadMaster(LHeadId),
    CONSTRAINT CK_JVL_OneSided CHECK (
      (DebitAmount > 0 AND CreditAmount = 0) OR
      (CreditAmount > 0 AND DebitAmount = 0)
    )
  );

  CREATE INDEX IX_JVL_JVID ON dbo.JournalVoucherLines(JVID);

  PRINT 'Created dbo.JournalVoucherLines';
END
ELSE
  PRINT 'dbo.JournalVoucherLines already exists — skipping create';
GO
