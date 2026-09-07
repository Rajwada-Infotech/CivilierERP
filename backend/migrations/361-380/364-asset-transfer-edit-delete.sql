-- Migration 364: Edit/Delete support for User-Wise Asset Transfer.
--
-- Transfer History rows were create-only until now (PUT only touched
-- TransferDate/Remarks, no delete at all). This adds:
--   • Status — soft-delete flag ('Active' | 'Deleted'), same convention as
--     dbo.FixedAssetRecord.Status, so a deleted transfer stays in the table
--     for audit instead of being hard-removed.
--   • UpdatedBy / UpdatedAt — who last edited the row and when.
--   • DeletedBy / DeletedAt — who deleted it and when (only set when Status
--     flips to 'Deleted').
-- The asset-transfer PageDefinitions row also gains the 'delete' action so
-- it can actually be granted via Menu Rights / Role Rights.

IF COL_LENGTH('dbo.AssetTransferHistory', 'Status') IS NULL
BEGIN
  ALTER TABLE dbo.AssetTransferHistory ADD Status NVARCHAR(20) NOT NULL CONSTRAINT DF_ATH_Status DEFAULT 'Active';
END
GO

IF COL_LENGTH('dbo.AssetTransferHistory', 'UpdatedBy') IS NULL
  ALTER TABLE dbo.AssetTransferHistory ADD UpdatedBy NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.AssetTransferHistory', 'UpdatedAt') IS NULL
  ALTER TABLE dbo.AssetTransferHistory ADD UpdatedAt DATETIME2 NULL;
GO
IF COL_LENGTH('dbo.AssetTransferHistory', 'DeletedBy') IS NULL
  ALTER TABLE dbo.AssetTransferHistory ADD DeletedBy NVARCHAR(200) NULL;
GO
IF COL_LENGTH('dbo.AssetTransferHistory', 'DeletedAt') IS NULL
  ALTER TABLE dbo.AssetTransferHistory ADD DeletedAt DATETIME2 NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ATH_Status' AND object_id = OBJECT_ID('dbo.AssetTransferHistory'))
  CREATE INDEX IX_ATH_Status ON dbo.AssetTransferHistory(Status);
GO

UPDATE dbo.PageDefinitions
SET Actions = 'view,create,edit,delete'
WHERE PageKey = 'asset-transfer' AND Actions NOT LIKE '%delete%';
GO

PRINT '364-asset-transfer-edit-delete applied successfully.';
GO
