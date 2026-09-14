-- Migration 293: Cheque Cancellation feature
--
-- 1. dbo.CancelledCheque — permanent record of every cancelled cheque number,
--    keyed by (ChequeLotId, ChequeNo) so a cancelled number can never be
--    reissued from the same lot again, independent of whatever happens to
--    the NewPayment row it was originally tied to.
-- 2. dbo.NewPayment.PIsChequeCancelled — fast, denormalized flag so the
--    Payment page can render a "Cancelled Cheque" badge without a join.
--    On cancellation the payment's PChequeLotId is also nulled out (the
--    cheque is detached/"removed" from its lot per spec) while PChequeNo is
--    kept for display/audit traceability.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CancelledCheque' AND schema_id = SCHEMA_ID('dbo'))
BEGIN
  CREATE TABLE dbo.CancelledCheque (
    CCId              INT IDENTITY(1,1) PRIMARY KEY,
    ChequeLotId       INT NOT NULL REFERENCES dbo.ChequeMaster(CId),
    ChequeLotNumber   NVARCHAR(100) NULL,
    ChequeNo          NVARCHAR(50) NOT NULL,
    PaymentId         INT NULL REFERENCES dbo.NewPayment(PPaymentID),
    BankId            INT NULL,
    BankName          NVARCHAR(200) NULL,
    AccountNumber     NVARCHAR(50) NULL,
    Reason            NVARCHAR(500) NULL,
    CancelledBy       NVARCHAR(150) NULL,
    CancelledAt       DATETIME NOT NULL DEFAULT SYSUTCDATETIME()
  );
  PRINT 'Table dbo.CancelledCheque created.';
END
ELSE
  PRINT 'Table dbo.CancelledCheque already exists — skipped.';
GO

-- One cheque number can only ever be cancelled once per lot.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('dbo.CancelledCheque') AND name = 'UX_CancelledCheque_Lot_ChequeNo'
)
  CREATE UNIQUE NONCLUSTERED INDEX UX_CancelledCheque_Lot_ChequeNo
    ON dbo.CancelledCheque (ChequeLotId, ChequeNo);
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'NewPayment' AND COLUMN_NAME = 'PIsChequeCancelled'
)
  ALTER TABLE dbo.NewPayment
    ADD PIsChequeCancelled BIT NOT NULL CONSTRAINT DF_NewPayment_PIsChequeCancelled DEFAULT 0;
GO

PRINT '293-cancelled-cheque applied successfully.';
GO
