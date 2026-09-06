-- ============================================================
-- Migration 407: Maintenance Bill — Due Date, billing Period, and Notes.
-- Brings MaintenanceBill in line with the standard housing-society
-- maintenance bill format (Bill No/Date/Flat/Due Date header, a billing
-- period, and a notes block for late-payment terms etc.). All nullable —
-- existing bills simply show these as blank.
-- Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaintenanceBill') AND name = 'DueDate')
BEGIN
  ALTER TABLE dbo.MaintenanceBill ADD DueDate DATE NULL;
  PRINT 'Added dbo.MaintenanceBill.DueDate';
END
ELSE
  PRINT 'dbo.MaintenanceBill.DueDate already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaintenanceBill') AND name = 'PeriodFrom')
BEGIN
  ALTER TABLE dbo.MaintenanceBill ADD PeriodFrom DATE NULL;
  PRINT 'Added dbo.MaintenanceBill.PeriodFrom';
END
ELSE
  PRINT 'dbo.MaintenanceBill.PeriodFrom already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaintenanceBill') AND name = 'PeriodTo')
BEGIN
  ALTER TABLE dbo.MaintenanceBill ADD PeriodTo DATE NULL;
  PRINT 'Added dbo.MaintenanceBill.PeriodTo';
END
ELSE
  PRINT 'dbo.MaintenanceBill.PeriodTo already exists';
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.MaintenanceBill') AND name = 'Notes')
BEGIN
  ALTER TABLE dbo.MaintenanceBill ADD Notes NVARCHAR(1000) NULL;
  PRINT 'Added dbo.MaintenanceBill.Notes';
END
ELSE
  PRINT 'dbo.MaintenanceBill.Notes already exists';
GO

PRINT '407-maintenance-bill-due-date-period-notes applied successfully.';
GO
