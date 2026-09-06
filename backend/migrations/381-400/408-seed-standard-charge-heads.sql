-- ============================================================
-- Migration 408: Seed the standard housing-society Charge Heads so the
-- Maintenance module has real data to bill against out of the box. Rate/tax
-- are starting defaults — editable afterward in Setup -> Charge Head.
-- Guarded per-name so re-running never duplicates or overwrites a value a
-- user has since edited. Safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM dbo.MaintenanceChargeHead WHERE Name = 'Lift Maintenance')
  INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, Status, CreatedAt) VALUES ('Lift Maintenance', 500, 0, 1, GETDATE());
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MaintenanceChargeHead WHERE Name = 'Garden Maintenance')
  INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, Status, CreatedAt) VALUES ('Garden Maintenance', 300, 0, 1, GETDATE());
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MaintenanceChargeHead WHERE Name = 'Corridor Cleaning')
  INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, Status, CreatedAt) VALUES ('Corridor Cleaning', 200, 0, 1, GETDATE());
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MaintenanceChargeHead WHERE Name = 'Security')
  INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, Status, CreatedAt) VALUES ('Security', 800, 0, 1, GETDATE());
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MaintenanceChargeHead WHERE Name = 'Common Area Cleaning')
  INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, Status, CreatedAt) VALUES ('Common Area Cleaning', 250, 0, 1, GETDATE());
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MaintenanceChargeHead WHERE Name = 'Water/Sanitation')
  INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, Status, CreatedAt) VALUES ('Water/Sanitation', 400, 0, 1, GETDATE());
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MaintenanceChargeHead WHERE Name = 'Sinking Fund')
  INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, Status, CreatedAt) VALUES ('Sinking Fund', 340, 0, 1, GETDATE());
GO

IF NOT EXISTS (SELECT 1 FROM dbo.MaintenanceChargeHead WHERE Name = 'Administrative and General Expenses')
  INSERT INTO dbo.MaintenanceChargeHead (Name, Rate, TaxPct, Status, CreatedAt) VALUES ('Administrative and General Expenses', 350, 0, 1, GETDATE());
GO

PRINT '408-seed-standard-charge-heads applied successfully.';
GO
