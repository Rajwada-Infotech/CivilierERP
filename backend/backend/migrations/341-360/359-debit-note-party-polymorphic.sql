-- Migration 359: Debit Note — polymorphic Party Type, invoice-value-only rewrite
--
-- Debit Note Master previously only worked against Suppliers (dn.supplier_id
-- assumed LHeadType='S' with no enforcement) and captured free-text line
-- items whose totals were the only thing persisted server-side (discount UI
-- was client-only and lost on reload — see DebitNoteMaster.tsx history).
--
-- This migration adds the columns needed to make a Debit Note a polymorphic
-- value adjustment against any AccountHeadMaster party type (Supplier,
-- Contractor, Customer, Broker) and an invoice (dbo.ExpenseBooking), with no
-- item-level entry. dbo.DebitNoteItems is left in place (existing rows kept
-- for history) but the rewritten route stops writing to it.
--
-- Safe to run multiple times (all operations guarded).

-- ── 1. party_type — which AccountHeadMaster type dn.supplier_id points at ───
-- Column name kept as `supplier_id` (not renamed) to avoid touching every
-- existing FK/join in place — it was already a generic LHeadId FK, just
-- undeclared. NOT NULL DEFAULT 'S' backfills every existing row (all of
-- which were, in practice, always Suppliers) in the same ALTER.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.DebitNote') AND name = N'party_type'
)
    ALTER TABLE dbo.DebitNote ADD party_type CHAR(2) NOT NULL DEFAULT 'S';
GO

-- ── 2. Seed TypeOfDoc row for DN (Tier-2 dash format: DN-2026-00001) ────────
IF NOT EXISTS (
    SELECT 1 FROM dbo.TypeOfDoc WHERE DocNoPrefix = 'DN'
)
BEGIN
    DECLARE @EntryTypeId UNIQUEIDENTIFIER = (
        SELECT TOP 1 E_Id FROM dbo.Entry_Type ORDER BY E_CreatedAt
    );

    INSERT INTO dbo.TypeOfDoc
        (Prefix, DocNoPrefix, Description, ModuleCode, links_to,
         FinYearReset, IsActive, EntryTypeId, CreatedBy, CreatedAt)
    VALUES
        ('DN', 'DN', 'Debit Note', 'DN', 'Expense Booking Invoice',
         0, 1, @EntryTypeId, 'migration', GETDATE());

    PRINT 'TypeOfDoc seeded: DN';
END
ELSE
    PRINT 'TypeOfDoc DN already exists — skipped.';
GO

-- ── 3. Seed "Debit Note Adjustment A/c" system GL head ──────────────────────
-- Counter-leg for postDebitNoteAdjustment (backend/services/generalLedger.js)
-- — same singleton pattern as migration 178's "Company On Account A/c" and
-- migration 339's "Cash-in-Hand A/c".
IF NOT EXISTS (
    SELECT 1 FROM dbo.AccountHeadMaster
    WHERE LHeadName = 'Debit Note Adjustment A/c' AND LHeadType = 'GL'
)
BEGIN
    INSERT INTO dbo.AccountHeadMaster
        (LHeadName, LHeadCode, LHeadType, LHeadStatus,
         LHeadCategory, LHeadAddress, LHeadContactPerson,
         LHeadPaymentTerms, LBranchName, LCountry, IsSystemGenerated)
    VALUES
        ('Debit Note Adjustment A/c', 'DEBNOTEADJ', 'GL', 1,
         'Adjustment', 'N/A', 'N/A', 'N/A', 'Main', 'India', 1);
    PRINT 'Seeded: Debit Note Adjustment A/c GL head';
END
ELSE
BEGIN
    UPDATE dbo.AccountHeadMaster
        SET IsSystemGenerated = 1, LHeadCategory = 'Adjustment',
            LHeadCode = ISNULL(NULLIF(LHeadCode,''), 'DEBNOTEADJ')
    WHERE LHeadName = 'Debit Note Adjustment A/c' AND LHeadType = 'GL';
    PRINT 'Updated: Debit Note Adjustment A/c — marked system-generated';
END
GO

-- ── 4. Index for "debit notes against this invoice" lookups (syncBillStatus,
-- invoice history panel) ─────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_DebitNote_BillId' AND object_id = OBJECT_ID('dbo.DebitNote')
)
    CREATE INDEX IX_DebitNote_BillId ON dbo.DebitNote (bill_id);
GO

PRINT '================================================================';
PRINT '359-debit-note-party-polymorphic applied successfully.';
PRINT '================================================================';
GO
