-- Migration 369: link auto-created Assignments to their source Asset Transfer.
--
-- A successful User-Wise Asset Transfer now auto-creates a Fixed Asset
-- Assignment row for the receiving user, traceably linked back to the
-- transfer document:
--   • SourceTransferId — FK to dbo.AssetTransferHistory(Id); NULL for
--     manually created assignments.
--   • DepartmentId — the department the transfer was made to (snapshot),
--     FK to dbo.DepartmentMaster, mirrors AssetTransferHistory.DepartmentId.
-- A filtered UNIQUE index guarantees at most one live auto-assignment per
-- transfer (no duplicates). "Current" vs "Old" is still derived from
-- dbo.FixedAssetRecord.CustodianUserId (kept in sync by the transfer
-- create/edit/delete flow), so deleting a transfer soft-deletes its
-- auto-assignment and the previous holder's assignment becomes Current
-- again automatically.

IF COL_LENGTH('dbo.FixedAssetAssignment', 'SourceTransferId') IS NULL
  ALTER TABLE dbo.FixedAssetAssignment ADD SourceTransferId INT NULL
    CONSTRAINT FK_FAAsn_SourceTransfer REFERENCES dbo.AssetTransferHistory(Id);
GO

IF COL_LENGTH('dbo.FixedAssetAssignment', 'DepartmentId') IS NULL
  ALTER TABLE dbo.FixedAssetAssignment ADD DepartmentId INT NULL
    CONSTRAINT FK_FAAsn_Department REFERENCES dbo.DepartmentMaster(Id);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FAAsn_SourceTransfer' AND object_id = OBJECT_ID('dbo.FixedAssetAssignment'))
  CREATE UNIQUE INDEX UX_FAAsn_SourceTransfer
    ON dbo.FixedAssetAssignment(SourceTransferId)
    WHERE SourceTransferId IS NOT NULL AND Status <> 'Deleted';
GO

PRINT '369-assignment-from-transfer-link applied successfully.';
GO
