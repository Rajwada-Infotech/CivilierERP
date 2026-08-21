-- ============================================================
-- Migration: CrmCancellation — Maker-Checker Finance Gate
-- Add audit columns for finance approval.
-- ============================================================
IF NOT EXISTS (
    SELECT 1 FROM sys.columns 
    WHERE Name = N'FinanceClearedBy' 
    AND Object_ID = Object_ID(N'dbo.CrmCancellation')
)
BEGIN
    ALTER TABLE dbo.CrmCancellation
    ADD 
        FinanceClearedBy INT NULL REFERENCES dbo.Users(id),
        FinanceClearedAt DATETIME2(3) NULL;
    PRINT 'Added FinanceClearedBy and FinanceClearedAt to dbo.CrmCancellation';
END
ELSE
    PRINT 'Columns already exist on dbo.CrmCancellation — skipped';
GO
