-- Migration 291: Seed "Direct Expense Booking" (DINV) document type
-- Adds a new global dbo.TypeOfDoc row so Direct/Other-Expense bookings can
-- be numbered under their own DINV/000001 series, alongside the existing
-- INV (Expense Booking), FA (Fixed Asset Record), etc. shown in the
-- "Other Expenses" document-type picker on the Invoice/Expense Booking page.
--
-- Idempotent — only inserts if the Prefix doesn't already exist as a global
-- (CompanyId/ProjectId NULL) template, matching the pattern used by
-- backend/migrations/seeds/seed-type-of-doc.sql.

INSERT INTO dbo.TypeOfDoc (
  Prefix, Description, EntryTypeId, CompanyId, ProjectId, StartingDocNo,
  DocNoPrefix, DocNoPadding, links_to, ModuleCode, FinYearReset, IsActive,
  CreatedBy, CreatedAt
)
SELECT 'DINV', 'Direct Expense Booking', '3EAC3CBA-F003-4D43-9A6F-3B4A3A9D5AFE',
       NULL, NULL, 1, 'DINV', 5, 'Expense Booking', 'MAT', 1, 1,
       'migration-291', SYSUTCDATETIME()
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.TypeOfDoc t
  WHERE t.Prefix = 'DINV' AND t.CompanyId IS NULL AND t.ProjectId IS NULL
);
GO

PRINT '291-seed-direct-expense-booking-doc-type applied successfully.';
GO
