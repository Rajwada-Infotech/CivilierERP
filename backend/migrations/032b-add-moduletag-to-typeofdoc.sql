-- -- Migration 032: Add ModuleTag to TypeOfDoc
-- -- ModuleTag is a stable, system-controlled label that identifies which page/module
-- -- a document type belongs to. This replaces fragile text-matching on EntryType.
-- --
-- -- Valid values:
-- --   'PO'      → Purchase Order page only
-- --   'WO'      → Work Order page only
-- --   'GRN'     → GRN page only
-- --   NULL      → shown everywhere (Expense Booking and any other page with no filter)
-- --
-- -- Safe to run multiple times.

-- IF NOT EXISTS (
--   SELECT 1 FROM sys.columns
--   WHERE object_id = OBJECT_ID('dbo.TypeOfDoc') AND name = 'ModuleTag'
-- )
--   ALTER TABLE dbo.TypeOfDoc ADD ModuleTag NVARCHAR(20) NULL;

-- -- Optional: add a check constraint to prevent invalid values
-- IF NOT EXISTS (
--   SELECT 1 FROM sys.check_constraints
--   WHERE name = 'CK_TypeOfDoc_ModuleTag'
-- )
--   ALTER TABLE dbo.TypeOfDoc
--   ADD CONSTRAINT CK_TypeOfDoc_ModuleTag
--   CHECK (ModuleTag IS NULL OR ModuleTag IN ('PO', 'WO', 'GRN'));

-- -- Attempt to auto-populate ModuleTag for existing rows using EntryType text.
-- -- This handles common variations users may have typed ("po", "PO", "purchase order", etc.)
-- -- Records that don't match any pattern will remain NULL (visible everywhere).
-- UPDATE dbo.TypeOfDoc
-- SET ModuleTag = CASE
--   WHEN LOWER(LTRIM(RTRIM(
--          (SELECT et.EntryType FROM dbo.Entry_Type et WHERE et.E_Id = TypeOfDoc.EntryTypeId)
--        ))) IN ('po', 'purchase order', 'purchaseorder', 'purchase_order', 'pur', 'p.o', 'p.o.')
--     THEN 'PO'
--   WHEN LOWER(LTRIM(RTRIM(
--          (SELECT et.EntryType FROM dbo.Entry_Type et WHERE et.E_Id = TypeOfDoc.EntryTypeId)
--        ))) IN ('wo', 'work order', 'workorder', 'work_order', 'w.o', 'w.o.')
--     THEN 'WO'
--   WHEN LOWER(LTRIM(RTRIM(
--          (SELECT et.EntryType FROM dbo.Entry_Type et WHERE et.E_Id = TypeOfDoc.EntryTypeId)
--        ))) IN ('grn', 'goods receipt', 'goods receipt note', 'goods_receipt', 'g.r.n', 'g.r.n.')
--     THEN 'GRN'
--   ELSE NULL
-- END
-- WHERE ModuleTag IS NULL;








-- 032b: no-op placeholder (duplicate of 032a, kept for migration sequence continuity)
SELECT 1 AS placeholder;