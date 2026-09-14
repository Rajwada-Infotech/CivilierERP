-- Migration 343: Blueprint attachment (PDF or JPG) for a Room Master room.
--
-- One blueprint per room, stored inline on the row itself rather than a
-- separate attachments table — a room never has more than one blueprint,
-- unlike Loan's multi-document LoanDocumentAttachments table.

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.RoomMaster') AND name = 'BlueprintFileName'
)
BEGIN
  ALTER TABLE dbo.RoomMaster ADD
    BlueprintFileName NVARCHAR(255) NULL,
    BlueprintMimeType NVARCHAR(100) NULL,
    BlueprintFileData VARBINARY(MAX) NULL,
    BlueprintUploadedAt DATETIME2(3) NULL;
END
GO
