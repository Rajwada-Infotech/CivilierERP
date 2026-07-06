-- Migration 154: General Ledger posting outcome log
--
-- Problem this solves: when a document reaches full approval the record is
-- set to 'Approved' first, then the ledger posting runs in a try/catch that
-- swallows errors ("posting must never block the approval"). On top of that
-- the posters silently `return` when they cannot resolve a counter-account
-- (e.g. a direct payment with no expense ref, or an EName that doesn't match
-- any AccountHeadMaster row). The combined effect: a document can be Approved
-- with NO ledger entry and the only trace is a console line. The Trial
-- Balance (which reads straight off GeneralLedgerEntry) then silently
-- disagrees with the source documents, and nobody can find what to fix.
--
-- This table records the outcome of EVERY posting attempt at full approval:
--   Outcome = 'posted'  -> a balanced voucher was written
--   Outcome = 'skipped' -> poster returned without posting (Reason explains)
--   Outcome = 'failed'  -> poster threw (Reason = error message)
--   Outcome = 'none'    -> module has no GL poster (informational)
-- Operators query WHERE Outcome IN ('skipped','failed') to get an exact,
-- actionable list of approved-but-unposted documents to reconcile.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'GLPostingLog'
)
BEGIN
  CREATE TABLE dbo.GLPostingLog (
    LogId       INT IDENTITY(1,1) PRIMARY KEY,
    Module      NVARCHAR(50)   NOT NULL,   -- approval module slug, e.g. 'payments'
    RecordId    INT            NOT NULL,   -- source document PK
    Outcome     NVARCHAR(20)   NOT NULL,   -- 'posted' | 'skipped' | 'failed' | 'none'
    Reason      NVARCHAR(500)  NULL,       -- why it was skipped, or the error text
    ApproverEmail NVARCHAR(200) NULL,
    CreatedAt   DATETIME2      NOT NULL CONSTRAINT DF_GLPostingLog_CreatedAt DEFAULT SYSDATETIME(),
    CONSTRAINT CK_GLPostingLog_Outcome
      CHECK (Outcome IN ('posted', 'skipped', 'failed', 'none'))
  );

  -- Fast lookup of the outstanding reconciliation queue.
  CREATE INDEX IX_GLPostingLog_Outcome ON dbo.GLPostingLog(Outcome, CreatedAt);
  CREATE INDEX IX_GLPostingLog_Source  ON dbo.GLPostingLog(Module, RecordId);

  PRINT 'Created dbo.GLPostingLog';
END
ELSE
  PRINT 'dbo.GLPostingLog already exists - skipping';
GO
