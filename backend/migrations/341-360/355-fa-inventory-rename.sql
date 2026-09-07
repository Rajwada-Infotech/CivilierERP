-- Migration 355: rename "Fixed Asset Tagging" menu label to "FA Inventory"
-- Cosmetic only — PageKey, routes, table/column names all unchanged.

UPDATE dbo.PageDefinitions
SET Label = 'FA Inventory'
WHERE PageKey = 'fixed-asset-tagging';
PRINT 'Renamed PageDefinitions label for fixed-asset-tagging to FA Inventory';
GO
