-- 303-expense-head-allocation.sql
--
-- Generic multi-GL-head tagging table, shared by:
--   * ExpenseBooking (Invoice, specifically direct/DINV bookings — replaces
--     the single EGLAccountId dropdown with a repeatable list of Expense
--     Head + Amount rows that must sum to the invoice amount)
--   * NewPayment (a new "Direct Expense Payment" mode — paying one or more
--     Expense Heads directly, without a linked invoice/party)
--
-- One row per (source record, GL head, amount). SourceType + SourceId
-- together identify the owning record, same convention as
-- dbo.GeneralLedgerEntry's own SourceType/SourceId columns.
--
-- EGLAccountId on dbo.ExpenseBooking (migration 290) is left in place for
-- backward compatibility — any existing row that has EGLAccountId set but
-- no allocation rows yet is treated as a single-row allocation (see the
-- backfill at the bottom of this file).

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ExpenseHeadAllocation')
BEGIN
  CREATE TABLE dbo.ExpenseHeadAllocation (
    AllocationId INT IDENTITY(1,1) PRIMARY KEY,
    SourceType   NVARCHAR(30)   NOT NULL,
    SourceId     INT            NOT NULL,
    LHeadId      INT            NOT NULL,
    Amount       DECIMAL(18,2)  NOT NULL,
    CreatedAt    DATETIME       NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_ExpenseHeadAllocation_LHead FOREIGN KEY (LHeadId)
      REFERENCES dbo.AccountHeadMaster(LHeadId)
  );

  CREATE INDEX IX_ExpenseHeadAllocation_Source
    ON dbo.ExpenseHeadAllocation(SourceType, SourceId);
END
GO

-- Backfill: any existing direct (non-GRN) ExpenseBooking with a single
-- EGLAccountId tagged, and no allocation rows yet, becomes a one-row
-- allocation for the full amount that was actually posted (ENetAmount,
-- falling back to EAmount) — so old and new records both read through the
-- same allocation table going forward. No-op on a database with no such
-- rows yet (this table is brand new).
INSERT INTO dbo.ExpenseHeadAllocation (SourceType, SourceId, LHeadId, Amount)
SELECT 'ExpenseBooking', eb.Eid, eb.EGLAccountId, ISNULL(eb.ENetAmount, eb.EAmount)
FROM dbo.ExpenseBooking eb
WHERE eb.EGLAccountId IS NOT NULL
  AND ISNULL(eb.ENetAmount, eb.EAmount) > 0
  AND NOT EXISTS (
    SELECT 1 FROM dbo.ExpenseHeadAllocation a
    WHERE a.SourceType = 'ExpenseBooking' AND a.SourceId = eb.Eid
  );
GO
