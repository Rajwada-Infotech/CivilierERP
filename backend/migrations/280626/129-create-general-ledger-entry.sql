-- Migration 129: General Ledger posting table
--
-- Every approved transaction (GRN, Expense Booking, Payment Made, Received
-- Payment) posts one row per debit/credit leg here, tagged to an
-- AccountHeadMaster.LHeadId. A balanced voucher = 2+ rows sharing VoucherNo
-- whose DebitAmount and CreditAmount columns sum equal.
--
-- Trial Balance is now a straight GROUP BY LHeadId over this table instead
-- of scanning source documents per account type.
--
-- Starts capturing from the date this migration runs — no historical
-- backfill (decision: 2026-06-28).

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GeneralLedgerEntry'
)
BEGIN
  CREATE TABLE dbo.GeneralLedgerEntry (
    EntryId           INT IDENTITY(1,1) PRIMARY KEY,
    VoucherNo         NVARCHAR(50)    NOT NULL,
    VoucherDate       DATE            NOT NULL,
    LHeadId           INT             NOT NULL,
    DebitAmount       DECIMAL(18,2)   NOT NULL CONSTRAINT DF_GLE_Debit  DEFAULT 0,
    CreditAmount      DECIMAL(18,2)   NOT NULL CONSTRAINT DF_GLE_Credit DEFAULT 0,
    Narration         NVARCHAR(255)   NULL,
    SourceType        NVARCHAR(30)    NOT NULL,  -- 'GRN' | 'ExpenseBooking' | 'NewPayment' | 'ReceivedPayment' | 'SaleInvoice'
    SourceId          INT             NOT NULL,
    CompanyId         INT             NULL,
    ProjectId         INT             NULL,
    IsReversed        BIT             NOT NULL CONSTRAINT DF_GLE_IsReversed DEFAULT 0,
    ReversalOfEntryId INT             NULL,
    CreatedBy         NVARCHAR(150)   NULL,
    CreatedAt         DATETIME2       NOT NULL CONSTRAINT DF_GLE_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT FK_GLE_LHead FOREIGN KEY (LHeadId) REFERENCES dbo.AccountHeadMaster(LHeadId),
    CONSTRAINT FK_GLE_ReversalOf FOREIGN KEY (ReversalOfEntryId) REFERENCES dbo.GeneralLedgerEntry(EntryId),
    CONSTRAINT CK_GLE_OneSided CHECK (
      (DebitAmount > 0 AND CreditAmount = 0) OR
      (CreditAmount > 0 AND DebitAmount = 0)
    )
  );

  CREATE INDEX IX_GLE_LHeadId ON dbo.GeneralLedgerEntry(LHeadId);
  CREATE INDEX IX_GLE_VoucherDate ON dbo.GeneralLedgerEntry(VoucherDate);
  -- Non-unique: a single source posts multiple legs (e.g. GRN posts 3 rows).
  -- Used for "already posted?" existence checks, not as a uniqueness guard.
  CREATE INDEX IX_GLE_Source ON dbo.GeneralLedgerEntry(SourceType, SourceId);

  PRINT 'Created dbo.GeneralLedgerEntry';
END
ELSE
  PRINT 'dbo.GeneralLedgerEntry already exists — skipping create';
GO
