-- Migration 362: exclude soft-deleted rows from the unique indexes that
-- pin an FA Item Code to a Fixed Asset Record.
--
-- UX_FAR_SourceTagId and UX_FAR_FAItemCode (357-fa-record-source-tag.sql)
-- filter out NULLs but not Status='Deleted' rows — so a deleted record
-- permanently "holds" its SourceTagId/FAItemCode, and re-selecting the same
-- code to create a new Fixed Asset Record fails with a duplicate-key error
-- even though the code is meant to be available again (unassigned-codes /
-- the create-time re-check both correctly show it as selectable, since they
-- already filter on Status). The deleted row itself keeps its SourceTagId
-- and FAItemCode values — nothing is nulled out, so its own history/audit
-- trail is untouched — the index just stops counting it toward uniqueness.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FAR_SourceTagId' AND object_id = OBJECT_ID('dbo.FixedAssetRecord'))
BEGIN
    DROP INDEX UX_FAR_SourceTagId ON dbo.FixedAssetRecord;
END
GO

CREATE UNIQUE INDEX UX_FAR_SourceTagId ON dbo.FixedAssetRecord(SourceTagId)
    WHERE SourceTagId IS NOT NULL AND Status <> 'Deleted';
GO

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_FAR_FAItemCode' AND object_id = OBJECT_ID('dbo.FixedAssetRecord'))
BEGIN
    DROP INDEX UX_FAR_FAItemCode ON dbo.FixedAssetRecord;
END
GO

CREATE UNIQUE INDEX UX_FAR_FAItemCode ON dbo.FixedAssetRecord(FAItemCode)
    WHERE FAItemCode IS NOT NULL AND Status <> 'Deleted';
GO
