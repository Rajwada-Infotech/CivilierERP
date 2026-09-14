-- ============================================================
-- Migration: 114-card-master-bank-link.sql
--
-- Resolves the gap where dbo.card_master stored only a free-text
-- bank_name, making it impossible to reliably look up "which cards
-- belong to bank X" (the same problem ChequeMaster solves with a
-- BankId FK). This adds:
--
--   1. dbo.card_master.bank_id  — INT, points at the same bank-id
--      space already used by NewPayment.PBankID and the
--      /api/account-head/bank-options + /api/bank-master endpoints
--      (i.e. dbo.AccountHeadMaster.LHeadId where LHeadType = 'B').
--      bank_name is kept as a denormalized display fallback.
--
--   2. dbo.NewPayment.PCardId   — INT, records which specific card
--      (from card_master) was used for a "Card" mode payment, so a
--      bank with multiple cards can be disambiguated. The existing
--      PCardReference column keeps storing the transaction/approval
--      ID — the two are independent and both kept.
--
-- Safe to run multiple times (guarded).
-- ============================================================

SET NOCOUNT ON;
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'card_master'
      AND COLUMN_NAME = 'bank_id'
)
BEGIN
    ALTER TABLE dbo.card_master
    ADD bank_id INT NULL;

    PRINT 'bank_id column added to dbo.card_master.';
END
ELSE
    PRINT 'bank_id column already exists on dbo.card_master.';
GO

IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'NewPayment'
      AND COLUMN_NAME = 'PCardId'
)
BEGIN
    ALTER TABLE dbo.NewPayment
    ADD PCardId INT NULL;

    PRINT 'PCardId column added to dbo.NewPayment.';
END
ELSE
    PRINT 'PCardId column already exists on dbo.NewPayment.';
GO

-- Helpful for the "/api/card-master?bankId=" lookup used by the
-- Payment form's card selector.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_card_master_bank_id'
      AND object_id = OBJECT_ID('dbo.card_master')
)
BEGIN
    CREATE INDEX IX_card_master_bank_id ON dbo.card_master(bank_id);
    PRINT 'IX_card_master_bank_id created.';
END
ELSE
    PRINT 'IX_card_master_bank_id already exists.';
GO

PRINT '================================================================';
PRINT '114-card-master-bank-link applied successfully.';
PRINT '================================================================';
GO
