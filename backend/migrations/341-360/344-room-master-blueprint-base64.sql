-- Migration 344: Store Room Master's blueprint as base64 text instead of
-- raw VARBINARY.
--
-- The blueprint is only ever viewed via an authenticated fetchWithAuth
-- call (a plain <a href> to the API can't carry the app's Bearer token —
-- confirmed by "No token provided" when opening the link directly), which
-- returns JSON with the file already base64-encoded. Storing it as base64
-- text avoids a Buffer<->base64 conversion on every request.
--
-- Dev-stage feature, no real uploads to preserve — existing rows just
-- drop back to NULL (never uploaded) rather than attempting an in-place
-- VARBINARY->base64 conversion.
--
-- Re-run safety: the outer IF checks the column is still VARBINARY. The
-- additional NOT EXISTS guard ensures we never drop an already-converted
-- NVARCHAR(MAX) column — which would silently destroy real blueprint data
-- if this script were accidentally re-run on a migrated production database.

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.RoomMaster') AND name = 'BlueprintFileData'
    AND system_type_id = TYPE_ID('varbinary')
)
AND NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.RoomMaster') AND name = 'BlueprintFileData'
    AND system_type_id = TYPE_ID('nvarchar')
)
BEGIN
  ALTER TABLE dbo.RoomMaster DROP COLUMN BlueprintFileData;
  ALTER TABLE dbo.RoomMaster ADD BlueprintFileData NVARCHAR(MAX) NULL;
END
GO
