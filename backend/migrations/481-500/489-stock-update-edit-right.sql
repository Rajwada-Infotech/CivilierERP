-- Migration 489: Stock Update gains an Edit action — previously
-- view/create/print/export only, with no way to fix a mistaken entry
-- short of deleting (super_admin only) and re-creating it. Registers
-- 'edit' on the page so it becomes assignable in Page Rights.
UPDATE dbo.PageDefinitions
SET Actions = 'view,create,edit,print,export'
WHERE PageKey = 'stock-update' AND IsActive = 1 AND Actions NOT LIKE '%edit%';

PRINT '489-stock-update-edit-right applied successfully.';
GO
