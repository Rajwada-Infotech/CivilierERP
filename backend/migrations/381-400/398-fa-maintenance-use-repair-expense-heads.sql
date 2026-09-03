-- Migration 398: FA Maintenance & Repair now posts to the ERP's standard
-- repair expense heads instead of the module's own "Repairs & Maintenance -
-- Direct/Indirect A/c" heads (seeded by migration 392).
--
--   Direct Repair Expense   ->  "Direct Repair Expense A/c"   (Construction Expenses)
--   Indirect Repair Expense ->  "Indirect Repair Expense A/c" (Indirect Expenses)
--
-- Both target heads come from dev migrations 394/395/396. This migration:
--   1. re-points every already-posted FA Maintenance GL leg from the old
--      heads to the new ones, so Trial Balance / P&L show them under the
--      standard accounts;
--   2. deactivates the now-unused module-specific heads.
-- The posting service (fixedAssetMaintenancePosting.js) resolves by name, so
-- new postings pick up the new heads automatically.

DECLARE @oldDirect   INT = (SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'Repairs & Maintenance - Direct A/c'   AND LHeadType = 'GL');
DECLARE @oldIndirect INT = (SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'Repairs & Maintenance - Indirect A/c' AND LHeadType = 'GL');
DECLARE @newDirect   INT = (SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'Direct Repair Expense A/c'   AND LHeadType = 'GL');
DECLARE @newIndirect INT = (SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadName = 'Indirect Repair Expense A/c' AND LHeadType = 'GL');

IF @newDirect IS NULL OR @newIndirect IS NULL
BEGIN
  PRINT 'WARNING: "Direct/Indirect Repair Expense A/c" not found — skipping 398. Run dev migrations 394-396 first.';
  RETURN;
END

-- 1. Re-point posted FA Maintenance GL legs (reversed rows included, so the
--    audit trail stays consistent).
IF @oldDirect IS NOT NULL
  UPDATE dbo.GeneralLedgerEntry
     SET LHeadId = @newDirect
   WHERE SourceType = 'FAMaintenance' AND LHeadId = @oldDirect;

IF @oldIndirect IS NOT NULL
  UPDATE dbo.GeneralLedgerEntry
     SET LHeadId = @newIndirect
   WHERE SourceType = 'FAMaintenance' AND LHeadId = @oldIndirect;

PRINT 'Re-pointed FA Maintenance GL legs to Direct/Indirect Repair Expense A/c.';
GO

-- 2. Deactivate the module-specific heads (kept for history, hidden from pickers).
UPDATE dbo.AccountHeadMaster
   SET LHeadStatus = 0
 WHERE LHeadName IN ('Repairs & Maintenance - Direct A/c', 'Repairs & Maintenance - Indirect A/c')
   AND LHeadType = 'GL';
GO

PRINT '398-fa-maintenance-use-repair-expense-heads applied successfully.';
GO
