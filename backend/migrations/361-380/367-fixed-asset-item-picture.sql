-- Migration 367: Item Picture for Fixed Asset Record.
--
-- The New/Edit Fixed Asset form gains an "Item Picture" upload in the Asset
-- Details section — a single photo of the physical asset, shown as a
-- thumbnail on the form and on the Fixed Asset Details view.
-- Stored as a base64 data URI directly on the record (NVARCHAR(MAX)),
-- matching the per-record base64 convention already used elsewhere
-- (e.g. VehicleInOutItems.PhotoBase64, migration 250) rather than the
-- binary attachment pipeline.

IF COL_LENGTH('dbo.FixedAssetRecord', 'PictureBase64') IS NULL
  ALTER TABLE dbo.FixedAssetRecord ADD PictureBase64 NVARCHAR(MAX) NULL;
GO

PRINT '367-fixed-asset-item-picture applied successfully.';
GO
