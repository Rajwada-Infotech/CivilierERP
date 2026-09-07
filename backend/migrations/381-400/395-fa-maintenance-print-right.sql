-- Migration 395: allow "print" on the FA Maintenance & Repair page so the
-- voucher / accounting entry can be printed from the record view.

UPDATE dbo.PageDefinitions
SET Actions = 'view,create,edit,delete,print'
WHERE PageKey = 'fixed-asset-maintenance' AND Actions NOT LIKE '%print%';
GO

PRINT '395-fa-maintenance-print-right applied successfully.';
GO
