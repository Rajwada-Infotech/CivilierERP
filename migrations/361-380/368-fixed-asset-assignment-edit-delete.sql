-- Migration 368: Edit/Delete support for Fixed Asset Assignment.
--
-- Assignment History rows were create-only. This grants the
-- fixed-asset-assignment page the 'edit' and 'delete' actions so they can
-- be assigned via Menu Rights / Role Rights, and drives:
--   • PUT  /api/fixed-asset-assignment/:id — edit date / FY / user / image /
--     remarks (asset stays fixed); the asset's current custodian is
--     re-synced from the latest non-deleted assignment afterwards.
--   • DELETE /api/fixed-asset-assignment/:id — soft-delete (Status =
--     'Deleted', the column already exists from migration 366); custodian
--     is likewise re-synced to the next most-recent assignment, or cleared.

UPDATE dbo.PageDefinitions
SET Actions = 'view,create,edit,delete'
WHERE PageKey = 'fixed-asset-assignment' AND Actions NOT LIKE '%delete%';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_FAAsn_Status' AND object_id = OBJECT_ID('dbo.FixedAssetAssignment'))
  CREATE INDEX IX_FAAsn_Status ON dbo.FixedAssetAssignment(Status);
GO

PRINT '368-fixed-asset-assignment-edit-delete applied successfully.';
GO
